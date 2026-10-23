import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../shared/settings.mjs";
import { serviceSpecs } from "../server/engine/services.mjs";

const base = { ...DEFAULTS.connections, rtxUrl: "http://127.0.0.1:8191", rtxApp: "desktop-app" };

test("rtx has its own launcher unless it shares the Rev0 address", () => {
  assert.equal(serviceSpecs(base).rtx.cwd, "desktop-app");
  const shared = serviceSpecs({ ...base, rtxUrl: base.refUrl });
  assert.equal(shared.rtx, shared.ref);
});

test("the default Rev0 folder keeps its backslashes", () => {
  assert.equal(DEFAULTS.connections.refDir, "C:\\ComfyUI-Portable\\ComfyUI-Rev0");
});
