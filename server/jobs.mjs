import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createMutex, writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";
import { killTree, readGpuLock, runBridge } from "./om-bridge.mjs";

const HISTORY_LIMIT = 40;

/**
 * One GPU job at a time. The bridge holds the real lock (a file, so tools started from anywhere
 * respect it); this queue adds the current job's metadata, history, cancellation, and batches:
 * a batch runs its jobs one after another and stops at the first one that fails or is cancelled.
 * `getConfig()` returns { python, bridgePath, omDir, lockFile, songyueUrl, timeoutMs }.
 * `onFinished(job)` is called after every finished job (the server uses it to save how a file was made).
 */
export function createJobQueue({ dir, getConfig, events, onFinished }) {
  const file = path.join(dir, "jobs.json");
  const mutex = createMutex();
  let history = [];
  let current = null;
  let currentChild = null;
  let pending = [];
  let loaded = null;

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
    if (pending.length === 0) return;
    if (job.status !== "done") {
      pending = [];
      publish(job);
      return;
    }
    const next = pending.shift();
    try {
      await start(next);
    } catch (error) {
      pending = [];
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
    const lock = await readGpuLock(config.lockFile);
    if (lock.busy) throw new HttpError(409, "GPU를 다른 작업이 쓰고 있습니다.", { lock: lock.holder });
    if (await songyueBusy(config.songyueUrl)) throw new HttpError(409, "SongYUE2가 곡을 만드는 중입니다.");

    const job = { id: randomUUID().slice(0, 8), tool, status: "running", startedAt: Date.now(), meta };
    current = job;
    history.unshift(job);
    publish(job);
    void persist();

    runBridge({
      python: config.python,
      bridgePath: config.bridgePath,
      omDir: config.omDir,
      timeoutMs: config.timeoutMs,
      args: ["--lock-file", config.lockFile, ...[allowRoot].flat().flatMap((root) => ["--allow-root", root]), "run", tool],
      stdin: JSON.stringify(inputs),
      onSpawn: (child) => (currentChild = child),
    }).then(async (result) => {
      const cancelled = job.status === "cancelled";
      if (!cancelled) job.status = result.ok ? "done" : "failed";
      Object.assign(job, {
        finishedAt: Date.now(),
        artifacts: result.artifacts ?? [],
        error: cancelled ? "사용자가 취소했습니다." : (result.error ?? null),
        code: result.code ?? null,
        durationSeconds: result.durationSeconds ?? null,
        seed: result.seed ?? null,
      });
      current = null;
      currentChild = null;
      void persist();
      await afterJob(job);
      publish(job);
    });
    return job;
  }

  return {
    async list() {
      await ready();
      return { current, history: history.slice(0, HISTORY_LIMIT), pending: pending.length };
    },

    async gpu() {
      const config = await getConfig();
      return { lock: await readGpuLock(config.lockFile), songyueBusy: await songyueBusy(config.songyueUrl), current };
    },

    start,

    /** Starts the first job now and queues the rest; each job's meta gets `batch: { id, index, total }`. */
    async startBatch(items) {
      if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, "만들 항목이 없습니다.");
      const id = randomUUID().slice(0, 8);
      const tagged = items.map((item, index) => ({ ...item, meta: { ...item.meta, batch: { id, index: index + 1, total: items.length } } }));
      const first = await start(tagged[0]);
      pending = tagged.slice(1);
      return { job: first, queued: pending.length };
    },

    async cancel(id) {
      await ready();
      if (!current || current.id !== id) throw new HttpError(404, "진행 중인 작업이 아닙니다.");
      current.status = "cancelled";
      pending = []; // a cancelled job ends its batch
      killTree(currentChild);
      return current;
    },
  };
}
