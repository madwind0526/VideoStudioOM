import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../shared/settings.mjs";
import { serviceSpecs } from "../server/engine/services.mjs";

test("two ComfyUI servers: SongYUE2's and Rev0, which also does the RTX upscale", () => {
  const specs = serviceSpecs(DEFAULTS.connections);
  assert.deepEqual(Object.keys(specs).sort(), ["comfy", "ref", "songyue"]);
  assert.equal(specs.ref.url, "http://127.0.0.1:8188/system_stats");
  assert.equal(specs.ref.cwd, DEFAULTS.connections.refDir);
});

test("the default Rev0 folder keeps its backslashes", () => {
  assert.equal(DEFAULTS.connections.refDir, "C:\\ComfyUI-Portable\\ComfyUI-Rev0");
});
