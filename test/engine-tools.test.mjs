import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { QWENVL, H3, h3Frames, h3Graph, h3Prompt, h3RefGraph, kreaGraph, pickKreaModels } from "../server/engine/graphs.mjs";
import { outsideRoots, promptsOf, runTool, splitSpeech } from "../server/engine/tools.mjs";
import { applyOverrides, loadApiWorkflow, missingModels, missingNodes, outputNode, patchWorkflow, WorkflowError } from "../server/engine/workflow-patch.mjs";
import { fakeComfy } from "./helpers/fake-comfy.mjs";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "vsom-tools-"));
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const options = (list) => ({ input: { required: { x: [list] } } });
const loader = (field, list) => ({ input: { required: { [field]: [list] } } });

test("graphs: frame grid, prompt ending, Krea model choice", () => {
  assert.equal(h3Frames(5), 124);
  assert.equal(h3Frames(3), 73);
  assert.equal(h3Frames(0.1), 5);
  assert.equal(h3Prompt("a bee"), "a bee No text, no subtitles, no watermark.");
  const structured = "integrated_multimodal_description: [Shot 1] x\n\noverall_soundscape: y\n\nnon_diegetic_music: N/A";
  assert.equal(h3Prompt(structured), structured);
  const picked = pickKreaModels({ unets: ["Krea\\krea2_turbo_fp8.safetensors", "Krea\\krea2_turbo_nvfp4.safetensors", "other.safetensors"], clips: ["Qwen\\qwen3vl_4b_fp8_scaled.safetensors"], vaes: ["qwen\\qwen_image_vae.safetensors"] });
  assert.equal(picked.unet, "Krea\\krea2_turbo_nvfp4.safetensors");
  assert.equal(pickKreaModels({ unets: [], clips: [], vaes: [] }), null);
  const graph = kreaGraph({ prompt: "p", seed: 5, models: picked });
  assert.equal(graph[4].inputs.text, "p");
  assert.equal(graph[8].inputs.seed, 5);
  assert.equal(graph[10].class_type, "PreviewImage");
});

test("graphs: H3 image to video wires first and last frame and pins audio at frame 0", () => {
  const plain = h3Graph({ prompt: "p", seed: 1, image: "a.png" });
  assert.deepEqual(plain[6].inputs.first_frame, ["5", 0]);
  assert.equal(plain[6].inputs.last_frame, undefined);
  assert.equal(plain[6].inputs.length, 124);
  assert.deepEqual(plain[10].inputs.conditioning, ["6", 0]);
  const full = h3Graph({ prompt: "p", seed: 1, image: "a.png", last: "b.png", audio: "s.wav" });
  assert.deepEqual(full[6].inputs.last_frame, ["17", 0]);
  assert.equal(full[19].class_type, "MiniMaxH3AddGuide");
  assert.equal(full[19].inputs.frame_idx, 0);
  assert.deepEqual(full[10].inputs.conditioning, ["19", 0]);
  assert.equal(full[16].inputs.lora_name, H3.lora);
  assert.deepEqual(full[8].inputs.model, ["16", 0]);
});

test("graphs: H3 reference graph uses ids from 40 for pictures and the dynamic input names", () => {
  const graph = h3RefGraph({ prompt: "p", seed: 1, images: ["a.png", "b.png"], video: "v.mp4", audio: "s.wav", useVideoAudio: true, seconds: 3 });
  assert.equal(graph[40].inputs.image, "a.png");
  assert.deepEqual(graph[6].inputs["ref_images.ref_image_1"], ["41", 0]);
  assert.deepEqual(graph[6].inputs["ref_videos.ref_video_0"], ["33", 0]);
  assert.deepEqual(graph[6].inputs["ref_video_audios.ref_video_audio_0"], ["31", 1]);
  assert.deepEqual(graph[6].inputs["ref_audios.ref_audio_0"], ["34", 0]);
  assert.equal(graph[33].inputs.length, 73);
  assert.equal(graph[1].inputs.unet_name, H3.refUnets.turbo);
  assert.equal(graph[8].inputs.steps, 8);
  assert.equal(h3RefGraph({ prompt: "p", seed: 1, model: "official", images: ["a"] })[8].inputs.steps, 20);
});

const T2V = {
  1: { class_type: "CLIPLoader", inputs: { clip_name: "umt5.safetensors", type: "wan" } },
  2: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 0], text: "" } },
  3: { class_type: "CLIPTextEncode", inputs: { clip: ["1", 0], text: "bad quality" } },
  4: { class_type: "VAELoader", inputs: { vae_name: "wan_vae.safetensors" } },
  5: { class_type: "UNETLoader", inputs: { unet_name: "wan_high.safetensors" } },
  6: { class_type: "UNETLoader", inputs: { unet_name: "wan_low.safetensors" } },
  11: { class_type: "EmptyHunyuanLatentVideo", inputs: { width: 832, height: 480, length: 81, batch_size: 1 } },
  12: { class_type: "KSamplerAdvanced", inputs: { model: ["5", 0], noise_seed: 1, positive: ["2", 0], negative: ["3", 0], latent_image: ["11", 0] } },
  16: { class_type: "SaveVideo", inputs: { video: ["12", 0], filename_prefix: "v" } },
};

test("workflow patch: prompt by sampler link, seed, size, LoRA chain, models, files, output node", () => {
  const { workflow, notes } = patchWorkflow(T2V, { prompt: "a bee", negative: "ugly", width: 640, height: 352, frames: 33, seed: 9, models: { diffusion: "X.safetensors", vae: "v.safetensors" }, loras: [{ name: "l1", strength: 0.8 }, { name: "l2" }] });
  assert.deepEqual(notes, []);
  assert.equal(workflow[2].inputs.text, "a bee");
  assert.equal(workflow[3].inputs.text, "ugly");
  assert.deepEqual([workflow[11].inputs.width, workflow[11].inputs.height, workflow[11].inputs.length], [640, 352, 33]);
  assert.equal(workflow[12].inputs.noise_seed, 9);
  assert.equal(workflow[4].inputs.vae_name, "v.safetensors");
  assert.equal(workflow[5].inputs.unet_name, "X.safetensors");
  // The sampler now takes the model from the end of the LoRA chain that starts at the first diffusion loader.
  assert.deepEqual(workflow[12].inputs.model, ["9002", 0]);
  assert.deepEqual(workflow[9002].inputs.model, ["9001", 0]);
  assert.deepEqual(workflow[9001].inputs.model, ["5", 0]);
  assert.equal(workflow[9001].inputs.strength_model, 0.8);
  assert.equal(workflow[9002].inputs.strength_model, 1);
  assert.equal(outputNode(workflow), "16");
  // The source is not changed.
  assert.equal(T2V[2].inputs.text, "");
  const files = patchWorkflow({ 1: { class_type: "LoadImage", inputs: { image: "d.png" } }, 2: { class_type: "LoadImage", inputs: { image: "e.png" } } }, { images: ["a.png", "b.png", "c.png"] });
  assert.deepEqual([files.workflow[1].inputs.image, files.workflow[2].inputs.image], ["a.png", "b.png"]);
  assert.match(files.notes[0], /LoadImage 노드가 2개뿐/);
  assert.equal(applyOverrides(T2V, null), T2V);
});

test("workflow check: missing nodes and models are named; the UI format is refused", async () => {
  const info = new Map([["CLIPLoader", loader("clip_name", ["umt5.safetensors"])], ["UNETLoader", loader("unet_name", ["wan_high.safetensors"])], ["CLIPTextEncode", {}], ["SaveVideo", {}]]);
  assert.deepEqual(missingNodes(T2V, info), ["EmptyHunyuanLatentVideo", "KSamplerAdvanced", "VAELoader"]);
  assert.deepEqual(missingModels(T2V, info), ["unet_name=wan_low.safetensors (노드 6, UNETLoader)"]);
  const dir = await tmp();
  try {
    await writeFile(path.join(dir, "ui.json"), JSON.stringify({ nodes: [], links: [] }));
    await assert.rejects(loadApiWorkflow(path.join(dir, "ui.json")), (error) => error instanceof WorkflowError && /API Format/.test(error.message));
    await assert.rejects(loadApiWorkflow(path.join(dir, "missing.json")), /파일이 없습니다/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paths outside the allowed folders are found; speech is split in sentences of 200 characters", () => {
  const root = path.resolve("/tmp/proj");
  assert.equal(outsideRoots({ output_path: path.join(root, "a.png"), image_paths: [path.join(root, "b.png")] }, [root]), null);
  assert.equal(outsideRoots({ output_path: path.resolve("/tmp/other/a.png") }, [root]), "output_path");
  assert.equal(outsideRoots({ image_paths: [path.join(root, "b.png"), path.resolve("/etc/x")] }, [root]), "image_paths");
  assert.equal(outsideRoots({ prompt: "free text", seed: 3 }, [root]), null);
  assert.deepEqual(splitSpeech("안녕하세요. 반갑습니다! 잘 가요?"), ["안녕하세요. 반갑습니다! 잘 가요?"]);
  assert.equal(splitSpeech(`${"가".repeat(450)}`).length, 3);
  assert.deepEqual(splitSpeech("   "), []);
});

const run = (tool, inputs, comfy, extra = {}) =>
  runTool({ tool, inputs, connections: { comfyUrl: comfy.url, refUrl: comfy.url, refDir: "x", songyueUrl: "http://127.0.0.1:9", songyueDir: "x" }, deps: { ensure: async () => undefined, ...extra } });

test("describe_image: the picture is uploaded to Rev0 and the text of the QwenVL node comes back", async () => {
  const comfy = await fakeComfy({ nodes: { AILab_QwenVL: loader("model_name", [QWENVL.model, "Qwen3-VL-2B-Instruct"]) }, outputs: { 6: { text: ["  A girl on a beach.  "] } } });
  const dir = await tmp();
  try {
    const image = path.join(dir, "a.png");
    await writeFile(image, "IMG");
    const result = await run("describe_image", { image_path: image, seed: 3 }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.text, "A girl on a beach.");
    assert.deepEqual(comfy.seen.uploads, ["a.png"]);
    assert.equal(comfy.seen.prompts[0][7].inputs.model_name, QWENVL.model);
    assert.equal(comfy.seen.prompts[0][7].inputs.keep_model_loaded, false);
    assert.equal((await run("describe_image", { image_path: path.join(dir, "none.png") }, comfy)).code, "bad_input");
    const without = await fakeComfy({ nodes: { AILab_QwenVL: loader("model_name", ["Qwen3-VL-2B-Instruct"]) } });
    assert.equal((await run("describe_image", { image_path: image }, without)).code, "unavailable");
    without.close();
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("describe_video: the clip goes to the video input of QwenVL and the summary comes back", async () => {
  const comfy = await fakeComfy({ nodes: { AILab_QwenVL: loader("model_name", [QWENVL.model]) }, outputs: { 6: { text: ["A bee flies left."] } } });
  const dir = await tmp();
  try {
    const clip = path.join(dir, "c.mp4");
    await writeFile(clip, "VID");
    const result = await run("describe_video", { video_path: clip }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.text, "A bee flies left.");
    const graph = comfy.seen.prompts[0];
    assert.equal(graph[5].inputs.video, "up_c.mp4");
    assert.deepEqual(graph[7].inputs.video, ["5", 0]);
    assert.equal(graph[7].inputs.preset_prompt, "📹 Video Summary");
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Krea image: models are picked from ComfyUI, overrides add a LoRA, the result is saved", async () => {
  const comfy = await fakeComfy({
    nodes: { UNETLoader: loader("unet_name", ["Krea\\krea2_turbo_nvfp4.safetensors"]), CLIPLoader: loader("clip_name", ["Qwen\\qwen3vl_4b_fp8_scaled.safetensors"]), VAELoader: loader("vae_name", ["qwen\\qwen_image_vae.safetensors"]) },
    outputs: { 10: { images: [{ filename: "k.png", type: "temp" }] } },
    files: { "k.png": Buffer.from("IMG") },
  });
  const dir = await tmp();
  try {
    const out = path.join(dir, "assets", "images", "a.png");
    const result = await run("comfyui_krea_image", { prompt: "a lighthouse", width: 736, height: 416, output_path: out, seed: 42, overrides: { loras: [{ name: "style.safetensors", strength: 0.7 }] } }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await readFile(out, "utf8"), "IMG");
    assert.equal(result.seed, 42);
    const graph = comfy.seen.prompts[0];
    assert.equal(graph[4].inputs.text, "a lighthouse");
    assert.equal(graph[8].inputs.seed, 42);
    assert.equal(graph[9001].inputs.lora_name, "style.safetensors");
    assert.deepEqual(graph[8].inputs.model, ["9001", 0]);
    // Missing model files are reported, not guessed.
    const empty = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", []), CLIPLoader: loader("clip_name", []), VAELoader: loader("vae_name", []) } });
    const refused = await run("comfyui_krea_image", { prompt: "x", output_path: out }, empty);
    empty.close();
    assert.equal(refused.code, "unavailable");
    assert.match(refused.error, /Krea 2 Turbo/);
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("H3 video: pictures are crop-fitted and uploaded, first/last/audio reach the graph, the clip is finished with ffmpeg", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=1:r=24", "-f", "lavfi", "-i", "sine=duration=1", "-shortest", "-pix_fmt", "yuv420p", clip);
    const first = path.join(dir, "first.png");
    const last = path.join(dir, "last.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", first);
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=200x100", "-frames:v", "1", last);
    const sound = path.join(dir, "voice.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=300:duration=1", sound);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.unet]) }, outputs: { 15: { video: [{ filename: "clip.mp4" }] } }, files: { "clip.mp4": await readFile(clip) } });
    const out = path.join(dir, "assets", "video", "c.mp4");
    const result = await run("h3_local_video", { prompt: "she waves", reference_image_path: first, last_frame_path: last, audio_path: sound, width: 64, height: 48, duration_seconds: 3, upscale: false, output_path: out }, comfy);
    comfy.close();
    assert.equal(result.ok, true, JSON.stringify(result));
    await stat(out);
    // Both pictures were uploaded (fitted copies), the audio too.
    assert.equal(comfy.seen.uploads.length, 3);
    const graph = comfy.seen.prompts[0];
    assert.equal(graph[6].class_type, "MiniMaxH3ImageToVideo");
    assert.equal(graph[6].inputs.length, 73);
    assert.equal(graph[19].class_type, "MiniMaxH3AddGuide");
    assert.match(graph[6].inputs.prompt, /she waves No text/);
    // The temporary files next to the result are gone.
    await assert.rejects(stat(path.join(dir, "assets", "video", "c.lo.mp4")));
    await assert.rejects(stat(path.join(dir, "assets", "video", "c.first.png")));
    // Without a first image there is nothing to animate.
    const missing = await run("h3_local_video", { prompt: "x", output_path: out }, { url: "http://127.0.0.1:9" });
    assert.equal(missing.code, "bad_input");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("H3 reference video: pictures become reference inputs, limits and missing files are refused", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=1:r=24", "-pix_fmt", "yuv420p", clip);
    const pictures = [];
    for (const name of ["a", "b"]) {
      const file = path.join(dir, `${name}.png`);
      ffmpeg("-f", "lavfi", "-i", "color=c=green:s=64x48", "-frames:v", "1", file);
      pictures.push(file);
    }
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.refUnets.turbo]) }, outputs: { 15: { video: [{ filename: "r.mp4" }] } }, files: { "r.mp4": await readFile(clip) } });
    const out = path.join(dir, "r2v.mp4");
    const result = await run("h3_reference_video", { prompt: "swap", reference_image_paths: pictures, duration_seconds: 3, width: 64, height: 48, upscale: false, model: "turbo", output_path: out }, comfy);
    comfy.close();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(comfy.seen.uploads, ["a.png", "b.png"]);
    assert.deepEqual(comfy.seen.prompts[0][6].inputs["ref_images.ref_image_1"], ["41", 0]);
    assert.equal((await run("h3_reference_video", { prompt: "x", reference_image_paths: Array(10).fill(pictures[0]), output_path: out }, comfy)).code, "bad_input");
    assert.equal((await run("h3_reference_video", { prompt: "x", output_path: out }, comfy)).code, "bad_input");
    assert.match((await run("h3_reference_video", { prompt: "x", reference_image_paths: [path.join(dir, "none.png")], output_path: out }, comfy)).error, /파일이 없습니다/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("motion continuation: the reference graph pins the clip before and cuts the pinned frames off again", () => {
  const graph = h3RefGraph({ prompt: "p", seed: 1, model: "turbo", images: ["a.png"], motion: { video: "prev.mp4", total: 124, latent: "C:/x/prev.safetensors" }, saveLatent: "vsom_latents/c" });
  assert.equal(graph[73].inputs.batch_index, 124 - 39);
  assert.equal(graph[74].inputs.latent_path, "C:/x/prev.safetensors");
  assert.deepEqual(graph[20].inputs.conditioning, ["75", 0]);
  assert.deepEqual(graph[75].inputs.context_latent, ["74", 0]);
  assert.deepEqual(graph[76].inputs.trim_frames, ["75", 1]);
  assert.deepEqual(graph[14].inputs.images, ["76", 0]);
  assert.deepEqual(graph[80].inputs.latent, ["11", 0]);
  // Without motion nothing is added and the clip is decoded as before.
  const plain = h3RefGraph({ prompt: "p", seed: 1, model: "turbo", images: ["a.png"] });
  assert.equal(plain[75], undefined);
  assert.deepEqual(plain[14].inputs.images, ["12", 0]);
});

test("motion continuation: with the latent of the clip before the clip continues its motion, without it the last picture is used", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=3:r=24", "-pix_fmt", "yuv420p", clip);
    const before = path.join(dir, "assets", "video", "clip-1.mp4");
    await mkdir(path.dirname(before), { recursive: true });
    await copyFile(clip, before);
    const picture = path.join(dir, "a.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=64x48", "-frames:v", "1", picture);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.refUnets.turbo]) }, outputs: { 15: { video: [{ filename: "r.mp4" }] } }, files: { "r.mp4": await readFile(clip) } });
    const connections = { comfyUrl: comfy.url, refUrl: comfy.url, refDir: path.join(dir, "rev0"), songyueUrl: "http://127.0.0.1:9", songyueDir: "x" };
    const call = (output) => runTool({ tool: "h3_reference_video", inputs: { prompt: "go on", reference_image_paths: [picture], first_frame_video_path: before, continue_mode: "motion", duration_seconds: 3, width: 64, height: 48, upscale: false, model: "turbo", output_path: output }, connections, deps: { ensure: async () => undefined } });
    // No latent next to the clip before: falls back to its last picture.
    const plain = await call(path.join(dir, "assets", "video", "clip-2.mp4"));
    assert.equal(plain.ok, true, JSON.stringify(plain));
    assert.match(plain.data.continue_mode, /^frame/);
    assert.equal(comfy.seen.prompts[0][75], undefined);
    // With it: the motion nodes are in the graph, the clip is 39 frames longer, the video of the clip before was uploaded.
    await writeFile(path.join(dir, "assets", "video", "clip-1.latent"), "LATENT");
    const motion = await call(path.join(dir, "assets", "video", "clip-3.mp4"));
    comfy.close();
    assert.equal(motion.ok, true, JSON.stringify(motion));
    assert.equal(motion.data.continue_mode, "motion");
    const graph = comfy.seen.prompts[1];
    assert.equal(graph[75].class_type, "MiniMaxH3MotionContext");
    assert.equal(graph[73].inputs.batch_index, 72 - 39);
    assert.equal(graph[6].inputs.length, h3Frames(3 + 39 / 24));
    assert.ok(comfy.seen.uploads.includes("clip-1.mp4"));
    assert.equal(graph[80].class_type, "MiniMaxH3MotionContextSaveLatent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("motion continuation, image to video: a clip without pictures pins the clip before, the first clip only saves its latent", async () => {
  const graph = h3Graph({ prompt: "p", seed: 1, motion: { video: "prev.mp4", total: 124, latent: "C:/x/prev.safetensors" }, saveLatent: "vsom_latents/c" });
  assert.equal(graph[6].inputs.first_frame, undefined);
  assert.deepEqual(graph[10].inputs.conditioning, ["75", 0]);
  assert.deepEqual(graph[14].inputs.images, ["76", 0]);
  assert.deepEqual(graph[80].inputs.latent, ["11", 0]);
  const first = h3Graph({ prompt: "p", seed: 1, image: "a.png", saveLatent: "vsom_latents/c" });
  assert.equal(first[75], undefined);
  assert.deepEqual(first[14].inputs.images, ["12", 0]);
  assert.equal(first[80].class_type, "MiniMaxH3MotionContextSaveLatent");
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=3:r=24", "-pix_fmt", "yuv420p", clip);
    const before = path.join(dir, "assets", "video", "clip-1.mp4");
    await mkdir(path.dirname(before), { recursive: true });
    await copyFile(clip, before);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.unet]) }, outputs: { 15: { video: [{ filename: "r.mp4" }] } }, files: { "r.mp4": await readFile(clip) } });
    const connections = { comfyUrl: "http://127.0.0.1:9", refUrl: comfy.url, refDir: path.join(dir, "rev0"), songyueUrl: "http://127.0.0.1:9", songyueDir: "x" };
    const call = (extra) => runTool({ tool: "h3_local_video", inputs: { prompt: "go on", first_frame_video_path: before, continue_mode: "motion", duration_seconds: 3, width: 64, height: 48, upscale: false, ...extra }, connections, deps: { ensure: async () => undefined } });
    await writeFile(path.join(dir, "assets", "video", "clip-1.latent"), "LATENT");
    const motion = await call({ output_path: path.join(dir, "assets", "video", "clip-2.mp4") });
    assert.equal(motion.ok, true, JSON.stringify(motion));
    assert.equal(motion.data.continue_mode, "motion");
    assert.equal(comfy.seen.prompts[0][75].class_type, "MiniMaxH3MotionContext");
    assert.equal(comfy.seen.prompts[0][6].inputs.length, h3Frames(3 + 39 / 24));
    // A first and last picture clip keeps the last-picture way (the motion way is not tried with it).
    const last = path.join(dir, "last.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=64x48", "-frames:v", "1", last);
    const fl2v = await call({ last_frame_path: last, output_path: path.join(dir, "assets", "video", "clip-3.mp4") });
    comfy.close();
    assert.equal(fl2v.ok, false, "no ComfyUI on 8190 in this test: it must not have used Rev0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("motion continuation, sound clip: the song piece starts after the pinned frames and no latent is needed", () => {
  const graph = h3Graph({ prompt: "p", seed: 1, audio: "song.wav", motion: { video: "prev.mp4", total: 124, length: 39 } });
  assert.equal(graph[19].inputs.frame_idx, 39);
  assert.equal(graph[74], undefined);
  assert.equal(graph[75].inputs.context_latent, undefined);
  assert.deepEqual(graph[75].inputs.conditioning, ["19", 0]);
  assert.equal(h3Graph({ prompt: "p", seed: 1, audio: "song.wav", image: "a.png" })[19].inputs.frame_idx, 0);
});

test("custom workflow: a missing node is named, a working graph runs with the prompt and files filled in", async () => {
  const dir = await tmp();
  try {
    const wf = {
      1: { class_type: "CLIPTextEncode", inputs: { text: "old", clip: ["9", 0] } },
      2: { class_type: "KSampler", inputs: { seed: 1, positive: ["1", 0], negative: ["1", 0] } },
      3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "w" } },
    };
    await writeFile(path.join(dir, "wf.json"), JSON.stringify(wf));
    await writeFile(path.join(dir, "bad.json"), JSON.stringify({ ...wf, 4: { class_type: "FancyNode", inputs: {} } }));
    const comfy = await fakeComfy({ nodes: { CLIPTextEncode: {}, KSampler: {}, SaveImage: {} }, outputs: { 3: { images: [{ filename: "w.png" }] } }, files: { "w.png": Buffer.from("W") } });
    const out = path.join(dir, "w.png");
    const refused = await run("comfyui_workflow", { workflow_path: path.join(dir, "bad.json"), output_path: out }, comfy);
    assert.equal(refused.code, "workflow");
    assert.match(refused.error, /설치되지 않은 노드가 필요합니다: FancyNode/);
    const done = await run("comfyui_workflow", { workflow_path: path.join(dir, "wf.json"), prompt: "new prompt", seed: 5, output_path: out }, comfy);
    comfy.close();
    assert.equal(done.ok, true, JSON.stringify(done));
    assert.equal(await readFile(out, "utf8"), "W");
    assert.equal(comfy.seen.prompts[0][1].inputs.text, "new prompt");
    assert.equal(comfy.seen.prompts[0][2].inputs.seed, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SongYUE2 music and sound effects call its API and save the file", async () => {
  const dir = await tmp();
  try {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith("/api/audio-tools/sfx")) return new Response(JSON.stringify({ dataUrl: `data:audio/wav;base64,${Buffer.from("WAVE").toString("base64")}` }), { status: 200 });
      return new Response(JSON.stringify({ output: { path: path.join(dir, "song.wav") } }), { status: 200 });
    };
    const connections = { songyueUrl: "http://song", songyueDir: "x" };
    const sfx = await runTool({ tool: "songyue_sfx", inputs: { prompt: "door creak", duration_seconds: 4, output_path: path.join(dir, "door.wav") }, connections, deps: { ensure: async () => undefined, fetchImpl } });
    assert.equal(sfx.ok, true, JSON.stringify(sfx));
    assert.equal(await readFile(path.join(dir, "door.wav"), "utf8"), "WAVE");
    assert.equal(calls[0].body.durationSeconds, 4);
    await writeFile(path.join(dir, "song.wav"), "SONG");
    const vocal = await runTool({ tool: "songyue_music", inputs: { prompt: "ballad", lyrics: "la la", output_path: path.join(dir, "song.wav") }, connections, deps: { ensure: async () => undefined, fetchImpl } });
    assert.equal(vocal.ok, true, JSON.stringify(vocal));
    assert.equal(calls[1].body.mode, "melody");
    assert.equal(calls[1].body.lyric, "la la");
    const instrumental = await runTool({ tool: "songyue_music", inputs: { prompt: "ambient", output_path: path.join(dir, "song.wav") }, connections, deps: { ensure: async () => undefined, fetchImpl } });
    assert.equal(instrumental.ok, true);
    assert.equal(calls[2].body.mode, "instrumental");
    assert.equal(calls[2].body.lyric, "[Instrumental]");
    const failing = await runTool({ tool: "songyue_sfx", inputs: { prompt: "x", output_path: path.join(dir, "x.wav") }, connections, deps: { ensure: async () => undefined, fetchImpl: async () => new Response(JSON.stringify({ error: "모델이 없습니다" }), { status: 409 }) } });
    assert.equal(failing.ok, false);
    assert.match(failing.error, /모델이 없습니다/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("speech: the engine only ever gets plain ASCII file paths, even for a project folder with Korean letters", async () => {
  const dir = await tmp();
  try {
    // A fake SongYUE2 install: the executable and the model only need to exist.
    const songyue = path.join(dir, "songyue");
    const cli = path.join(songyue, "engine", "audio.cpp", "build", "windows-cuda-release", "bin", "audiocpp_cli.exe");
    const model = path.join(songyue, "models", "audio-cpp", "audio.cpp-gguf", "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF", "qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf");
    for (const file of [cli, model]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "x");
    }
    const seen = [];
    const capture = async (_command, args) => {
      const out = args[args.indexOf("--out") + 1];
      seen.push(out);
      await writeFile(out, "RIFFfake");
      return { stdout: Buffer.alloc(0), stderr: "" };
    };
    const output = path.join(dir, "명화-속의-춤", "assets", "audio", "s5.wav");
    const result = await runTool({ tool: "qwen3_tts", inputs: { text: "손을 잡아도 될까요?", output_path: output }, connections: { songyueDir: songyue }, deps: { capture } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(await readFile(output, "utf8"), "RIFFfake");
    assert.ok(seen.length === 1 && /^[\x20-\x7e]+$/.test(seen[0]), `engine path: ${seen[0]}`);
    // The working folder is removed afterwards.
    await assert.rejects(stat(path.dirname(seen[0])));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("final_size: a clip of another size is scaled to cover and cropped to exactly that size (the RTX upscale rounds to 32)", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=1:r=24", "-pix_fmt", "yuv420p", clip);
    const first = path.join(dir, "first.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1", first);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.unet]) }, outputs: { 15: { video: [{ filename: "c.mp4" }] } }, files: { "c.mp4": await readFile(clip) } });
    const out = path.join(dir, "fit.mp4");
    const result = await run("h3_local_video", { prompt: "x", reference_image_path: first, width: 64, height: 48, duration_seconds: 3, upscale: false, final_size: [60, 32], output_path: out }, comfy);
    comfy.close();
    assert.equal(result.ok, true, JSON.stringify(result));
    const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim();
    assert.equal(size, "60,32");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { composeSheet, SHEET_SHOTS, sheetPrompt, sheetReferencePrompt } from "../server/engine/sheet.mjs";
import { referenceVideoPrompt } from "../server/prompt-maker.mjs";

test("sheet prompt: official Ref2VA sections, eight timed shots one second apart, photos only fix the face", () => {
  const prompt = sheetPrompt({ description: "a woman with long black hair in a white lace gown.", style: "photorealistic", faceReferences: 1 });
  // The same six sections the prompt maker demands for reference clips.
  assert.doesNotThrow(() => referenceVideoPrompt(prompt));
  assert.match(prompt, /<Subject 1> is the person in <Picture 1>, a woman with long black hair/);
  assert.match(prompt, /face, eye shape and facial features come from <Picture 2>/);
  assert.match(prompt, /\[Shot 2\] At 00:01\.000, the shot cuts to a full-body three-quarter front view/);
  assert.match(prompt, /\[Shot 8\] At 00:07\.000, the shot cuts to a head-and-shoulders close-up/);
  assert.equal(SHEET_SHOTS.map((shot) => shot.at).join(), "0,1,2,3,4,5,6,7");
  assert.ok(!/\[Shot 1\] At/.test(prompt), "the first shot has no timestamp");
  assert.match(sheetReferencePrompt({ description: "a woman.", style: "anime" }), /^Full-body front view of a woman\./);
});

test("sheet layout: five portrait strips above three centred squares, one clean image", async () => {
  const dir = await tmp();
  try {
    const frames = [];
    for (const [i, shot] of SHEET_SHOTS.entries()) {
      const file = path.join(dir, `${shot.id}.png`);
      ffmpeg("-f", "lavfi", "-i", `testsrc=s=320x180:r=1,hue=h=${i * 40}`, "-frames:v", "1", file);
      frames.push(file);
    }
    const output = path.join(dir, "sheet.png");
    const layout = await composeSheet({ ffmpegPath: "", frames, output, capture: (await import("../server/post.mjs")).runCapture, panelHeight: 200 });
    const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", output]).toString().trim();
    // 5 strips of 0.62 x 200 = 124 px each; two rows of 200 px.
    assert.equal(size, `${layout.width},${layout.height}`);
    assert.equal(size, "620,400");
    await assert.rejects(composeSheet({ ffmpegPath: "", frames: frames.slice(0, 3), output, capture: async () => undefined }), /8장/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("character sheet: a drawn full-body reference, one H3 clip with the sheet prompt, frames cut and laid out", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    // 8 seconds with something different in every second, so each shot's frame can be told apart.
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:d=8:r=24", "-pix_fmt", "yuv420p", clip);
    const png = path.join(dir, "ref.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=gray:s=64x36", "-frames:v", "1", png);
    const comfy = await fakeComfy({
      nodes: { UNETLoader: loader("unet_name", ["Krea\krea2_turbo_nvfp4.safetensors", H3.refUnets.turbo]), CLIPLoader: loader("clip_name", ["Qwen\qwen3vl_4b_fp8_scaled.safetensors"]), VAELoader: loader("vae_name", ["qwen\qwen_image_vae.safetensors"]) },
      outputs: { 10: { images: [{ filename: "ref.png", type: "temp" }] }, 15: { video: [{ filename: "turn.mp4" }] } },
      files: { "ref.png": await readFile(png), "turn.mp4": await readFile(clip) },
    });
    const out = path.join(dir, "assets", "images", "sheet-c1.png");
    const result = await run("character_sheet", { prompt: "a woman with long black hair in a white lace gown.", style: "photorealistic", upscale: false, model: "turbo", output_path: out }, comfy);
    comfy.close();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.artifacts.length, 3);
    for (const file of result.artifacts) await stat(file);
    assert.ok(result.artifacts[1].endsWith("sheet-c1-front.png") && result.artifacts[2].endsWith("sheet-c1-face.png"));
    // Two ComfyUI runs: the Krea picture, then the reference clip with that picture as <Picture 1>.
    assert.equal(comfy.seen.prompts.length, 2);
    const ref = comfy.seen.prompts[1];
    assert.equal(ref[6].class_type, "MiniMaxH3ReferenceToVideo");
    assert.equal(ref[6].inputs.length, 192);
    assert.match(ref[6].inputs.prompt, /^subject_definitions:/);
    assert.deepEqual(comfy.seen.uploads.length, 1);
    // The working folder is gone and only the three files are left next to the sheet.
    const left = (await (await import("node:fs/promises")).readdir(path.dirname(out))).sort();
    assert.deepEqual(left, ["sheet-c1-face.png", "sheet-c1-front.png", "sheet-c1.png"]);
    // A reference photo that does not exist is refused before anything runs.
    const missing = await run("character_sheet", { prompt: "x", reference_image_path: path.join(dir, "none.png"), output_path: out }, { url: "http://127.0.0.1:9" });
    assert.equal(missing.code, "bad_input");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deno reference graph: two stages split the sigmas, enlarge the video latent 2x and decode the second stage", () => {
  const graph = h3RefGraph({ prompt: "x", seed: 1, model: "deno", twoStage: true, seconds: 5, images: ["a.png"] });
  assert.deepEqual(graph[11].inputs.sigmas, ["50", 0]);
  assert.equal(graph[50].inputs.step, 7);
  assert.deepEqual(graph[51].inputs.av_latent, ["11", 1]);
  assert.equal(graph[52].inputs["mode.scale"], 2);
  assert.deepEqual(graph[53].inputs.sigmas, ["50", 1]);
  assert.deepEqual(graph[12].inputs.samples, ["53", 0]);
  const single = h3RefGraph({ prompt: "x", seed: 1, model: "deno", seconds: 5, images: ["a.png"] });
  assert.equal(single[50], undefined);
  assert.deepEqual(single[12].inputs.samples, ["11", 0]);
});

test("promptsOf collects the texts a graph really carries", () => {
  const graph = { 4: { class_type: "CLIPTextEncode", inputs: { text: "a cat", clip: ["2", 0] } }, 9: { class_type: "H3", inputs: { prompt: "  ", width: 5 } } };
  assert.deepEqual(promptsOf(graph), [{ node: "CLIPTextEncode", key: "text", text: "a cat" }]);
});

test("h3RefGraph: references plus a pinned first frame with the song, and a pinned last frame, feed the guider", () => {
  const graph = h3RefGraph({ prompt: "p", seed: 1, images: ["ref.png"], first: "a.png", last: "b.png", guideAudio: "s.wav" });
  assert.deepEqual(graph[62].inputs.audio, ["61", 0]);
  assert.equal(graph[62].inputs.image, undefined);
  assert.deepEqual(graph[65].inputs.image, ["60", 0]);
  assert.deepEqual(graph[65].inputs.positive, ["62", 0]);
  assert.equal(graph[64].inputs.frame_idx, -1);
  assert.deepEqual(graph[64].inputs.positive, ["65", 0]);
  assert.deepEqual(graph[20].inputs.conditioning, ["64", 0]);
  assert.deepEqual(h3RefGraph({ prompt: "p", seed: 1, images: ["ref.png"] })[20].inputs.conditioning, ["6", 0]);
});

test("H3 reference video: a piece of the song guides the clip and the clip before it gives the first picture", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=2:r=24", "-pix_fmt", "yuv420p", clip);
    const song = path.join(dir, "song.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:duration=4", song);
    const before = path.join(dir, "before.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=2:r=24", "-pix_fmt", "yuv420p", before);
    const picture = path.join(dir, "a.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=green:s=64x48", "-frames:v", "1", picture);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.refUnets.turbo]) }, outputs: { 15: { video: [{ filename: "r.mp4" }] } }, files: { "r.mp4": await readFile(clip) } });
    const out = path.join(dir, "assets", "video", "scene.mp4");
    const result = await run("h3_reference_video", { prompt: "x", reference_image_paths: [picture], audio_path: song, audio_range: [1, 1.5], first_frame_video_path: before, duration_seconds: 2, width: 64, height: 48, upscale: false, model: "turbo", output_path: out }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    // The reference picture, the picture taken from the clip before, and only the piece of the song went to ComfyUI.
    assert.deepEqual(comfy.seen.uploads, ["a.png", "scene.first.png", "scene.guide.wav"]);
    // The temporary files are gone.
    for (const name of ["scene.guide.wav", "scene.cont.png", "scene.first.png"]) await assert.rejects(stat(path.join(dir, "assets", "video", name)));
    // A wrong range or a missing clip before is refused with a sentence.
    assert.equal((await run("h3_reference_video", { prompt: "x", reference_image_paths: [picture], audio_path: song, audio_range: [10, 2], output_path: out, model: "turbo", upscale: false }, comfy)).code, "bad_input");
    assert.equal((await run("h3_reference_video", { prompt: "x", reference_image_paths: [picture], audio_path: song, audio_range: "x", output_path: out, model: "turbo", upscale: false }, comfy)).code, "bad_input");
    assert.match((await run("h3_reference_video", { prompt: "x", reference_image_paths: [picture], first_frame_video_path: path.join(dir, "none.mp4"), output_path: out }, comfy)).error, /앞 장면 영상 파일이 없습니다/);
    comfy.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Qwen image edit: models are picked, the first picture is fitted and uploaded with the others, the result is cut to the size", async () => {
  const dir = await tmp();
  // the fake server answers with a real picture so the final cut to the size works
  const served = path.join(dir, "served.png");
  ffmpeg("-f", "lavfi", "-i", "color=c=green:s=320x240", "-frames:v", "1", served);
  const comfy = await fakeComfy({
    nodes: {
      UNETLoader: loader("unet_name", ["Qwen\qwen_image_2.1_turbo_int8_convrot.safetensors", "Qwen\qwen_image_2.1_int8_convrot.safetensors"]),
      CLIPLoader: loader("clip_name", ["Qwen\qwen3vl_8b_int8_convrot.safetensors"]),
      VAELoader: loader("vae_name", ["qwen\qwen_image_2.1_vae_bf16.safetensors"]),
    },
    outputs: { 10: { images: [{ filename: "e.png", type: "temp" }] } },
    files: { "e.png": await readFile(served) },
  });
  try {
    const sheet = path.join(dir, "sheet.png");
    const face = path.join(dir, "face.png");
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", sheet);
    ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=64x64", "-frames:v", "1", face);
    const out = path.join(dir, "assets", "images", "1-2.png");
    const result = await run("comfyui_image_edit", { prompt: "<image1> turns around", reference_image_path: sheet, reference_image_paths: [face], width: 96, height: 128, output_path: out, seed: 7 }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    const graph = comfy.seen.prompts[0];
    assert.equal(graph[1].inputs.unet_name, "Qwen\qwen_image_2.1_int8_convrot.safetensors");
    assert.equal(graph[5].inputs.prompt, "<image1> turns around");
    assert.deepEqual(graph[5].inputs["images.image_2"], ["21", 0]);
    assert.deepEqual(graph[6].inputs.latent_image, ["5", 2]);
    assert.equal(graph[6].inputs.seed, 7);
    assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim(), "96,128");
    assert.equal((await run("comfyui_image_edit", { prompt: "x", output_path: out }, comfy)).code, "bad_input");
    assert.equal((await run("comfyui_image_edit", { prompt: "x", reference_image_path: path.join(dir, "none.png"), output_path: out }, comfy)).code, "bad_input");
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("H3 video: a chained clip starts from the last frame of the clip before; a missing clip before is refused", async () => {
  const dir = await tmp();
  try {
    const clip = path.join(dir, "served.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=1:r=24", "-pix_fmt", "yuv420p", clip);
    const before = path.join(dir, "before.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=64x48:d=2:r=24", "-pix_fmt", "yuv420p", before);
    const comfy = await fakeComfy({ nodes: { UNETLoader: loader("unet_name", [H3.unet]) }, outputs: { 15: { video: [{ filename: "clip.mp4" }] } }, files: { "clip.mp4": await readFile(clip) } });
    const out = path.join(dir, "assets", "video", "c2.mp4");
    const result = await run("h3_local_video", { prompt: "she waves", first_frame_video_path: before, width: 64, height: 48, duration_seconds: 3, upscale: false, output_path: out }, comfy);
    assert.equal(result.ok, true, JSON.stringify(result));
    // the picture taken from the clip before went to ComfyUI as the first picture; no temporary file is left
    assert.deepEqual(comfy.seen.uploads, ["c2.first.png"]);
    await assert.rejects(stat(path.join(dir, "assets", "video", "c2.cont.png")));
    const missing = await run("h3_local_video", { prompt: "x", first_frame_video_path: path.join(dir, "none.mp4"), output_path: out }, comfy);
    assert.equal(missing.code, "bad_input");
    comfy.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
