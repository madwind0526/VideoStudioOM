import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createGuard, TOKEN_HEADER } from "../server/guard.mjs";
import { startServer } from "../server/index.mjs";

const guard = createGuard({ ports: [4314, 5184], token: "secret-token" });
const req = ({ method = "GET", headers = {} } = {}) => ({
  method,
  headers: { host: "127.0.0.1:4314", ...headers },
});

test("allows own host on GET without token", () => {
  assert.equal(guard.check(req()).ok, true);
  assert.equal(guard.check(req({ headers: { host: "localhost:5184" } })).ok, true);
});

test("rejects unknown host (DNS rebinding)", () => {
  assert.equal(guard.check(req({ headers: { host: "evil.example:4314" } })).ok, false);
  assert.equal(guard.check(req({ headers: { host: "127.0.0.1:9999" } })).ok, false);
});

test("rejects foreign origin and cross-site fetches", () => {
  assert.equal(guard.check(req({ headers: { origin: "https://evil.example" } })).ok, false);
  assert.equal(guard.check(req({ headers: { origin: "http://127.0.0.1:5184" } })).ok, true);
  assert.equal(guard.check(req({ headers: { "sec-fetch-site": "cross-site" } })).ok, false);
});

test("state-changing methods need the token", () => {
  assert.equal(guard.check(req({ method: "POST" })).ok, false);
  assert.equal(guard.check(req({ method: "POST", headers: { [TOKEN_HEADER]: "wrong-token" } })).ok, false);
  // Different length must not throw inside timingSafeEqual.
  assert.equal(guard.check(req({ method: "DELETE", headers: { [TOKEN_HEADER]: "x" } })).ok, false);
  assert.equal(guard.check(req({ method: "POST", headers: { [TOKEN_HEADER]: "secret-token" } })).ok, true);
});

test("extra hosts are allowed only when configured", () => {
  const withTailnet = createGuard({ ports: [4314], extraHosts: ["pc.tailnet.ts.net"], token: "t" });
  assert.equal(withTailnet.check(req({ headers: { host: "pc.tailnet.ts.net" } })).ok, true);
  assert.equal(guard.check(req({ headers: { host: "pc.tailnet.ts.net" } })).ok, false);
});

test("server: health ok, session hands out the token, foreign host refused", async () => {
  const { port, token, stop } = await startServer({ port: 0, dataDir: path.join(os.tmpdir(), "vsom-guard-data"), projectsRoot: path.join(os.tmpdir(), "vsom-guard-no-projects") });
  try {
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal((await (await fetch(`${base}/api/session`)).json()).token, token);
    // fetch cannot override Host, so use a raw request.
    const { request } = await import("node:http");
    const status = await new Promise((resolve) => {
      const r = request({ host: "127.0.0.1", port, path: "/api/health", headers: { host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      r.end();
    });
    assert.equal(status, 403);
    assert.equal((await fetch(`${base}/api/unknown`, { method: "POST" })).status, 403);
  } finally {
    await stop();
  }
});
