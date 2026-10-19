import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULTS, deepMerge } from "../shared/settings.mjs";
import { applyEngine, checkWorkflow, listDir } from "../server/engine.mjs";

const withEngine = (patch) => deepMerge(DEFAULTS, { engine: patch });

test("no workflow in the settings leaves the call alone", () => {
  const call = { tool: "h3_local_video", inputs: { prompt: "x", reference_image_path: "a.png", output_path: "o.mp4" } };
  assert.deepEqual(applyEngine(DEFAULTS, call), { ...call, allowRoots: [] });
});

test("a workflow turns the call into comfyui_workflow with models, LoRAs and files", () => {
  const settings = withEngine({
    video: { workflowI2V: "D:/wf/i2v.json", diffusion: "m.safetensors", loras: [{ name: "l.safetensors", strength: 0.7 }] },
    upscale: { model: "up.pth" },
  });
  const out = applyEngine(settings, {
    tool: "h3_local_video",
    inputs: { prompt: "p", width: 736, height: 416, duration_seconds: 5, reference_image_path: "a.png", last_frame_path: "b.png", audio_path: "s.wav", output_path: "o.mp4", upscale: true },
  });
  assert.equal(out.tool, "comfyui_workflow");
  assert.equal(out.inputs.workflow_path, "D:/wf/i2v.json");
  assert.deepEqual(out.inputs.image_paths, ["a.png", "b.png"]);
  assert.equal(out.inputs.audio_path, "s.wav");
  assert.equal(out.inputs.models.diffusion, "m.safetensors");
  assert.deepEqual(out.inputs.loras, [{ name: "l.safetensors", strength: 0.7 }]);
  assert.equal(out.inputs.upscale_model, "up.pth");
  assert.deepEqual(out.allowRoots, ["D:/wf"]);
  // Without a workflow the built-in tool still gets the chosen models and LoRAs.
  const plain = applyEngine(withEngine({ image: { diffusion: "m.safetensors", loras: [{ name: "l", strength: 0.5 }] } }), { tool: "comfyui_krea_image", inputs: { prompt: "p", output_path: "o.png" } });
  assert.equal(plain.tool, "comfyui_krea_image");
  assert.deepEqual(plain.inputs.overrides, { models: { diffusion: "m.safetensors" }, loras: [{ name: "l", strength: 0.5 }] });
  // The slot follows the kind of call: text-only video uses the T2V workflow, which is empty here.
  assert.equal(applyEngine(settings, { tool: "h3_local_video", inputs: { prompt: "p", output_path: "o.mp4" } }).tool, "h3_local_video");
});

test("folder picker lists folders first, hides dot names, reports errors without failing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-fs-"));
  try {
    await mkdir(path.join(dir, "sub"));
    await writeFile(path.join(dir, "a.json"), "{}");
    await writeFile(path.join(dir, "b.txt"), "x");
    await writeFile(path.join(dir, ".hidden"), "x");
    const { entries, parent, path: shown, shortcuts } = await listDir(dir);
    assert.deepEqual(entries, [{ name: "sub", isDirectory: true }, { name: "a.json", isDirectory: false }, { name: "b.txt", isDirectory: false }]);
    assert.equal(parent, path.dirname(dir));
    assert.equal(shown, path.resolve(dir));
    assert.ok(shortcuts.length > 0);
    const missing = await listDir(path.join(dir, "nope"));
    assert.equal(missing.entries.length, 0);
    assert.ok(missing.error);
    await assert.rejects(listDir("relative/path"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("workflow check names missing nodes and models, and rejects the UI format", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-wf-"));
  const comfy = createServer((req, res) => {
    const cls = decodeURIComponent(req.url.split("/").pop());
    if (cls === "UNETLoader") res.end(JSON.stringify({ UNETLoader: { input: { required: { unet_name: [["have.safetensors"]] } } } }));
    else if (cls === "KSampler") res.end(JSON.stringify({ KSampler: { input: { required: {} } } }));
    else res.end("{}");
  });
  await new Promise((resolve) => comfy.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${comfy.address().port}`;
  try {
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ 1: { class_type: "UNETLoader", inputs: { unet_name: "gone.safetensors" } }, 2: { class_type: "KSampler", inputs: {} }, 3: { class_type: "FancyNode", inputs: {} } }));
    const result = await checkWorkflow(bad, url);
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingNodes, ["FancyNode"]);
    assert.match(result.missingModels[0], /unet_name=gone\.safetensors/);
    const ui = path.join(dir, "ui.json");
    await writeFile(ui, JSON.stringify({ nodes: [], links: [] }));
    assert.match((await checkWorkflow(ui, url)).problems[0], /API Format/);
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a character sheet has its own workflow slot and the slot key never reaches the tool", () => {
  const withSheet = withEngine({ image: { workflowSheet: "D:/wf/sheet.json" } });
  const out = applyEngine(withSheet, { tool: "comfyui_krea_image", inputs: { prompt: "p", slot: "sheet", output_path: "assets/images/sheet-a.png" } });
  assert.equal(out.tool, "comfyui_workflow");
  assert.equal(out.inputs.workflow_path, "D:/wf/sheet.json");
  assert.ok(!("slot" in out.inputs));
  // Without a sheet workflow the built-in image tool runs, still without the slot key.
  const plain = applyEngine(DEFAULTS, { tool: "comfyui_krea_image", inputs: { prompt: "p", slot: "sheet", output_path: "o.png" } });
  assert.deepEqual([plain.tool, "slot" in plain.inputs], ["comfyui_krea_image", false]);
  // A normal image call does not use the sheet workflow.
  assert.equal(applyEngine(withSheet, { tool: "comfyui_krea_image", inputs: { prompt: "p", output_path: "o.png" } }).tool, "comfyui_krea_image");
});
