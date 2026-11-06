import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../shared/settings.mjs";
import { serviceSpecs } from "../server/engine/services.mjs";

test("one ComfyUI by default: the main generator is the Rev0 server, which also does the RTX upscale", () => {
  const specs = serviceSpecs(DEFAULTS.connections);
  assert.deepEqual(Object.keys(specs).sort(), ["comfy", "ref", "songyue"]);
  assert.equal(specs.ref.url, "http://127.0.0.1:8188/system_stats");
  assert.equal(specs.ref.cwd, DEFAULTS.connections.refDir);
  assert.equal(specs.comfy, specs.ref);
});

test("two ComfyUI servers when the addresses differ: the main one is SongYUE2's", () => {
  const specs = serviceSpecs({ ...DEFAULTS.connections, comfyUrl: "http://127.0.0.1:8190" });
  assert.equal(specs.comfy.url, "http://127.0.0.1:8190/system_stats");
  assert.notEqual(specs.comfy.cwd, specs.ref.cwd);
});

test("the default Rev0 folder keeps its backslashes", () => {
  assert.equal(DEFAULTS.connections.refDir, "C:\\ComfyUI-Portable\\ComfyUI-Rev0");
});
