import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runTool } from "../server/engine/tools.mjs";
import { TOKEN_HEADER } from "../server/guard.mjs";
import { startServer } from "../server/index.mjs";
import { createJobQueue } from "../server/jobs.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in for the real tool runner: it only writes the output file (after `sleep` seconds) and obeys cancellation.
const fakeRun = async ({ inputs, signal, onProgress }) => {
  if (inputs.sleep) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, inputs.sleep * 1000);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (signal.aborted) return { ok: false, code: "cancelled", error: "사용자가 취소했습니다.", artifacts: [] };
  onProgress?.({ value: 1, max: 1 });
  const out = path.resolve(inputs.output_path);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, "ok");
  return { ok: true, artifacts: [out], seed: 7, durationSeconds: 0.1 };
};

// A ComfyUI that reports another run in progress (queue_running) or none.
async function fakeComfy(running) {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(req.url === "/queue" ? JSON.stringify({ queue_running: running ? [["x"]] : [], queue_pending: [] }) : "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function fixture({ run = fakeRun, comfyUrl = "http://127.0.0.1:9" } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "vsom-jobs-"));
  const project = path.join(base, "projects", "demo");
  const dataDir = path.join(base, "data");
  await mkdir(path.join(project, "assets"), { recursive: true });
  // The settings point ComfyUI and SongYUE2 at dead ports, so nothing real is touched.
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ connections: { comfyUrl, songyueUrl: "http://127.0.0.1:9" } }));
  const config = { connections: { comfyUrl, songyueUrl: "http://127.0.0.1:9" }, ffmpegPath: "" };
  const queue = createJobQueue({ dir: path.join(dataDir, "runtime"), getConfig: async () => config, events: { broadcast() {} }, run });
  const idle = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (!(await queue.list()).current) return (await queue.list()).history[0];
      await sleep(50);
    }
    throw new Error("job did not finish");
  };
  return { base, project, dataDir, config, queue, idle, cleanup: () => rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

const gpuInputs = (project, extra = {}) => ({ output_path: path.join(project, "assets", "out.png"), ...extra });

test("runs a tool; the result is saved and progress is reported", async () => {
  const f = await fixture();
  try {
    const job = await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal(job.status, "running");
    const done = await f.idle();
    assert.equal(done.status, "done", JSON.stringify(done));
    assert.deepEqual(done.artifacts, [path.join(f.project, "assets", "out.png")]);
    assert.equal(await readFile(done.artifacts[0], "utf8"), "ok");
    assert.equal(done.seed, 7);
    assert.equal(done.progress, undefined);
  } finally {
    await f.cleanup();
  }
});

test("a second job while one runs is refused with 409", async () => {
  const f = await fixture();
  try {
    await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project, { sleep: 1.5 }), allowRoot: f.project });
    await assert.rejects(f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project }), { status: 409 });
    assert.equal((await f.idle()).status, "done");
    // Free again afterwards.
    await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal((await f.idle()).status, "done");
  } finally {
    await f.cleanup();
  }
});

test("a ComfyUI that is busy with someone else's run blocks ComfyUI tools only (409)", async () => {
  const comfy = await fakeComfy(true);
  const f = await fixture({ comfyUrl: comfy.url });
  try {
    await assert.rejects(f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project }), { status: 409 });
    assert.equal((await f.queue.gpu()).lock.busy, true);
    // Speech and music do not use that ComfyUI.
    await f.queue.start({ tool: "qwen3_tts", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal((await f.idle()).status, "done");
  } finally {
    comfy.close();
    await f.cleanup();
  }
});

test("bad requests become failed jobs with a code (the real runner checks them before touching any service)", async () => {
  const f = await fixture({ run: runTool });
  try {
    const run = async (tool, inputs) => {
      await f.queue.start({ tool, inputs, allowRoot: f.project });
      return f.idle();
    };
    assert.equal((await run("comfyui_krea_image", { prompt: "x", output_path: path.join(f.base, "elsewhere.png") })).code, "path_outside");
    assert.equal((await run("comfyui_krea_image", { output_path: path.join(f.project, "assets", "a.png") })).code, "bad_input");
    assert.equal((await run("no_such_tool", gpuInputs(f.project))).code, "unknown_tool");
    assert.equal((await run("h3_reference_video", { prompt: "x", output_path: path.join(f.project, "assets", "a.mp4") })).code, "bad_input");
  } finally {
    await f.cleanup();
  }
});

test("cancel stops the running job at once and the next one can start", async () => {
  const f = await fixture();
  try {
    const job = await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project, { sleep: 30 }), allowRoot: f.project });
    await sleep(200);
    await f.queue.cancel(job.id);
    const done = await f.idle();
    assert.equal(done.status, "cancelled");
    await assert.rejects(f.queue.cancel(job.id), { status: 404 });
    await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal((await f.idle()).status, "done");
  } finally {
    await f.cleanup();
  }
});

test("a job left running by a previous server is marked interrupted", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.dataDir, "runtime"), { recursive: true });
    await writeFile(path.join(f.dataDir, "runtime", "jobs.json"), JSON.stringify([{ id: "old", tool: "x", status: "running", startedAt: 1 }]));
    const { history, current } = await f.queue.list();
    assert.equal(current, null);
    assert.equal(history[0].status, "interrupted");
  } finally {
    await f.cleanup();
  }
});

test("API: whitelist, project-relative paths, full run, GPU status", async () => {
  const f = await fixture();
  const projectsRoot = path.join(f.base, "projects");
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, runTool: fakeRun });
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal((await call("POST", "/api/jobs", { project: "demo", tool: "os_system", inputs: {} })).status, 400);
    assert.equal((await call("POST", "/api/jobs", { project: "nope", tool: "comfyui_krea_image", inputs: { output_path: "assets/a.png" } })).status, 404);
    for (const output_path of ["../x.png", "renders/a.png", "assets/a.exe", "assets", "C:\\x.png"]) {
      assert.equal((await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path } })).status, 400, output_path);
    }
    assert.equal((await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path: "assets/a.png", extra_dir: "x" } })).status, 400);

    const started = await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path: "assets/images/a.png", sleep: 1 } });
    assert.equal(started.status, 202);
    assert.equal((await call("GET", "/api/gpu")).body.current.id, started.body.job.id);
    assert.equal((await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path: "assets/images/b.png" } })).status, 409);

    for (let i = 0; i < 100; i += 1) {
      if (!(await call("GET", "/api/jobs")).body.current) break;
      await sleep(50);
    }
    const { body } = await call("GET", "/api/jobs");
    assert.equal(body.history[0].status, "done");
    assert.equal(await readFile(path.join(f.project, "assets", "images", "a.png"), "utf8"), "ok");
  } finally {
    await stop();
    await f.cleanup();
  }
});

test("API: freeing VRAM works when idle and is refused while a job runs", async () => {
  const comfy = await fakeComfy(false);
  const f = await fixture({ comfyUrl: comfy.url });
  const projectsRoot = path.join(f.base, "projects");
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, runTool: fakeRun });
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json", [TOKEN_HEADER]: token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const idle = await call("POST", "/api/gpu/free", {});
    assert.equal(idle.status, 200);
    // The settings point the RTX ComfyUI at its default port, which is not running here; the fake one answered.
    assert.ok(idle.body.freed.includes("comfy"));
    await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path: "assets/images/a.png", sleep: 1.5 } });
    assert.equal((await call("POST", "/api/gpu/free", {})).status, 409);
  } finally {
    await stop();
    comfy.close();
    await f.cleanup();
  }
});

test("API: a batch runs in order, saves how each file was made, and a file can be deleted", async () => {
  const f = await fixture();
  const projectsRoot = path.join(f.base, "projects");
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, runTool: fakeRun });
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const idle = async () => {
    for (let i = 0; i < 200; i += 1) {
      const { body } = await call("GET", "/api/jobs");
      if (!body.current && body.pending === 0) return body;
      await sleep(50);
    }
    throw new Error("batch did not finish");
  };
  try {
    const items = ["a", "b", "c"].map((name) => ({ tool: "comfyui_krea_image", label: name, inputs: { output_path: `assets/images/${name}.png` }, record: { kind: "image", prompt: `picture ${name}` } }));
    const started = await call("POST", "/api/jobs", { project: "demo", items });
    assert.equal(started.status, 202);
    assert.equal(started.body.queued, 2);
    assert.deepEqual(started.body.job.meta.batch, { id: started.body.job.meta.batch.id, index: 1, total: 3 });
    await idle();

    const detail = (await call("GET", "/api/projects/demo")).body.project;
    assert.deepEqual(detail.media.images.map((file) => file.path), ["assets/images/a.png", "assets/images/b.png", "assets/images/c.png"]);
    assert.equal(detail.media.images[1].record.prompt, "picture b");

    assert.equal((await call("DELETE", "/api/projects/demo/media?path=assets%2Fimages%2Fb.png")).status, 200);
    assert.equal((await call("GET", "/api/projects/demo")).body.project.media.images.length, 2);
    assert.equal((await call("DELETE", "/api/projects/demo/media?path=..%2Fproject.json")).status >= 400, true);
    assert.equal((await call("POST", "/api/jobs", { project: "demo", items: [] })).status, 400);
  } finally {
    await stop();
    await f.cleanup();
  }
});

test("a batch that stops keeps the rest (the stopped item first); resume makes it again, discard drops it", async () => {
  const f = await fixture();
  try {
    const good = (name) => ({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project, { output_path: path.join(f.project, "assets", `${name}.png`) }), allowRoot: f.project, meta: { project: "demo", output: `assets/${name}.png` } });
    // The middle item writes outside the allowed folder, so it fails (path_outside).
    const bad = { ...good("b"), inputs: { output_path: path.join(f.base, "elsewhere.png") } };
    await f.queue.startBatch([good("a"), bad, good("c")]);
    for (let i = 0; i < 200 && ((await f.queue.list()).current || (await f.queue.list()).pending > 0); i += 1) await sleep(50);
    assert.equal((await f.queue.list()).paused, 2);
    // Resuming runs the bad item again (fails again) and keeps "c" paused behind it.
    await f.queue.resume();
    for (let i = 0; i < 200 && ((await f.queue.list()).current || (await f.queue.list()).pending > 0); i += 1) await sleep(50);
    assert.equal((await f.queue.list()).paused, 2);
    await f.queue.discardPaused();
    assert.equal((await f.queue.list()).paused, 0);
    await assert.rejects(f.queue.resume(), { status: 404 });
  } finally {
    await f.cleanup();
  }
});

test("work left over from a stopped server is offered for resume", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.dataDir, "runtime"), { recursive: true });
    const item = (name) => ({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project, { output_path: path.join(f.project, "assets", `${name}.png`) }), allowRoot: f.project, meta: { project: "demo", batch: { id: "x", index: 1, total: 3 } } });
    await writeFile(path.join(f.dataDir, "runtime", "queue.json"), JSON.stringify({ current: item("a"), pending: [item("b")], paused: [] }));
    assert.equal((await f.queue.list()).paused, 2);
    await f.queue.resume();
    for (let i = 0; i < 200 && ((await f.queue.list()).current || (await f.queue.list()).pending > 0); i += 1) await sleep(50);
    const history = (await f.queue.list()).history;
    assert.equal(history.filter((job) => job.status === "done").length, 2);
    await stat(path.join(f.project, "assets", "a.png"));
    await stat(path.join(f.project, "assets", "b.png"));
  } finally {
    await f.cleanup();
  }
});

test("API: a job made for `candidateOf` becomes another version of that file, the shown file stays", async () => {
  const f = await fixture();
  const projectsRoot = path.join(f.base, "projects");
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, runTool: fakeRun });
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { "content-type": "application/json", [TOKEN_HEADER]: token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    await mkdir(path.join(f.project, "assets", "images"), { recursive: true });
    await writeFile(path.join(f.project, "assets", "images", "a.png"), "first");
    const record = { kind: "image", prompt: "second prompt" };
    const started = await call("POST", "/api/jobs", { project: "demo", tool: "comfyui_krea_image", inputs: { output_path: "assets/versions/a-2.png" }, record, candidateOf: "assets/images/a.png" });
    assert.equal(started.status, 202);
    for (let i = 0; i < 100; i += 1) {
      if (!(await call("GET", "/api/jobs")).body.current) break;
      await sleep(50);
    }
    const { entry } = (await call("GET", "/api/projects/demo/versions?path=assets%2Fimages%2Fa.png")).body;
    assert.deepEqual(entry.versions.map((item) => [item.id, item.file]), [["v1", "assets/images/a.png"], ["v2", "assets/versions/a-2.png"]]);
    assert.equal(entry.versions[1].record.prompt, "second prompt");
    assert.equal(await readFile(path.join(f.project, "assets", "images", "a.png"), "utf8"), "first");

    const chosen = await call("POST", "/api/projects/demo/versions", { path: "assets/images/a.png", select: "v2" });
    assert.equal(chosen.body.entry.selected, "v2");
    assert.equal(await readFile(path.join(f.project, "assets", "images", "a.png"), "utf8"), "ok");
  } finally {
    await stop();
    await f.cleanup();
  }
});

test("onIdle runs once when the queue is empty, not between the jobs of a batch", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vsom-idle-"));
  try {
    let idles = 0;
    const queue = createJobQueue({ dir: path.join(base, "runtime"), getConfig: async () => ({ connections: { comfyUrl: "http://127.0.0.1:9", songyueUrl: "http://127.0.0.1:9" }, ffmpegPath: "" }), events: { broadcast() {} }, run: fakeRun, onIdle: () => void (idles += 1) });
    const item = (name) => ({ tool: "comfyui_krea_image", inputs: { output_path: path.join(base, name) }, allowRoot: [base], meta: { batch: true } });
    await queue.startBatch([item("a.png"), item("b.png"), item("c.png")]);
    for (let i = 0; i < 200 && (idles === 0 || (await queue.list()).current); i += 1) await sleep(50);
    await sleep(100);
    assert.equal((await queue.list()).history.filter((job) => job.status === "done").length, 3);
    assert.equal(idles, 1);
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
