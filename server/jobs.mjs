import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createMutex, writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";
import { createComfy } from "./engine/comfy.mjs";
import { outsideRoots, runTool } from "./engine/tools.mjs";

const HISTORY_LIMIT = 40;

// Tools that use the ComfyUI of SongYUE2: a run of the user's own in that ComfyUI blocks starting another.
const COMFY_TOOLS = new Set(["comfyui_krea_image", "h3_local_video", "h3_reference_video", "comfyui_workflow"]);

/**
 * One GPU job at a time, run inside this server (no helper process). The queue keeps the current job's metadata and
 * progress, the history, cancellation, and batches: a batch runs its jobs one after another and stops at the first one
 * that fails or is cancelled (the rest can be resumed).
 * `getConfig()` returns { connections, ffmpegPath }; `run` is the tool runner (tests replace it).
 * `onFinished(job)` is called after every finished job (the server uses it to save how a file was made).
 */
export function createJobQueue({ dir, getConfig, events, onFinished, run = runTool }) {
  const file = path.join(dir, "jobs.json");
  const mutex = createMutex();
  let history = [];
  let current = null;
  let controller = null;
  let pending = [];
  // Work of a batch that stopped (a failure, a cancel, a restart): kept so the rest can be made later ("resume").
  let paused = [];
  let currentItem = null;
  let loaded = null;
  const queueFile = path.join(dir, "queue.json");

  const persistQueue = () =>
    mutex("queue", async () => {
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(queueFile, `${JSON.stringify({ current: currentItem, pending, paused }, null, 2)}\n`);
    });

  const persist = () =>
    mutex("jobs", async () => {
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(file, `${JSON.stringify(history.slice(0, HISTORY_LIMIT), null, 2)}\n`);
    });

  // A job still marked running after a restart lost its owner; its bridge may still hold the GPU lock.
  const ready = () =>
    (loaded ??= (async () => {
      try {
        history = JSON.parse(await readFile(file, "utf8"));
      } catch {
        history = [];
      }
      let changed = false;
      for (const job of history) {
        if (job.status === "running") {
          Object.assign(job, { status: "interrupted", error: "서버가 다시 시작되어 추적을 잃었습니다.", finishedAt: Date.now() });
          changed = true;
        }
      }
      if (changed) await persist();
      // Whatever was running or waiting when the server stopped goes to the paused list, the running item first.
      try {
        const saved = JSON.parse(await readFile(queueFile, "utf8"));
        paused = [...(saved.current?.meta?.batch ? [saved.current] : []), ...(saved.pending ?? []), ...(saved.paused ?? [])];
        if (paused.length !== (saved.paused ?? []).length) await persistQueue();
      } catch {
        paused = [];
      }
    })());

  async function songyueBusy(url) {
    try {
      const res = await fetch(`${url}/api/generate/status`, { signal: AbortSignal.timeout(2000) });
      return Boolean((await res.json()).active);
    } catch {
      // SongYUE2 not running is fine; only a confirmed "generating" blocks us.
      return false;
    }
  }

  const publish = (job) => events.broadcast("job", job);

  /** After a job: save its record, then start the next job of its batch (a failure or cancel ends the batch). */
  async function afterJob(job) {
    if (job.status === "done") {
      try {
        await onFinished?.(job);
      } catch {
        // Not being able to save the record must not stop the batch; the file itself exists.
      }
    }
    if (job.status !== "done" && job.meta?.batch && currentItem) {
      // The item that did not finish is made again on resume, together with what was waiting behind it.
      paused = [...paused, currentItem, ...pending];
      pending = [];
      currentItem = null;
      await persistQueue();
      publish(job);
      return;
    }
    if (pending.length === 0) {
      currentItem = null;
      await persistQueue();
      return;
    }
    if (job.status !== "done") {
      pending = [];
      await persistQueue();
      publish(job);
      return;
    }
    const next = pending.shift();
    try {
      await start(next);
    } catch (error) {
      paused = [...paused, next, ...pending];
      pending = [];
      await persistQueue();
      const failed = { id: randomUUID().slice(0, 8), tool: next.tool, status: "failed", startedAt: Date.now(), finishedAt: Date.now(), error: error.message, meta: next.meta };
      history.unshift(failed);
      publish(failed);
      void persist();
    }
  }

  /** Starts a job and returns it immediately; progress arrives as "job" events. */
  async function start({ tool, inputs, allowRoot, meta = {} }) {
    await ready();
    const config = await getConfig();
    if (current) throw new HttpError(409, "다른 작업이 진행 중입니다.", { job: current });
    if (COMFY_TOOLS.has(tool) && (await createComfy(config.connections.comfyUrl).busy())) throw new HttpError(409, "ComfyUI가 다른 작업을 하고 있습니다.");
    if (await songyueBusy(config.connections.songyueUrl)) throw new HttpError(409, "SongYUE2가 곡을 만드는 중입니다.");

    const job = { id: randomUUID().slice(0, 8), tool, status: "running", startedAt: Date.now(), meta };
    current = job;
    currentItem = { tool, inputs, allowRoot, meta };
    void persistQueue();
    history.unshift(job);
    publish(job);
    void persist();

    controller = new AbortController();
    let lastSent = 0;
    const onProgress = ({ value, max }) => {
      job.progress = { value, max };
      // The sampler reports every step; the screen needs a few updates per second at most.
      if (Date.now() - lastSent > 400 || value === max) {
        lastSent = Date.now();
        publish(job);
      }
    };
    const offending = outsideRoots(inputs, [allowRoot].flat());
    const finished = offending
      ? Promise.resolve({ ok: false, code: "path_outside", error: `허용된 폴더 밖의 경로입니다: ${offending}`, artifacts: [] })
      : run({ tool, inputs, connections: config.connections, ffmpegPath: config.ffmpegPath, signal: controller.signal, onProgress });
    finished.then(async (result) => {
      const cancelled = job.status === "cancelled";
      if (!cancelled) job.status = result.ok ? "done" : "failed";
      delete job.progress;
      Object.assign(job, {
        finishedAt: Date.now(),
        artifacts: result.artifacts ?? [],
        error: cancelled ? "사용자가 취소했습니다." : (result.error ?? null),
        code: result.code ?? null,
        durationSeconds: result.durationSeconds ?? null,
        seed: result.seed ?? null,
      });
      current = null;
      controller = null;
      void persist();
      await afterJob(job);
      publish(job);
    });
    return job;
  }

  return {
    async list() {
      await ready();
      return { current, history: history.slice(0, HISTORY_LIMIT), pending: pending.length, paused: paused.length };
    },

    async gpu() {
      const { connections } = await getConfig();
      const comfyBusy = current === null && (await createComfy(connections.comfyUrl).busy());
      const busy = current !== null || comfyBusy;
      return { lock: { busy, holder: current ? { tool: current.tool } : comfyBusy ? { tool: "comfyui" } : undefined }, songyueBusy: await songyueBusy(connections.songyueUrl), current };
    },

    start,

    /** Starts the first job now and queues the rest; each job's meta gets `batch: { id, index, total }`. */
    async startBatch(items) {
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "만들 항목이 없습니다.");
      const id = randomUUID().slice(0, 8);
      const tagged = items.map((item, index) => ({ ...item, meta: { ...item.meta, batch: { id, index: index + 1, total: items.length } } }));
      // The rest must be waiting before the first job starts: a job that fails at once ends its batch right away.
      pending = tagged.slice(1);
      let first;
      try {
        first = await start(tagged[0]);
      } catch (error) {
        pending = [];
        throw error;
      }
      await persistQueue();
      return { job: first, queued: pending.length };
    },

    /** Starts the paused work again (the stopped item first, then the rest one after another). */
    async resume() {
      await ready();
      if (paused.length === 0) throw new HttpError(404, "이어서 만들 작업이 없습니다.");
      const items = paused;
      paused = [];
      await persistQueue();
      try {
        return await this.startBatch(items.map(({ meta, ...item }) => ({ ...item, meta: { ...meta, batch: undefined } })));
      } catch (error) {
        paused = items;
        await persistQueue();
        throw error;
      }
    },

    async discardPaused() {
      await ready();
      paused = [];
      await persistQueue();
    },

    async cancel(id) {
      await ready();
      if (!current || current.id !== id) throw new HttpError(404, "진행 중인 작업이 아닙니다.");
      current.status = "cancelled"; // a cancelled job ends its batch; afterJob moves the rest to the paused list
      controller?.abort();
      return current;
    },
  };
}
