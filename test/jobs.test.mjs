import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { TOKEN_HEADER } from "../server/guard.mjs";
import { startServer } from "../server/index.mjs";
import { createJobQueue } from "../server/jobs.mjs";
import { readGpuLock } from "../server/om-bridge.mjs";

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bridge", "om_tool.py");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in for OpenMontage: same module names the bridge imports, tools that only write a file.
const FAKE_TOOLS = `
import subprocess, sys, time
from pathlib import Path
from tools.base_tool import ToolResult, ToolRuntime, ToolStatus

class _Tool:
    capability = "fake"
    input_schema = {"type": "object", "required": ["output_path"],
                    "properties": {"output_path": {"type": "string"}, "sleep": {"type": "number"}}}
    def __init__(self, name, runtime):
        self.name = name
        self.runtime = runtime
    def get_status(self):
        return ToolStatus.AVAILABLE
    def execute(self, inputs):
        subprocess.run([sys.executable, "-c", "print('noise written straight to fd 1')"])
        print("noise printed by the tool")
        time.sleep(float(inputs.get("sleep", 0)))
        out = Path(inputs["output_path"])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("ok")
        return ToolResult(success=True, data={"x": 1}, artifacts=[str(out)], seed=7, duration_seconds=0.1)

class _Registry:
    def __init__(self):
        self._tools = {"comfyui_krea_image": _Tool("comfyui_krea_image", ToolRuntime.LOCAL_GPU),
                       "songyue_music": _Tool("songyue_music", ToolRuntime.LOCAL)}
    def discover(self):
        pass
    def get(self, name):
        return self._tools.get(name)
    def list_all(self):
        return list(self._tools)

registry = _Registry()
`;

const FAKE_BASE = `
from dataclasses import dataclass, field
from enum import Enum

class ToolRuntime(str, Enum):
    LOCAL = "local"
    LOCAL_GPU = "local_gpu"

class ToolStatus(str, Enum):
    AVAILABLE = "available"
    UNAVAILABLE = "unavailable"

@dataclass
class ToolResult:
    success: bool
    data: dict = field(default_factory=dict)
    artifacts: list = field(default_factory=list)
    error: str | None = None
    cost_usd: float | None = 0.0
    duration_seconds: float = 0.0
    seed: int | None = None
    model: str | None = None
`;

async function fixture() {
  const base = await mkdtemp(path.join(os.tmpdir(), "vsom-jobs-"));
  const om = path.join(base, "om");
  const project = path.join(base, "projects", "demo");
  const dataDir = path.join(base, "data");
  await mkdir(path.join(om, "tools"), { recursive: true });
  await writeFile(path.join(om, "tools", "__init__.py"), "");
  await writeFile(path.join(om, "tools", "base_tool.py"), FAKE_BASE);
  await writeFile(path.join(om, "tools", "tool_registry.py"), FAKE_TOOLS);
  await mkdir(path.join(project, "assets"), { recursive: true });
  const lockFile = path.join(dataDir, "runtime", "gpu.lock");
  const config = { omDir: om, python: "python", bridgePath: BRIDGE, lockFile, songyueUrl: "http://127.0.0.1:9", timeoutMs: 30_000 };
  const queue = createJobQueue({ dir: path.join(dataDir, "runtime"), getConfig: async () => config, events: { broadcast() {} } });
  const idle = async () => {
    for (let i = 0; i < 200; i += 1) {
      if (!(await queue.list()).current) return (await queue.list()).history[0];
      await sleep(50);
    }
    throw new Error("job did not finish");
  };
  return { base, om, project, dataDir, lockFile, config, queue, idle, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const gpuInputs = (project, extra = {}) => ({ output_path: path.join(project, "assets", "out.png"), ...extra });

test("runs a GPU tool through the bridge; tool noise on stdout does not break the result; lock is released", async () => {
  const f = await fixture();
  try {
    const job = await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal(job.status, "running");
    const done = await f.idle();
    assert.equal(done.status, "done", JSON.stringify(done));
    assert.deepEqual(done.artifacts, [path.join(f.project, "assets", "out.png")]);
    assert.equal(await readFile(done.artifacts[0], "utf8"), "ok");
    assert.equal(done.seed, 7);
    assert.equal((await readGpuLock(f.lockFile)).busy, false);
    await assert.rejects(stat(f.lockFile), { code: "ENOENT" });
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

test("a lock held by a live process blocks (409); a lock from a dead process is cleaned up", async () => {
  const f = await fixture();
  try {
    await mkdir(path.dirname(f.lockFile), { recursive: true });
    await writeFile(f.lockFile, JSON.stringify({ pid: process.pid, tool: "other" }));
    await assert.rejects(f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project }), { status: 409 });

    await writeFile(f.lockFile, JSON.stringify({ pid: 99_999_999, tool: "crashed" }));
    assert.deepEqual((await readGpuLock(f.lockFile)).busy, false);
    await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project), allowRoot: f.project });
    assert.equal((await f.idle()).status, "done");
  } finally {
    await f.cleanup();
  }
});

test("bad requests become failed jobs with a code", async () => {
  const f = await fixture();
  try {
    const run = async (tool, inputs) => {
      await f.queue.start({ tool, inputs, allowRoot: f.project });
      return f.idle();
    };
    assert.equal((await run("comfyui_krea_image", { output_path: path.join(f.base, "elsewhere.png") })).code, "path_outside");
    assert.equal((await run("comfyui_krea_image", { sleep: 0 })).code, "bad_input");
    assert.equal((await run("no_such_tool", gpuInputs(f.project))).code, "unknown_tool");
    // A CPU tool needs no lock file at all.
    assert.equal((await run("songyue_music", gpuInputs(f.project))).status, "done");
  } finally {
    await f.cleanup();
  }
});

test("cancel stops the running job and leaves the GPU free", async () => {
  const f = await fixture();
  try {
    const job = await f.queue.start({ tool: "comfyui_krea_image", inputs: gpuInputs(f.project, { sleep: 30 }), allowRoot: f.project });
    await sleep(1500);
    await f.queue.cancel(job.id);
    const done = await f.idle();
    assert.equal(done.status, "cancelled");
    assert.equal((await readGpuLock(f.lockFile)).busy, false);
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
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, bridge: f.config });
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

test("API: a batch runs in order, saves how each file was made, and a file can be deleted", async () => {
  const f = await fixture();
  const projectsRoot = path.join(f.base, "projects");
  const { port, token, stop } = await startServer({ port: 0, dataDir: f.dataDir, projectsRoot, bridge: f.config });
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
