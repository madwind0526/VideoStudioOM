import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { TOKEN_HEADER } from "../server/guard.mjs";
import { startServer } from "../server/index.mjs";

async function withServer(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-api-"));
  const { port, token, stop } = await startServer({ port: 0, dataDir: path.join(dir, "data"), projectsRoot: path.join(dir, "projects") });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { "content-type": "application/json", ...(auth ? { [TOKEN_HEADER]: token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await run(call);
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test("global settings: defaults, partial update, validation errors leave the file alone", () =>
  withServer(async (call) => {
    const initial = await call("GET", "/api/settings");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.settings.defaults.aspect, "16:9");

    const updated = await call("PUT", "/api/settings", { video: { finalFps: 30 } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.settings.video.finalFps, 30);
    assert.equal(updated.body.settings.video.upscale, "rtx-2pass");

    const bad = await call("PUT", "/api/settings", { presets: { "16:9": { generate: [740, 416] } } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors[0].path, "presets.16:9.generate");
    assert.equal((await call("GET", "/api/settings")).body.settings.video.finalFps, 30);

    assert.equal((await call("PUT", "/api/settings", [1])).status, 400);
    assert.equal((await call("PUT", "/api/settings", undefined)).status, 400);
  }));

test("writes need the token, reads do not", () =>
  withServer(async (call) => {
    assert.equal((await call("PUT", "/api/settings", { video: { finalFps: 30 } }, { auth: false })).status, 403);
    assert.equal((await call("POST", "/api/projects", { title: "x" }, { auth: false })).status, 403);
    assert.equal((await call("GET", "/api/projects", undefined, { auth: false })).status, 200);
  }));

test("project flow: create, save with conflict check, settings overrides", () =>
  withServer(async (call) => {
    const created = await call("POST", "/api/projects", { title: "벌 이야기" });
    assert.equal(created.status, 201);
    const id = encodeURIComponent(created.body.project.id);

    const saved = await call("PUT", `/api/projects/${id}/file`, { path: "studio/synopsis.md", content: "v1" });
    assert.equal(saved.status, 200);
    const read = await call("GET", `/api/projects/${id}/file?path=${encodeURIComponent("studio/synopsis.md")}`);
    assert.equal(read.body.content, "v1");

    const stale = await call("PUT", `/api/projects/${id}/file`, { path: "studio/synopsis.md", content: "x", expectedMtimeMs: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.mtimeMs, read.body.mtimeMs);

    const escape = await call("PUT", `/api/projects/${id}/file`, { path: "../other/x.md", content: "x" });
    assert.equal(escape.status, 400);
    assert.equal((await call("GET", `/api/projects/${id}/file?path=${encodeURIComponent("C:\\Windows\\win.ini")}`)).status, 400);
    assert.equal((await call("GET", "/api/projects/..%2Fsecret")).status, 400);
    assert.equal((await call("GET", "/api/projects/%E0%A4%A")).status, 400);

    await call("PUT", "/api/settings", { video: { finalFps: 30 } });
    const view = await call("PUT", `/api/projects/${id}/settings`, { set: { defaults: { aspect: "9:16" } } });
    assert.equal(view.status, 200);
    assert.equal(view.body.effective.defaults.aspect, "9:16");
    assert.equal(view.body.effective.video.finalFps, 30);
    assert.deepEqual(view.body.overridden, ["defaults.aspect"]);

    const reset = await call("PUT", `/api/projects/${id}/settings`, { unset: ["defaults.aspect"] });
    assert.equal(reset.body.effective.defaults.aspect, "16:9");
    assert.deepEqual(reset.body.overridden, []);

    const list = await call("GET", "/api/projects");
    assert.equal(list.body.projects.length, 1);
    assert.equal((await call("GET", "/api/projects/no-such-project")).status, 404);
  }));
