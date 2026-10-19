import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { watchProjects } from "../server/events.mjs";
import { parseRange } from "../server/http.mjs";
import { startServer } from "../server/index.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("watcher reports one event per burst, ignores temp files and stray names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-watch-"));
  const seen = [];
  const watcher = watchProjects({ root, delayMs: 50, onChange: (change) => seen.push(change) });
  try {
    await mkdir(path.join(root, "demo", "studio"), { recursive: true });
    await wait(300);
    seen.length = 0;

    for (let i = 0; i < 4; i += 1) await writeFile(path.join(root, "demo", "studio", "topic.md"), `v${i}`);
    await writeFile(path.join(root, "demo", "studio", "x.tmp"), "temp");
    await writeFile(path.join(root, "Not Valid"), "stray");
    await wait(500);

    const topic = seen.filter((c) => c.path === "studio/topic.md");
    assert.equal(topic.length, 1, JSON.stringify(seen));
    assert.equal(topic[0].project, "demo");
    assert.equal(seen.some((c) => c.path.endsWith(".tmp")), false);
    assert.equal(seen.some((c) => c.project === "Not Valid"), false);
  } finally {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SSE stream: hello, then a file event for a change in the projects folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-sse-"));
  const projectsRoot = path.join(dir, "projects");
  await mkdir(path.join(projectsRoot, "demo", "studio"), { recursive: true });
  const { port, stop } = await startServer({ port: 0, dataDir: path.join(dir, "data"), projectsRoot });
  const controller = new AbortController();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil("event: hello");
    await writeFile(path.join(projectsRoot, "demo", "studio", "topic.md"), "x");
    await readUntil("event: file");
    assert.match(text, /"project":"demo"/);
    assert.match(text, /"path":"studio\/topic\.md"/);
  } finally {
    controller.abort();
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("media streaming: whole file, ranges, bad ranges, wrong types and paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-media-"));
  const projectsRoot = path.join(dir, "projects");
  await mkdir(path.join(projectsRoot, "demo", "renders"), { recursive: true });
  await writeFile(path.join(projectsRoot, "demo", "renders", "final.mp4"), "0123456789");
  await writeFile(path.join(projectsRoot, "demo", "renders", "notes.exe"), "x");
  const { port, stop } = await startServer({ port: 0, dataDir: path.join(dir, "data"), projectsRoot });
  const get = (rel, headers = {}) =>
    fetch(`http://127.0.0.1:${port}/api/projects/demo/media?path=${encodeURIComponent(rel)}`, { headers });
  try {
    const whole = await get("renders/final.mp4");
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get("content-type"), "video/mp4");
    assert.equal(await whole.text(), "0123456789");

    const part = await get("renders/final.mp4", { range: "bytes=2-4" });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("content-range"), "bytes 2-4/10");
    assert.equal(await part.text(), "234");

    assert.equal((await get("renders/final.mp4", { range: "bytes=50-60" })).status, 416);
    assert.equal((await get("renders/notes.exe")).status, 400);
    assert.equal((await get("renders/missing.mp4")).status, 404);
    assert.equal((await get("../../secret.mp4")).status, 400);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseRange", () => {
  assert.equal(parseRange(undefined, 10), null);
  assert.deepEqual(parseRange("bytes=0-3", 10), { start: 0, end: 3 });
  assert.deepEqual(parseRange("bytes=4-", 10), { start: 4, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=5-999", 10), { start: 5, end: 9 });
  for (const bad of ["bytes=10-12", "bytes=4-2", "bytes=-", "items=0-1", "bytes=0-1,3-4"]) assert.equal(parseRange(bad, 10), "invalid", bad);
  assert.equal(parseRange("bytes=0-0", 0), "invalid");
});
