import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { TOKEN_HEADER } from "../server/guard.mjs";
import { ensureWorkFolders, folderPaths, folderStatus, resolveFolder } from "../server/folders.mjs";
import { startServer } from "../server/index.mjs";
import { llmStatus } from "../server/llm-status.mjs";
import { createDurationProbe, ffprobeFor } from "../server/probe.mjs";
import { createProjectStore } from "../server/projects.mjs";
import { DEFAULTS } from "../shared/settings.mjs";

async function setup(probeDuration) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-cards-"));
  return { root, store: createProjectStore({ getRoot: async () => root, probeDuration }), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("card info: description, favorite, duration, media lists", async () => {
  const { root, store, cleanup } = await setup(async (file) => (file.endsWith("final.mp4") ? 35.5 : null));
  try {
    const { id } = await store.create("demo");
    let card = (await store.list())[0];
    assert.equal(card.description, "");
    assert.equal(card.favorite, false);
    assert.equal(card.durationSeconds, null);

    await store.writeText(id, "studio/topic.md", "\n# 벌의 8자 춤\nsecond line", null);
    await writeFile(path.join(root, id, "renders", "final.mp4"), "x");
    await writeFile(path.join(root, id, "assets", "images", "b.png"), "x");
    await writeFile(path.join(root, id, "assets", "images", "a.png"), "x");
    await writeFile(path.join(root, id, "assets", "images", "notes.txt"), "x");
    await writeFile(path.join(root, id, "assets", "video", "clip1.mp4"), "x");
    await writeFile(path.join(root, id, "assets", "audio", "narration.wav"), "x");

    card = (await store.list())[0];
    assert.equal(card.description, "벌의 8자 춤");
    assert.equal(card.durationSeconds, 35.5);

    const { media } = await store.get(id);
    assert.deepEqual(media.images.map((f) => f.path), ["assets/images/a.png", "assets/images/b.png"]);
    assert.deepEqual(media.videos.map((f) => f.path), ["renders/final.mp4", "assets/video/clip1.mp4"]);
    assert.deepEqual(media.audio.map((f) => f.path), ["assets/audio/narration.wav"]);

    assert.deepEqual(await store.updateMeta(id, { favorite: true }), { favorite: true });
    assert.equal((await store.list())[0].favorite, true);
    await store.updateMeta(id, { favorite: false });
    assert.equal((await store.get(id)).favorite, false);
    await assert.rejects(store.updateMeta(id, { favorite: "yes" }), { status: 400 });
    await assert.rejects(store.updateMeta(id, { title: "x" }), { status: 400 });
    await assert.rejects(store.updateMeta(id, [true]), { status: 400 });
  } finally {
    await cleanup();
  }
});

test("optional read answers null instead of 404", async () => {
  const { store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");
    assert.deepEqual(await store.readText(id, "studio/synopsis.md", { optional: true }), { content: null, mtimeMs: null });
    await assert.rejects(store.readText(id, "studio/synopsis.md"), { status: 404 });
  } finally {
    await cleanup();
  }
});

test("duration probe: parses and rounds, caches successes only, tolerates a missing ffprobe", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-probe-"));
  const file = path.join(dir, "a.mp4");
  await writeFile(file, "x");
  try {
    let calls = 0;
    let answer = "35.5239\n";
    const probe = createDurationProbe({ getFfprobe: async () => "ffprobe", run: async () => (calls += 1, answer) });
    assert.equal(await probe(file), 35.5);
    assert.equal(await probe(file), 35.5);
    assert.equal(calls, 1);
    assert.equal(await probe(path.join(dir, "missing.mp4")), null);

    const failing = createDurationProbe({ getFfprobe: async () => "ffprobe", run: async () => (calls += 1, answer) });
    answer = null;
    assert.equal(await failing(file), null);
    answer = "12\n";
    assert.equal(await failing(file), 12);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ffprobe path follows ffmpegPath", () => {
  assert.equal(ffprobeFor(""), "ffprobe");
  if (process.platform === "win32") {
    assert.equal(ffprobeFor("C:\\tools\\ffmpeg\\bin\\ffmpeg.exe"), "C:\\tools\\ffmpeg\\bin\\ffprobe.exe");
    assert.equal(ffprobeFor("C:\\tools\\ffmpeg\\bin"), "C:\\tools\\ffmpeg\\bin\\ffprobe.exe");
  }
});

test("folders: defaults, relative to the app, absolute kept, created on demand", async () => {
  const app = await mkdtemp(path.join(os.tmpdir(), "vsom-folders-"));
  try {
    const settings = structuredClone(DEFAULTS);
    settings.connections.openmontageDir = path.join(app, "om");
    const defaults = folderPaths(settings, app);
    assert.equal(defaults.projects, path.join(app, "om", "projects"));
    assert.equal(defaults.input, path.join(app, "input"));
    assert.equal(defaults.output, path.join(app, "output"));

    settings.storage.inputDir = "media\\in";
    settings.storage.outputDir = path.join(app, "elsewhere");
    const custom = folderPaths(settings, app);
    assert.equal(custom.input, path.join(app, "media", "in"));
    assert.equal(custom.output, path.join(app, "elsewhere"));
    assert.equal(resolveFolder("   ", "fallback", app), path.join(app, "fallback"));

    assert.equal((await folderStatus(settings, app)).input.exists, false);
    await ensureWorkFolders(settings, app);
    const status = await folderStatus(settings, app);
    assert.equal(status.input.exists, true);
    assert.equal(status.output.exists, true);
    assert.equal(status.projects.exists, false);
    await writeFile(path.join(app, "afile"), "x");
    settings.storage.outputDir = path.join(app, "afile");
    assert.equal((await folderStatus(settings, app)).output.isFile, true);
  } finally {
    await rm(app, { recursive: true, force: true });
  }
});

test("llm status: CLIs by PATH, Ollama by its answer", async () => {
  const status = await llmStatus({
    ollamaEndpoint: "http://127.0.0.1:1",
    installed: (command) => command === "claude",
    models: async () => ["gemma4:latest"],
  });
  assert.deepEqual(status.providers.map((p) => [p.id, p.ready]), [["claude-cli", true], ["codex-cli", false], ["opencode-cli", false], ["ollama", true]]);
  assert.deepEqual(status.providers.at(-1).models, ["gemma4:latest"]);
  const offline = await llmStatus({ ollamaEndpoint: "x", installed: () => false, models: async () => null });
  assert.equal(offline.providers.at(-1).ready, false);
});

test("API: folders status, saving settings creates input/output, meta + optional read", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-cardapi-"));
  const { port, token, stop } = await startServer({ port: 0, dataDir: path.join(dir, "data"), projectsRoot: path.join(dir, "projects"), appRoot: dir, bridge: { songyueUrl: "http://127.0.0.1:9" } });
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    const inDir = path.join(dir, "my-input");
    const outDir = path.join(dir, "my-output");
    assert.equal((await call("GET", "/api/folders")).body.folders.input.exists, false);
    const saved = await call("PUT", "/api/settings", { storage: { inputDir: inDir, outputDir: outDir } });
    assert.equal(saved.status, 200);
    const folders = (await call("GET", "/api/folders")).body.folders;
    assert.equal(folders.input.path, inDir);
    assert.equal(folders.input.exists, true);
    assert.equal(folders.output.exists, true);
    assert.equal((await call("PUT", "/api/settings", { storage: { inputDir: "a\nb" } })).status, 400);

    const created = await call("POST", "/api/projects", { title: "demo" });
    const id = created.body.project.id;
    assert.equal((await call("PUT", `/api/projects/${id}/meta`, { favorite: true })).body.meta.favorite, true);
    assert.equal((await call("GET", "/api/projects")).body.projects[0].favorite, true);
    assert.equal((await call("PUT", `/api/projects/${id}/meta`, { favorite: 1 })).status, 400);
    assert.equal((await call("GET", `/api/projects/${id}/file?path=studio%2Fsynopsis.md&optional=1`)).body.content, null);
    assert.equal((await call("GET", `/api/projects/${id}/file?path=studio%2Fsynopsis.md`)).status, 404);
    assert.equal((await call("GET", "/api/llm/status")).body.providers.length, 4);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
