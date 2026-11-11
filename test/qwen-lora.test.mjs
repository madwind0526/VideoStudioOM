import assert from "node:assert/strict";
import { test } from "node:test";

import { qwenEditGraph } from "../server/engine/graphs.mjs";
import { modelsFor } from "../shared/imageModels.mjs";

const models = { unet: "u", clip: "c", vae: "v" };

test("qwen edit graph: without a LoRA the cache reads the loader, with LoRAs they chain in between", () => {
  const plain = qwenEditGraph({ prompt: "x", images: ["a.png"], seed: 1, models });
  assert.deepEqual(plain[4].inputs.model, ["1", 0]);
  const graph = qwenEditGraph({ prompt: "x", images: ["a.png"], seed: 1, models, loras: [{ name: "one.safetensors", strength: 0.8 }, { name: "two.safetensors" }] });
  assert.deepEqual(graph[9100].inputs.model, ["1", 0]);
  assert.equal(graph[9100].inputs.strength_model, 0.8);
  assert.deepEqual(graph[9101].inputs.model, ["9100", 0]);
  assert.equal(graph[9101].inputs.strength_model, 1);
  assert.deepEqual(graph[4].inputs.model, ["9101", 0]);
});

test("the Qwen + Krea LoRA model is listed for edits and carries its LoRA", () => {
  for (const kind of ["i2i", "r2i"]) {
    const entry = modelsFor(kind).find((model) => model.id === "qwen-edit-krea-lora");
    assert.equal(entry.tool, "comfyui_image_edit");
    assert.match(entry.input.lora, /Deno_krea2_film_texture_qwen21_r64_000002500\.safetensors$/);
  }
});
