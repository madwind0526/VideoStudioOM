import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { concatMedia, ffmpegFor } from "../concat.mjs";
import { ffprobeFor } from "../probe.mjs";
import { runCapture } from "../post.mjs";
import { UPSCALE_IDS, UPSCALE_WORKFLOWS, defaultUpscaleModel } from "../../shared/upscale.mjs";
import { createComfy } from "./comfy.mjs";
import { convertArgs } from "./convert.mjs";
import { describeWithOllama } from "./ollama-vision.mjs";
import { characterSheetPrompt, sheetFilter, sheetFrameTimes, SHEET_SECONDS as TURNAROUND_SECONDS } from "./charsheet.mjs";
import { h3Graph, h3Frames, wanAnimateGraph, WAN_ANIMATE, h3RefGraph, H3, kreaGraph, modelUpscaleGraph, controlnetGraph, flux2EditGraph, flux2Graph, kreaDepthGraph, kreaIdentityGraph, pickControlPatch, kreaPoseGraph, pickFlux2Models, pickKreaModels, pickQwenEditModels, pickQwenImageModels, pickZimageModels, qwenImageGraph, zimageGraph, qwenEditGraph, QWENVL, qwenVlGraph, qwenVlVideoGraph, rtxGraph, rtxImageGraph, seedvr2Graph, srfpGraph, upscaleFactor, zimageUpscaleGraph } from "./graphs.mjs";
import { composeSheet, extractFrame, SHEET_SECONDS, SHEET_SHOTS, sheetPrompt, sheetReferencePrompt } from "./sheet.mjs";
import { ensureService } from "./services.mjs";
import { applyOverrides, loadApiWorkflow, missingModels, missingNodes, outputNode, patchWorkflow, WorkflowError } from "./workflow-patch.mjs";

/** A failed tool run with a code the screen can tell apart (bad_input, unavailable, failed ...). */
class ToolError extends Error {
  constructor(message, code = "failed") {
    super(message);
    this.code = code;
  }
}

const REQUIRED = {
  comfyui_krea_image: ["prompt", "output_path"],
  comfyui_t2i: ["prompt", "output_path"],
  comfyui_krea_control: ["prompt", "control_image_path", "output_path"],
  comfyui_controlnet: ["prompt", "control_image_path", "output_path"],
  comfyui_edit_model: ["prompt", "reference_image_path", "output_path"],
  comfyui_image_edit: ["prompt", "output_path"],
  media_convert: ["input_path", "output_path"],
  h3_character_sheet: ["reference_image_path", "output_path"],
  wan_animate: ["reference_image_path", "video_path", "output_path"],
  h3_still: ["prompt", "output_path"],
  h3_local_video: ["prompt", "output_path"],
  h3_reference_video: ["prompt", "output_path"],
  comfyui_workflow: ["workflow_path", "output_path"],
  character_sheet: ["prompt", "output_path"],
  image_upscale: ["image_path", "output_path"],
  describe_image: ["image_path"],
  describe_video: ["video_path"],
  qwen3_tts: ["text", "output_path"],
  songyue_music: ["prompt", "output_path"],
  songyue_sfx: ["prompt", "output_path"],
};
export const TOOL_NAMES = Object.keys(REQUIRED);

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * The sampling choices of a picture tool (steps, cfg, sampler_name, scheduler) as graph parameters, checked: a number out of
 * range or a sampler ComfyUI does not know is refused instead of being sent to the model. What is not given stays out (the graph's default).
 */
async function samplingOf(inputs, comfy) {
  const out = {};
  if (inputs.steps !== undefined) {
    const steps = Number(inputs.steps);
    if (!Number.isInteger(steps) || steps < 1 || steps > 150) throw new ToolError("스텝 수는 1~150 사이의 정수여야 합니다.", "bad_input");
    out.steps = steps;
  }
  if (inputs.cfg !== undefined) {
    const cfg = Number(inputs.cfg);
    if (!Number.isFinite(cfg) || cfg < 0 || cfg > 30) throw new ToolError("CFG는 0~30 사이여야 합니다.", "bad_input");
    out.cfg = cfg;
  }
  for (const [input, key, field] of [["sampler_name", "sampler", "sampler_name"], ["scheduler", "scheduler", "scheduler"]]) {
    if (inputs[input] === undefined) continue;
    const names = await comfy.options("KSampler", field);
    if (!names.includes(inputs[input])) throw new ToolError(`알 수 없는 ${input === "scheduler" ? "스케줄러" : "샘플러"}입니다: ${inputs[input]}`, "bad_input");
    out[key] = inputs[input];
  }
  return out;
}
const exists = (file) => stat(file).then((info) => info.isFile(), () => false);

/** Every *_path / *_paths / *_dir input must be inside one of the allowed folders. Returns the first offending key or null. */
export function outsideRoots(inputs, roots) {
  const norm = (value) => path.resolve(value).toLowerCase();
  const inside = (value) => roots.some((root) => norm(value) === norm(root) || norm(value).startsWith(norm(root) + path.sep));
  for (const [key, value] of Object.entries(inputs)) {
    if (/(_path|_dir)$/.test(key) && typeof value === "string" && value && !inside(value)) return key;
    if (key.endsWith("_paths") && Array.isArray(value) && value.some((item) => typeof item === "string" && !inside(item))) return key;
  }
  return null;
}

/** Runs one tool. Resolves with { ok, artifacts, seed, model, error, code, durationSeconds, data } and never throws. */
/** The texts a ComfyUI graph really carries (prompt boxes, H3 conditioning), so the screen can show what the model was given. */
export function promptsOf(graph) {
  const found = [];
  for (const node of Object.values(graph ?? {})) {
    for (const [key, value] of Object.entries(node?.inputs ?? {})) {
      if ((key === "text" || key === "prompt" || key === "negative_prompt") && typeof value === "string" && value.trim()) found.push({ node: node.class_type ?? "", key, text: value.slice(0, 4000) });
    }
  }
  return found;
}

export async function runTool({ tool, inputs, connections, ffmpegPath = "", signal, onProgress, deps = {} }) {
  const started = Date.now();
  const handler = HANDLERS[tool];
  if (!handler) return { ok: false, code: "unknown_tool", error: `알 수 없는 도구입니다: ${tool}`, artifacts: [] };
  const missing = REQUIRED[tool].filter((key) => inputs[key] === undefined || inputs[key] === null || inputs[key] === "");
  if (missing.length > 0) return { ok: false, code: "bad_input", error: `필수 입력이 없습니다: ${missing.join(", ")}`, artifacts: [] };
  // Every graph submitted to ComfyUI during this run; the texts of the last ones end up in the file's record.
  const sent = [];
  const context = {
    connections,
    ffmpegPath,
    signal,
    onProgress,
    comfy: (url) => {
      const comfy = (deps.comfyFor ?? createComfy)(url);
      if (typeof comfy.submit === "function") {
        const submit = comfy.submit;
        comfy.submit = (graph) => {
          sent.push(...promptsOf(graph));
          return submit.call(comfy, graph);
        };
      }
      return comfy;
    },
    ensure: deps.ensure ?? (async (name) => {
      await ensureService(name, connections, { signal });
      // One 12 GB card serves both ComfyUI servers: release the other before this one loads its models.
      for (const other of ["comfy", "ref"]) if (other !== name && connections[`${other}Url`] && connections[`${other}Url`] !== connections[`${name}Url`]) await createComfy(connections[`${other}Url`]).free();
    }),
    capture: deps.capture ?? runCapture,
    fetchImpl: deps.fetchImpl ?? fetch,
  };
  try {
    const result = await handler(inputs, context);
    return { ok: true, error: null, code: null, durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)), ...result, sentPrompts: sent.slice(0, 8) };
  } catch (error) {
    const code = error?.cancelled ? "cancelled" : error instanceof WorkflowError ? "workflow" : error instanceof ToolError ? error.code : "failed";
    return { ok: false, code, error: error?.message ?? String(error), artifacts: [], durationSeconds: Number(((Date.now() - started) / 1000).toFixed(2)) };
  }
}

async function prepareOutput(inputs) {
  const output = path.resolve(inputs.output_path);
  await mkdir(path.dirname(output), { recursive: true });
  return output;
}

/** Crop-fits a picture to width x height (no stretching): a 16:9 still squeezed into another size would look distorted. */
async function fitImage(context, source, width, height, dest) {
  await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-i", source, "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`, dest]);
  return dest;
}

/** Uploads one picture to the Rev0 ComfyUI and returns the long description QwenVL writes for it. */
async function describePicture(file, inputs, context, makeGraph = qwenVlGraph) {
  await context.ensure("ref");
  const comfy = context.comfy(context.connections.refUrl);
  if (!(await comfy.options("AILab_QwenVL", "model_name")).includes(QWENVL.model)) throw new ToolError(`ComfyUI에 QwenVL 모델(${QWENVL.model})을 고를 수 없습니다. ComfyUI-QwenVL 노드를 확인하세요.`, "unavailable");
  const seed = inputs.seed ?? randomSeed();
  const image = await comfy.upload(file, path.basename(file));
  const entry = await comfy.wait(await comfy.submit(makeGraph({ [makeGraph === qwenVlGraph ? "image" : "video"]: image, seed, maxTokens: inputs.max_tokens })), { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
  const text = String(entry.outputs?.["6"]?.text?.[0] ?? "").trim();
  if (!text) throw new ToolError("그림 설명이 비어 있습니다.", "failed");
  return { artifacts: [], seed, model: QWENVL.model, data: { provider: "comfyui-qwenvl", text, seed } };
}

/** The piece [start, length] (seconds) of an audio file as a wav of its own: the part of the song that belongs to one scene. */
async function sliceAudio(context, source, range, dest) {
  const [start, length] = Array.isArray(range) ? range.map(Number) : [NaN, NaN];
  if (!(start >= 0 && length > 0 && length <= 120)) throw new ToolError("audio_range는 [시작 초, 길이 초] 형식이어야 합니다.", "bad_input");
  await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-ss", String(start), "-t", String(length), "-i", source, "-c:a", "pcm_s16le", dest]);
  if ((await stat(dest).catch(() => null))?.size < 2000) throw new ToolError("노래의 그 구간에 소리가 없습니다(노래 길이를 넘었을 수 있습니다).", "bad_input");
  return dest;
}

/** The last picture of a clip, taken a little before its end (the very last frame can be missing when the sound is longer). */
async function lastFrame(context, clip, dest) {
  const { stdout } = await context.capture(ffprobeFor(context.ffmpegPath), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]);
  const seconds = Math.max(0, Number(stdout.toString().trim()) - 0.4);
  await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-ss", String(seconds), "-i", clip, "-frames:v", "1", dest]);
  return dest;
}

/** Number of frames of a video file (the duration times 24 when the container does not say). */
async function frameCount(context, clip) {
  const { stdout } = await context.capture(ffprobeFor(context.ffmpegPath), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=nb_frames,duration", "-of", "default=noprint_wrappers=1", clip]);
  // The fields come as name=value lines in the order ffprobe likes, not the order asked for.
  const [frames, seconds] = ["nb_frames", "duration"].map((name) => Number(new RegExp(`^${name}=(.*)$`, "m").exec(stdout.toString())?.[1]));
  return Number.isFinite(frames) && frames > 0 ? frames : Math.round((seconds || 0) * 24);
}

/** Width and height of a video file. */
async function videoSize(context, file) {
  const { stdout } = await context.capture(ffprobeFor(context.ffmpegPath), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = stdout.toString().trim().split(",").map(Number);
  return { width, height };
}

/**
 * Puts the final file in place: the clip's own sound dropped, kept, or replaced by the given audio file. With `fit`
 * ([width, height]) a clip of another size is scaled to cover that size and centre-cropped: the RTX upscale rounds its
 * result to multiples of 32 (1280x736 for a wanted 1280x704).
 */
async function finishVideo(context, source, dest, { keepAudio, audio, fit }) {
  const ffmpeg = ffmpegFor(context.ffmpegPath);
  const size = fit ? await videoSize(context, source) : null;
  if (fit && (size.width !== fit[0] || size.height !== fit[1])) {
    const sound = audio ? ["-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-shortest"] : ["-map", "0:v:0", ...(keepAudio ? ["-map", "0:a:0?", "-c:a", "copy"] : ["-an"])];
    await context.capture(ffmpeg, ["-loglevel", "error", "-y", "-i", source, ...sound, "-vf", `scale=${fit[0]}:${fit[1]}:force_original_aspect_ratio=increase:flags=lanczos,crop=${fit[0]}:${fit[1]}`, "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", dest]);
    return;
  }
  if (audio) {
    // The given audio replaces whatever H3 generated; -shortest trims it to the clip length.
    await context.capture(ffmpeg, ["-loglevel", "error", "-y", "-i", source, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", dest]);
  } else {
    await context.capture(ffmpeg, ["-loglevel", "error", "-y", "-i", source, "-c:v", "copy", ...(keepAudio ? ["-c:a", "copy"] : ["-an"]), dest]);
  }
}

/** The RTX 2-pass upscale on the second (Rev0) ComfyUI. The main server is busy while the node runs, so waiting is patient. */
async function rtxUpscale(context, source, dest, scale) {
  await context.ensure("ref");
  const rtx = context.comfy(context.connections.refUrl);
  const name = await rtx.upload(source, path.basename(source));
  const prefix = `RTXvsom_${path.basename(source, path.extname(source))}`;
  const promptId = await rtx.submit(rtxGraph({ video: name, scale, prefix }));
  const entry = await rtx.wait(promptId, { timeoutMs: 900_000, signal: context.signal, pollMs: 3000 });
  const item = (entry.outputs?.["3"]?.gifs ?? [])[0];
  if (!item) throw new ToolError("RTX 확대의 결과 파일이 없습니다.");
  // The Rev0 ComfyUI writes into a known folder; copying is faster and does not depend on its web server being free.
  const local = path.join(context.connections.refDir, "ComfyUI", "output", item.subfolder ?? "", item.filename);
  if (await exists(local)) await copyFile(local, dest);
  else await rtx.download(item, dest);
}

const cleanup = (files) => Promise.all(files.map((file) => rm(file, { force: true })));

/** The extra LoRAs of a video job ({name, strength}), checked against the ones ComfyUI has. */
async function videoLoras(comfy, inputs) {
  const chosen = (Array.isArray(inputs.loras) ? inputs.loras : []).filter((lora) => lora?.name);
  if (chosen.length === 0) return [];
  const known = await comfy.options("LoraLoaderModelOnly", "lora_name");
  for (const lora of chosen) if (!known.includes(lora.name)) throw new ToolError(`ComfyUI에 LoRA가 없습니다: ${lora.name}`, "unavailable");
  return chosen.map((lora) => ({ name: lora.name, strength: Number(lora.strength ?? 1) }));
}

async function h3Models(comfy, wanted) {
  const unets = await comfy.options("UNETLoader", "unet_name");
  const missing = wanted.filter((name) => !unets.includes(name));
  if (missing.length > 0) throw new ToolError(`ComfyUI에 H3 모델이 없습니다: ${missing.join(", ")}`, "unavailable");
}

const HANDLERS = {
  /** A long English description of a picture from the QwenVL vision model (Rev0 server). Returns data.text; makes no file. */
  async describe_image(inputs, context) {
    if (!(await exists(inputs.image_path))) throw new ToolError(`그림 파일이 없습니다: ${inputs.image_path}`, "bad_input");
    // A clip stands for its last picture: the picture the next clip of a scene chain starts from.
    const temp = /\.(mp4|mov|webm|mkv)$/i.test(inputs.image_path) ? path.join(await mkdtemp(path.join(os.tmpdir(), "vsom-desc-")), "last.png") : null;
    try {
      return await describePicture(temp ? await lastFrame(context, inputs.image_path, temp) : inputs.image_path, inputs, context);
    } finally {
      if (temp) await rm(path.dirname(temp), { recursive: true, force: true });
    }
  },

  /** A summary of a whole clip (what happens, how the camera moves) from the QwenVL vision model. Returns data.text; makes no file. */
  async describe_video(inputs, context) {
    if (!(await exists(inputs.video_path))) throw new ToolError(`영상 파일이 없습니다: ${inputs.video_path}`, "bad_input");
    return describePicture(inputs.video_path, inputs, context, qwenVlVideoGraph);
  },

  /**
   * Enlarges a picture (scale 1-4, 2 by default) and saves it as `output_path`. `workflow` is one of shared/upscale.mjs
   * ("rtx" by default) and `model` the choice of that workflow (its default when empty).
   */
  async image_upscale(inputs, context) {
    if (!(await exists(inputs.image_path))) throw new ToolError(`그림 파일이 없습니다: ${inputs.image_path}`, "bad_input");
    const workflow = inputs.workflow ?? "rtx";
    if (!UPSCALE_IDS.includes(workflow)) throw new ToolError(`알 수 없는 확대 워크플로입니다: ${workflow}`, "bad_input");
    const scale = Math.min(4, Math.max(1, Number(inputs.scale ?? 2) || 2));
    const output = await prepareOutput(inputs);
    const stem = path.basename(inputs.image_path, path.extname(inputs.image_path));
    const options = { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress };
    if (workflow === "rtx") {
      await context.ensure("ref");
      const rtx = context.comfy(context.connections.refUrl);
      const name = await rtx.upload(inputs.image_path, path.basename(inputs.image_path));
      await rtx.generate(rtxImageGraph({ image: name, scale, prefix: `RTXvsom_${stem}` }), "3", output, options);
      return { artifacts: [output], model: "rtx-2pass", data: { provider: "comfyui-rtx", output, scale } };
    }
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    const entry = UPSCALE_WORKFLOWS.find((item) => item.id === workflow);
    const names = await comfy.options(entry.node, entry.field);
    if (names.length === 0) throw new ToolError(`${entry.label}에 필요한 노드나 모델이 ComfyUI에 보이지 않습니다.`, "unavailable");
    const model = inputs.model || defaultUpscaleModel(workflow, names);
    if (!names.includes(model)) throw new ToolError(`${entry.modelLabel}을(를) 찾을 수 없습니다: ${model}`, "bad_input");
    const image = await comfy.upload(inputs.image_path, path.basename(inputs.image_path));
    const seed = inputs.seed ?? randomSeed();
    let graph;
    let save;
    if (workflow === "srfp") [graph, save] = [srfpGraph({ image, mode: model, scale, prefix: `SRFPvsom_${stem}` }), "3"];
    else if (workflow === "model") [graph, save] = [modelUpscaleGraph({ image, model, scale, prefix: `UPvsom_${stem}` }), "5"];
    else if (workflow === "seedvr2") {
      // SeedVR2 takes the short edge of the result, not a factor.
      const { width, height } = await videoSize(context, inputs.image_path);
      [graph, save] = [seedvr2Graph({ image, dit: model, resolution: Math.round(Math.min(width, height) * scale), seed, prefix: `SeedVR2vsom_${stem}` }), "5"];
    } else {
      const models = pickZimageModels({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") });
      if (!models) throw new ToolError("Z-Image Turbo 모델 파일(z_image_turbo, qwen_3_4b, ae)이 ComfyUI에 보이지 않습니다.", "unavailable");
      [graph, save] = [zimageUpscaleGraph({ image, upscaler: model, factor: upscaleFactor(model), scale, seed, prefix: `ZIvsom_${stem}`, models }), "9"];
    }
    await comfy.generate(graph, save, output, options);
    return { artifacts: [output], model, data: { provider: `comfyui-${workflow}`, output, scale, model } };
  },

  async comfyui_krea_image(inputs, context) {
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    const models = pickKreaModels({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") });
    if (!models) throw new ToolError("Krea 2 Turbo 모델 파일(unet, qwen3vl_4b, qwen_image_vae)이 ComfyUI에 보이지 않습니다.", "unavailable");
    const seed = inputs.seed ?? randomSeed();
    const graph = applyOverrides(kreaGraph({ prompt: inputs.prompt, width: inputs.width ?? 1536, height: inputs.height ?? 864, ...(await samplingOf(inputs, comfy)), seed, models }), inputs.overrides);
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "10", dest, { timeoutMs: 600_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: models.unet, data: { provider: "comfyui-krea", output: dest, seed, model: models.unet } };
  },

  /**
   * Picture edit with a model other than Qwen: `model` is "krea2-identity" (Krea 2 + Identity Edit LoRA, 1-2 pictures) or
   * "flux2-klein" (up to 4 pictures). `reference_image_path` is the first picture (the one that is edited), `reference_image_paths`
   * the others; the result has the shape of the first picture unless `width` and `height` are given.
   */
  async comfyui_edit_model(inputs, context) {
    const kinds = {
      "krea2-identity": { label: "Krea 2 + Identity Edit", max: 2, nodes: ["Krea2EditModelPatch", "Krea2EditGroundedEncode"] },
      "flux2-klein": { label: "Flux.2 klein", max: 4, nodes: ["ReferenceLatent", "Flux2Scheduler"] },
    };
    const kind = kinds[inputs.model];
    if (!kind) throw new ToolError(`알 수 없는 모델입니다: ${inputs.model}`, "bad_input");
    const files = [inputs.reference_image_path, ...(inputs.reference_image_paths ?? [])].filter(Boolean);
    if (files.length === 0) throw new ToolError("편집할 그림이 필요합니다.", "bad_input");
    if (files.length > kind.max) throw new ToolError(`${kind.label}은(는) 그림을 ${kind.max}장까지 받습니다.`, "bad_input");
    for (const file of files) if (!(await exists(file))) throw new ToolError(`그림 파일이 없습니다: ${file}`, "bad_input");
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    for (const node of kind.nodes) if (!(await comfy.nodeInfo(node))) throw new ToolError(`${kind.label}에 필요한 노드(${node})가 ComfyUI에 없습니다.`, "unavailable");
    const lists = { unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") };
    const seed = inputs.seed ?? randomSeed();
    const sampling = await samplingOf(inputs, comfy);
    const names = [];
    for (const file of files) names.push(await comfy.upload(file, path.basename(file)));
    const size = inputs.width && inputs.height ? { width: Number(inputs.width), height: Number(inputs.height) } : {};
    let graph;
    if (inputs.model === "krea2-identity") {
      const models = pickKreaModels(lists);
      const lora = (await comfy.options("LoraLoaderModelOnly", "lora_name")).find((name) => /krea2_identity_edit_v1_2\.safetensors$/i.test(name));
      if (!models || !lora) throw new ToolError("Krea 2 Turbo 모델 또는 Identity Edit LoRA 파일이 ComfyUI에 보이지 않습니다.", "unavailable");
      graph = kreaIdentityGraph({ images: names, prompt: inputs.prompt, ...size, ...sampling, seed, models, lora, loras: await videoLoras(comfy, inputs) });
    } else {
      const models = pickFlux2Models(lists);
      if (!models) throw new ToolError("Flux.2 klein 모델 파일이 ComfyUI에 보이지 않습니다.", "unavailable");
      graph = flux2EditGraph({ images: names, prompt: inputs.prompt, ...size, ...sampling, seed, models, loras: await videoLoras(comfy, inputs) });
    }
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "30", dest, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: inputs.model, data: { provider: `comfyui-${inputs.model}`, output: dest, seed, pictures: files.length } };
  },

  /**
   * Krea 2 Turbo drawn along a picture: `control` "pose" (the DWPose skeleton of the picture) or "depth" (its Depth Anything map),
   * `control_image_path` the picture. The pose and depth ControlNet-LoRAs and their ComfyUI nodes must be installed.
   */
  async comfyui_krea_control(inputs, context) {
    const kinds = {
      pose: { label: "Krea 2 + Pose", lora: /krea2_turbo_openpose_controlnet/i, nodes: ["TextEncodeKrea2OstrisEdit", "Krea2OstrisEditModelPatch", "DWPreprocessor"], graph: kreaPoseGraph },
      depth: { label: "Krea 2 + Depth", lora: /krea2_depth_control_lora/i, nodes: ["Krea2ControlLoRALoader", "Krea2ControlApply", "Krea2ControlImageEncode", "DepthAnythingV2Preprocessor"], graph: kreaDepthGraph },
    };
    const kind = kinds[inputs.control];
    if (!kind) throw new ToolError(`알 수 없는 제어 방식입니다: ${inputs.control}`, "bad_input");
    if (!(await exists(inputs.control_image_path))) throw new ToolError(`제어 그림 파일이 없습니다: ${inputs.control_image_path}`, "bad_input");
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    for (const node of kind.nodes) if (!(await comfy.nodeInfo(node))) throw new ToolError(`${kind.label}에 필요한 노드(${node})가 ComfyUI에 없습니다. 노드 모음을 설치하고 ComfyUI를 다시 시작하세요.`, "unavailable");
    const models = pickKreaModels({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") });
    if (!models) throw new ToolError("Krea 2 Turbo 모델 파일(unet, qwen3vl_4b, qwen_image_vae)이 ComfyUI에 보이지 않습니다.", "unavailable");
    const lora = (await comfy.options("LoraLoaderModelOnly", "lora_name")).find((name) => kind.lora.test(name));
    if (!lora) throw new ToolError(`${kind.label} LoRA 파일이 ComfyUI에 보이지 않습니다.`, "unavailable");
    const seed = inputs.seed ?? randomSeed();
    const image = await comfy.upload(inputs.control_image_path, path.basename(inputs.control_image_path));
    const graph = kind.graph({ image, prompt: inputs.prompt, ...(await samplingOf(inputs, comfy)), seed, models, lora });
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "30", dest, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: lora, data: { provider: `comfyui-krea-${inputs.control}`, output: dest, seed, model: models.unet, lora } };
  },

  /**
   * Z-Image Turbo or Qwen Image 2512 drawn along a control map of a picture: `model` is "zimage-turbo" or "qwen-image-2512",
   * `control` "pose" (DWPose skeleton), "depth" or "canny" (Qwen: depth and canny only). The picture has the shape of the control picture.
   */
  async comfyui_controlnet(inputs, context) {
    const families = {
      "zimage-turbo": { family: "zimage", label: "Z-Image Turbo", pick: pickZimageModels },
      "qwen-image-2512": { family: "qwen", label: "Qwen Image 2512", pick: pickQwenImageModels },
    };
    const kind = families[inputs.model];
    if (!kind) throw new ToolError(`알 수 없는 모델입니다: ${inputs.model}`, "bad_input");
    if (!["pose", "depth", "canny"].includes(inputs.control)) throw new ToolError(`알 수 없는 제어 방식입니다: ${inputs.control}`, "bad_input");
    if (!(await exists(inputs.control_image_path))) throw new ToolError(`제어 그림 파일이 없습니다: ${inputs.control_image_path}`, "bad_input");
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    const nodes = ["ModelPatchLoader", kind.family === "qwen" ? "QwenImageDiffsynthControlnet" : "ZImageFunControlnet", { pose: "DWPreprocessor", depth: "DepthAnythingV2Preprocessor", canny: "Canny" }[inputs.control]];
    for (const node of nodes) if (!(await comfy.nodeInfo(node))) throw new ToolError(`${kind.label} ControlNet에 필요한 노드(${node})가 ComfyUI에 없습니다.`, "unavailable");
    const models = kind.pick({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name"), loras: await comfy.options("LoraLoaderModelOnly", "lora_name") });
    if (!models) throw new ToolError(`${kind.label} 모델 파일이 ComfyUI에 보이지 않습니다.`, "unavailable");
    const patch = pickControlPatch(await comfy.options("ModelPatchLoader", "name"), kind.family, inputs.control);
    if (!patch) throw new ToolError(`${kind.label}에는 ${inputs.control} ControlNet 파일이 ComfyUI에 보이지 않습니다.`, "unavailable");
    const seed = inputs.seed ?? randomSeed();
    const image = await comfy.upload(inputs.control_image_path, path.basename(inputs.control_image_path));
    const graph = controlnetGraph({ family: kind.family, control: inputs.control, image, prompt: inputs.prompt, patch, ...(inputs.strength !== undefined ? { strength: Number(inputs.strength) } : {}), ...(await samplingOf(inputs, comfy)), seed, models });
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "10", dest, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: patch, data: { provider: `comfyui-${inputs.model}-${inputs.control}`, output: dest, seed, model: models.unet, controlnet: patch } };
  },

  /**
   * Text to image with another model than Krea: `model` is "zimage-turbo", "qwen-image-2512" (Lightning 4 steps) or "flux2-klein".
   * Steps, cfg, sampler_name and scheduler are the user's choices (each model has its own defaults); the result is PreviewImage "10".
   */
  async comfyui_t2i(inputs, context) {
    const kinds = {
      "zimage-turbo": { label: "Z-Image Turbo", pick: pickZimageModels, graph: zimageGraph, size: [1024, 1024] },
      "qwen-image-2512": { label: "Qwen Image 2512", pick: pickQwenImageModels, graph: qwenImageGraph, size: [1328, 1328] },
      "flux2-klein": { label: "Flux.2 klein", pick: pickFlux2Models, graph: flux2Graph, size: [1024, 1024] },
    };
    const kind = kinds[inputs.model];
    if (!kind) throw new ToolError(`알 수 없는 모델입니다: ${inputs.model}`, "bad_input");
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    const models = kind.pick({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name"), loras: await comfy.options("LoraLoaderModelOnly", "lora_name") });
    if (!models) throw new ToolError(`${kind.label} 모델 파일이 ComfyUI에 보이지 않습니다.`, "unavailable");
    const seed = inputs.seed ?? randomSeed();
    const graph = kind.graph({ prompt: inputs.prompt, width: inputs.width ?? kind.size[0], height: inputs.height ?? kind.size[1], ...(await samplingOf(inputs, comfy)), seed, models });
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "10", dest, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: models.unet, data: { provider: `comfyui-${inputs.model}`, output: dest, seed, model: models.unet } };
  },

  /**
   * Edits a picture with Qwen Image 2.1 from a prompt and reference pictures (the first one is the picture to edit).
   * With `blank_canvas` (and width, height) the picture to edit is an empty grey canvas of that size and every given picture
   * is a reference: a new picture of the people in them (the prompt names the canvas <image1>, the references <image2>, ...).
   */
  async comfyui_image_edit(inputs, context) {
    const refs = [inputs.reference_image_path, ...(inputs.reference_image_paths ?? [])].filter(Boolean);
    if (refs.length === 0) throw new ToolError("편집할 그림(reference_image_path)이 필요합니다.", "bad_input");
    const blank = inputs.blank_canvas === true;
    if (blank && !(inputs.width && inputs.height)) throw new ToolError("빈 캔버스에는 width와 height가 필요합니다.", "bad_input");
    if (refs.length + (blank ? 1 : 0) > 10) throw new ToolError("그림은 캔버스를 포함해 10장까지입니다.", "bad_input");
    for (const file of refs) if (!(await exists(file))) throw new ToolError(`그림 파일이 없습니다: ${file}`, "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const temps = [`${stem}.edit.png`, `${stem}.base.png`];
    const seed = inputs.seed ?? randomSeed();
    try {
      await context.ensure("comfy");
      const comfy = context.comfy(context.connections.comfyUrl);
      const models = pickQwenEditModels({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") });
      if (!models) throw new ToolError("Qwen Image 2.1 모델 파일(unet, qwen3vl_8b, qwen_image_2.1_vae)이 ComfyUI에 보이지 않습니다.", "unavailable");
      const size = inputs.width && inputs.height ? [Number(inputs.width), Number(inputs.height)] : null;
      // The result has the shape of the first picture: give it the wanted shape up front.
      if (blank) await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=0x808080:s=${size[0]}x${size[1]}`, "-frames:v", "1", temps[1]]);
      const files = blank ? [temps[1], ...refs] : size ? [await fitImage(context, refs[0], size[0], size[1], temps[1]), ...refs.slice(1)] : refs;
      const names = [];
      for (const file of files) names.push(await comfy.upload(file, path.basename(file)));
      // The model entry "Qwen + Krea LoRA" sends its LoRA as `lora` (file name as ComfyUI lists it) and optionally `lora_strength`.
      const own = inputs.lora ? [{ name: inputs.lora, strength: Number(inputs.lora_strength ?? 1) }] : [];
      if (own.length > 0 && !(await comfy.options("LoraLoaderModelOnly", "lora_name")).includes(own[0].name)) throw new ToolError(`LoRA 파일이 ComfyUI에 보이지 않습니다: ${own[0].name}`, "unavailable");
      // The LoRAs chosen on the screen (`loras`) come after the one of the model entry.
      const loras = [...own, ...(await videoLoras(comfy, inputs))];
      const graph = applyOverrides(qwenEditGraph({ prompt: inputs.prompt, negative: inputs.negative_prompt ?? "", images: names, seed, ...(await samplingOf(inputs, comfy)), models, loras }), inputs.overrides);
      await comfy.generate(graph, "10", size ? temps[0] : output, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
      if (size) await fitImage(context, temps[0], size[0], size[1], output);
    } finally {
      await cleanup(temps);
    }
    return { artifacts: [output], seed, model: "qwen-image-2.1-edit", data: { provider: "comfyui-qwen-edit", output, seed, references: refs.length } };
  },

  /** Changes the file type of a picture (png, jpg, webp) or a video (mp4, webm, mov, gif) with ffmpeg; `kind` is "image" or "video". */
  async media_convert(inputs, context) {
    if (!(await exists(inputs.input_path))) throw new ToolError(`원본 파일이 없습니다: ${inputs.input_path}`, "bad_input");
    const output = await prepareOutput(inputs);
    let args;
    try {
      args = convertArgs({ kind: inputs.kind, format: inputs.format, quality: inputs.quality, input: inputs.input_path, output });
    } catch (error) {
      throw new ToolError(error.message, "bad_input");
    }
    await context.capture(ffmpegFor(context.ffmpegPath), args);
    return { artifacts: [output], model: `ffmpeg-${inputs.format}`, data: { provider: "ffmpeg", output, format: inputs.format } };
  },

  /**
   * A character sheet from one picture: an H3 reference clip of jump cuts (back, sides, three-quarter views, close-ups) of which the
   * middle picture of every shot goes into a grid together with the reference picture (see charsheet.mjs). `style` is optional.
   */
  async h3_character_sheet(inputs, context) {
    const ref = inputs.reference_image_path;
    if (!(await exists(ref))) throw new ToolError(`참조 그림 파일이 없습니다: ${ref}`, "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const clip = `${stem}.sheet.mp4`;
    const times = sheetFrameTimes();
    const frames = times.map((_, index) => `${stem}.shot${index + 1}.png`);
    const seed = inputs.seed ?? randomSeed();
    try {
      await HANDLERS.h3_reference_video({ prompt: characterSheetPrompt({ style: inputs.style ?? "" }), reference_image_paths: [ref], width: 544, height: 736, duration_seconds: TURNAROUND_SECONDS, seed, output_path: clip }, context);
      for (const [index, time] of times.entries()) await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-ss", time.toFixed(3), "-i", clip, "-frames:v", "1", frames[index]]);
      const { width, height } = await videoSize(context, clip);
      const args = ["-loglevel", "error", "-y", "-i", ref, ...frames.flatMap((frame) => ["-i", frame]), "-filter_complex", sheetFilter(frames.length + 1, [width, height]), "-map", "[out]", "-frames:v", "1", output];
      await context.capture(ffmpegFor(context.ffmpegPath), args);
    } finally {
      await Promise.all([clip, ...frames].map((file) => rm(file, { force: true })));
    }
    return { artifacts: [output], seed, model: "minimax-h3-character-sheet", data: { provider: "minimax-h3-character-sheet", output, seed, shots: frames.length } };
  },

  /**
   * Wan Animate 2: the person of `reference_image_path` moves like the person of `video_path` (motion transfer). `appearance`
   * describes the picture and `motion` the movement (both optional, English works best). The clip keeps the length and the sound
   * of the driving video; `megapixels` (default 0.5) sets the size.
   */
  async wan_animate(inputs, context) {
    for (const [label, file] of [["그림", inputs.reference_image_path], ["참고 영상", inputs.video_path]]) {
      if (!(await exists(file))) throw new ToolError(`${label} 파일이 없습니다: ${file}`, "bad_input");
    }
    const output = await prepareOutput(inputs);
    const seed = inputs.seed ?? randomSeed();
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    if (!(await comfy.options("UNETLoader", "unet_name")).includes(WAN_ANIMATE.unet)) throw new ToolError(`Wan Animate 2 모델(${WAN_ANIMATE.unet})이 ComfyUI에 보이지 않습니다.`, "unavailable");
    if ((await comfy.nodeInfo("ToobusyWanAnimate2LongSampler")) === null) throw new ToolError("toobusy 노드 팩(ToobusyWanAnimate2LongSampler)이 ComfyUI에 없습니다.", "unavailable");
    // No description given: a local Ollama vision model describes the picture (as the LLM loader of the Deno workflow does); it is unloaded before the GPU work starts.
    let appearance = String(inputs.appearance ?? "").trim();
    if (!appearance) appearance = await describeWithOllama(inputs.reference_image_path);
    // No size given: the size of the source clip (0.2 to 1.5 megapixels, the range the form used to offer).
    let megapixels = Number(inputs.megapixels);
    if (!(megapixels > 0)) {
      const source = await videoSize(context, inputs.video_path);
      megapixels = Math.min(1.5, Math.max(0.2, Math.round((source.width * source.height) / 1e5) / 10));
    }
    const [image, video] = [await comfy.upload(inputs.reference_image_path, path.basename(inputs.reference_image_path)), await comfy.upload(inputs.video_path, path.basename(inputs.video_path))];
    const graph = wanAnimateGraph({
      image,
      video,
      appearance: appearance || "The character of the reference image, in the same clothes and the same place.",
      motion: String(inputs.motion ?? "").trim() || "The character moves exactly like the person in the driving video.",
      seed,
      megapixels,
      framesPerSampler: Number(inputs.frames_per_sampler ?? 81),
    });
    await comfy.generate(graph, "22", output, { timeoutMs: 3_000_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [output], seed, model: WAN_ANIMATE.unet, data: { provider: "comfyui-wan-animate", output, seed } };
  },

  /**
   * A picture made by MiniMax H3: a text-to-video of the shortest length (5 frames) of which the first frame is kept. The clip is a
   * temporary file next to the output and is removed again.
   */
  async h3_still(inputs, context) {
    const output = await prepareOutput(inputs);
    const clip = `${output.slice(0, -path.extname(output).length)}.still.mp4`;
    const seed = inputs.seed ?? randomSeed();
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    await h3Models(comfy, [H3.unet]);
    try {
      const graph = h3Graph({ prompt: inputs.prompt, width: Number(inputs.width ?? 1024), height: Number(inputs.height ?? 576), seconds: 0.1, seed });
      await comfy.generate(graph, "15", clip, { timeoutMs: 900_000, signal: context.signal, onProgress: context.onProgress });
      await context.capture(ffmpegFor(context.ffmpegPath), ["-loglevel", "error", "-y", "-i", clip, "-frames:v", "1", output]);
    } finally {
      await rm(clip, { force: true });
    }
    return { artifacts: [output], seed, model: H3.unet, data: { provider: "comfyui-h3-still", output, seed, frames: h3Frames(0.1) } };
  },

  async h3_local_video(inputs, context) {
    let image = inputs.reference_image_path;
    // The clip before this one in a chain: its last picture is the first picture here.
    const continued = inputs.first_frame_video_path;
    const last = inputs.last_frame_path;
    let audio = inputs.audio_path;
    if (!image && continued && !(await exists(continued))) throw new ToolError("앞 클립(first_frame_video_path) 파일이 없습니다. 앞 클립을 먼저 만드세요.", "bad_input");
    // No first picture and no clip before: a plain text-to-video clip.
    if (image && !(await exists(image))) throw new ToolError("첫 이미지(reference_image_path) 파일이 없습니다.", "bad_input");
    if (last && !(await exists(last))) throw new ToolError("마지막 이미지(last_frame_path) 파일이 없습니다.", "bad_input");
    if (audio && !(await exists(audio))) throw new ToolError("오디오(audio_path) 파일이 없습니다.", "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const [width, height] = [Number(inputs.width ?? 736), Number(inputs.height ?? 416)];
    const upscale = inputs.upscale ?? true;
    const seed = inputs.seed ?? randomSeed();
    const temps = [`${stem}.lo.mp4`, `${stem}.up.mp4`, `${stem}.first.png`, `${stem}.last.png`, `${stem}.piece.wav`, `${stem}.cont.png`];
    // Motion continuation (settings: video.continueMode "motion"): see h3_reference_video. The latent of every clip is saved next to it as
    // <clip>.latent. A clip with sound (S2V) pins only the pictures of the clip before: its own sound is the song piece, placed after them.
    // shortcut: a clip with a last picture (FL2V) keeps the last-picture way; with the motion context its end picture made the clip jump to another shot (tested), upgrade when that is understood.
    const wantsMotion = inputs.continue_mode === "motion" && !last;
    const previous = continued ? `${continued.slice(0, -path.extname(continued).length)}.latent` : null;
    const motionOn = wantsMotion && Boolean(continued) && !inputs.reference_image_path && (Boolean(audio) || (await exists(previous)));
    const tag = `${path.basename(stem).replace(/[^\w-]/g, "_").slice(0, 40)}_${Date.now().toString(36)}`;
    const latentDir = path.join(context.connections.refDir, "ComfyUI", "output", "vsom_latents");
    const latents = [path.join(latentDir, `prev_${tag}.safetensors`), path.join(latentDir, `${tag}_00001.safetensors`)];
    try {
      // With audio_range only that piece of the audio file is used (a scene's part of the song).
      if (audio && inputs.audio_range) audio = await sliceAudio(context, audio, inputs.audio_range, temps[4]);
      if (!image && continued && !motionOn) image = await lastFrame(context, continued, temps[5]);
      // The motion nodes only exist on the Rev0 ComfyUI; the same models and the turbo LoRA are there.
      const server = wantsMotion ? "ref" : "comfy";
      await context.ensure(server);
      const comfy = context.comfy(context.connections[`${server}Url`]);
      await h3Models(comfy, [H3.unet]);
      let [firstFile, lastFile] = [image, last];
      if (inputs.fit_images ?? true) {
        if (image) firstFile = await fitImage(context, image, width, height, temps[2]);
        if (last) lastFile = await fitImage(context, last, width, height, temps[3]);
      }
      const upload = (file) => (file ? comfy.upload(file, path.basename(file)) : null);
      let motion;
      if (motionOn) {
        await mkdir(latentDir, { recursive: true });
        if (!audio) await copyFile(previous, latents[0]);
        motion = { video: await comfy.upload(continued, path.basename(continued)), total: await frameCount(context, continued), latent: audio ? undefined : latents[0], length: 39 };
      }
      const graph = applyOverrides(
        // The pinned frames are cut off again, so the clip is made that much longer to keep the length that was asked for.
        h3Graph({ prompt: inputs.prompt, width, height, seconds: Number(inputs.duration_seconds ?? 5) + (motion ? motion.length / 24 : 0), steps: Number(inputs.steps ?? 4), seed, image: await upload(firstFile), last: await upload(lastFile), audio: await upload(audio), motion, saveLatent: wantsMotion ? `vsom_latents/${tag}` : undefined, loras: await videoLoras(comfy, inputs) }),
        inputs.overrides,
      );
      await comfy.generate(graph, "15", temps[0], { timeoutMs: 3_000_000, signal: context.signal, onProgress: context.onProgress });
      if (wantsMotion) await copyFile(latents[1], `${stem}.latent`).catch(() => undefined);
      let clip = temps[0];
      if (upscale) {
        await rtxUpscale(context, clip, temps[1], Number(inputs.upscale_scale ?? 2.6));
        clip = temps[1];
      }
      await finishVideo(context, clip, output, { keepAudio: Boolean(inputs.keep_audio), audio: (inputs.mux_audio ?? true) ? audio : null, fit: Array.isArray(inputs.final_size) ? inputs.final_size.map(Number) : null });
    } finally {
      await cleanup([...temps, ...latents]);
    }
    const model = `minimax-h3-turbo-4step${upscale ? "+rtx-2pass" : ""}`;
    return { artifacts: [output], seed, model, data: { provider: "minimax-h3-local", output: output, upscaled: upscale, seed, last_frame: Boolean(last), audio_guided: Boolean(audio), continue_mode: wantsMotion ? (motionOn ? "motion" : continued ? "frame (no latent of the clip before)" : "motion (first clip)") : "frame" } };
  },

  async h3_reference_video(inputs, context) {
    const images = inputs.reference_image_paths ?? [];
    const video = inputs.reference_video_path;
    const audio = inputs.reference_audio_path;
    let [first, last, guide] = [inputs.first_frame_path, inputs.last_frame_path, inputs.audio_path];
    // The clip before this one in a scene chain: its last picture becomes the first picture here.
    const continued = inputs.first_frame_video_path;
    // A first or last picture (or the clip before) is enough too; `text_only` asks for a clip drawn from the prompt alone.
    if (images.length === 0 && !video && !audio && !first && !last && !continued && !inputs.text_only) throw new ToolError("참조 이미지, 영상, 오디오 중 하나는 필요합니다.", "bad_input");
    if (images.length > 9) throw new ToolError("참조 이미지는 9장까지입니다.", "bad_input");
    for (const [label, file] of [...images.map((item) => ["참조 이미지", item]), ["참조 영상", video], ["참조 오디오", audio], ["첫 이미지", first], ["마지막 이미지", last], ["오디오", guide], ["앞 장면 영상", continued]]) {
      if (file && !(await exists(file))) throw new ToolError(`${label} 파일이 없습니다: ${file}`, "bad_input");
    }
    const model = inputs.model ?? "deno";
    if (!(model in H3.refUnets)) throw new ToolError("model은 turbo, official, deno 중 하나여야 합니다.", "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    // tiled: the Deno 16GB Tiled Sampler workflow (Pika LoRA, latent upscale, last step in tiles); it always runs in two stages.
    const tiled = model === "deno" && Boolean(inputs.tiled);
    const twoStage = tiled || (model === "deno" && (inputs.two_stage ?? true));
    // Two-stage: width and height are the FINAL size; the first stage runs at half of it (multiples of 32) and the latent is enlarged 2x.
    const half = (value) => Math.max(32, Math.round(Number(value) / 2 / 32) * 32);
    // A clip made from a reference video (face swap) takes its length and its shape from that video, unless the caller gives them.
    const source = video && inputs.fit_video_size ? await videoSize(context, video) : null;
    // With the shape of the source video: the same number of pixels, the ratio of the source (multiples of 32).
    const shape = (w, h) => (source ? [Math.max(64, Math.round(Math.sqrt((w * h * source.width) / source.height) / 32) * 32), Math.max(64, Math.round(Math.sqrt((w * h * source.height) / source.width) / 32) * 32)] : [w, h]);
    const [width, height] = shape(Number(inputs.width ?? 736), Number(inputs.height ?? 416));
    const seconds = inputs.duration_seconds !== undefined ? Number(inputs.duration_seconds) : video ? Math.min(15, Math.max(2, (await frameCount(context, video)) / 24)) : 5;
    const finalSize = Array.isArray(inputs.final_size) ? shape(...inputs.final_size.map(Number)) : null;
    const upscale = inputs.upscale ?? !twoStage;
    const seed = inputs.seed ?? randomSeed();
    const temps = [`${stem}.lo.mp4`, `${stem}.up.mp4`, `${stem}.first.png`, `${stem}.last.png`, `${stem}.guide.wav`, `${stem}.cont.png`, `${stem}.first-full.png`, `${stem}.last-full.png`];
    // Motion continuation (settings: video.continueMode "motion"): every clip saves its latent next to itself (<clip>.latent) and a clip that
    // continues another one pins that clip's last frames and latent. Without the other clip's latent it falls back to the last picture.
    const wantsMotion = inputs.continue_mode === "motion";
    const previous = continued ? `${continued.slice(0, -path.extname(continued).length)}.latent` : null;
    // The tiled profile needs the latent of the small stage of the clip before too (<clip>.latent-lo).
    const previousLo = continued ? `${continued.slice(0, -path.extname(continued).length)}.latent-lo` : null;
    const motionOn = wantsMotion && Boolean(continued) && !first && (await exists(previous)) && (!tiled || (await exists(previousLo)));
    const tag = `${path.basename(stem).replace(/[^\w-]/g, "_").slice(0, 40)}_${Date.now().toString(36)}`;
    const latentDir = path.join(context.connections.refDir, "ComfyUI", "output", "vsom_latents");
    const latents = [path.join(latentDir, `prev_${tag}.safetensors`), path.join(latentDir, `${tag}_00001.safetensors`), path.join(latentDir, `prev_${tag}_lo.safetensors`), path.join(latentDir, `${tag}_lo_00001.safetensors`)];
    try {
      if (guide && inputs.audio_range) guide = await sliceAudio(context, guide, inputs.audio_range, temps[4]);
      if (continued && !first && !motionOn) first = await lastFrame(context, continued, temps[5]);
      // The Deno profile runs on the Rev0 ComfyUI (it has the H3 latent upscaler, and the motion nodes); the other profiles stay on SongYUE2's.
      const server = model === "deno" || wantsMotion ? "ref" : "comfy";
      await context.ensure(server);
      const comfy = context.comfy(context.connections[`${server}Url`]);
      await h3Models(comfy, [H3.refUnets[model]]);
      if (model === "deno") {
        const loras = await comfy.options("LoraLoaderModelOnly", "lora_name");
        for (const lora of tiled ? [H3.denoLora, H3.pikaLora] : [H3.denoLora]) if (!loras.includes(lora)) throw new ToolError(`ComfyUI에 LoRA가 없습니다: ${lora}`, "unavailable");
      }
      const uploaded = [];
      for (const image of images) uploaded.push(await comfy.upload(image, path.basename(image)));
      const [genWidth, genHeight] = twoStage ? [half(width), half(height)] : [width, height];
      let motion;
      if (motionOn) {
        await mkdir(latentDir, { recursive: true });
        await copyFile(previous, latents[0]);
        if (tiled) await copyFile(previousLo, latents[2]);
        // Tiled: `latent` follows the small first stage, `latentFull` the second stage at the final size.
        motion = { video: await comfy.upload(continued, path.basename(continued)), total: await frameCount(context, continued), latent: tiled ? latents[2] : latents[0], latentFull: latents[0], length: 39 };
      }
      // Pinned pictures must match the generation size.
      const pinned = async (file, dest) => (file ? comfy.upload(await fitImage(context, file, genWidth, genHeight, dest), path.basename(dest)) : null);
      const graph = applyOverrides(
        h3RefGraph({
          // The pinned frames are cut off again, so the clip is made that much longer to keep the length that was asked for.
          prompt: inputs.prompt, width: genWidth, height: genHeight, seconds: seconds + (motion ? motion.length / 24 : 0), steps: inputs.steps === undefined ? undefined : Number(inputs.steps), finalSteps: Math.min(4, Math.max(1, Math.round(Number(inputs.final_steps ?? 1)))), seed, model, twoStage, tiled, tile: inputs.tile, loras: await videoLoras(comfy, inputs), motion, saveLatent: wantsMotion ? `vsom_latents/${tag}` : undefined,
          first: await pinned(first, temps[2]), last: await pinned(last, temps[3]),
          firstFull: twoStage && first ? await comfy.upload(await fitImage(context, first, width, height, temps[6]), path.basename(temps[6])) : null,
          lastFull: twoStage && last ? await comfy.upload(await fitImage(context, last, width, height, temps[7]), path.basename(temps[7])) : null,
          guideAudio: guide ? await comfy.upload(guide, path.basename(guide)) : null,
          images: uploaded, video: video ? await comfy.upload(video, path.basename(video)) : null, audio: audio ? await comfy.upload(audio, path.basename(audio)) : null, useVideoAudio: Boolean(inputs.use_video_audio),
        }),
        inputs.overrides,
      );
      await comfy.generate(graph, "15", temps[0], { timeoutMs: 3_000_000, signal: context.signal, onProgress: context.onProgress });
      if (wantsMotion) await copyFile(latents[1], `${stem}.latent`).catch(() => undefined);
      if (wantsMotion && tiled) await copyFile(latents[3], `${stem}.latent-lo`).catch(() => undefined);
      let clip = temps[0];
      if (upscale) {
        await rtxUpscale(context, clip, temps[1], Number(inputs.upscale_scale ?? 2.6));
        clip = temps[1];
      }
      await finishVideo(context, clip, output, { keepAudio: Boolean(inputs.keep_audio), audio: (inputs.mux_audio ?? true) ? (audio ?? guide) : null, fit: finalSize });
    } finally {
      await cleanup([...temps, ...latents]);
    }
    return { artifacts: [output], seed, model: `minimax-h3-ref2va-${model}${tiled ? "-tiled" : ""}${upscale ? "+rtx-2pass" : ""}`, data: { provider: "minimax-h3-local", output, seed, images: images.length, reference_video: Boolean(video), reference_audio: Boolean(audio), continue_mode: wantsMotion ? (motionOn ? "motion" : continued ? "frame (no latent of the clip before)" : "motion (first clip)") : "frame" } };
  },

  /**
   * A character sheet the MICW way: a full-body picture (a photo, or one made by Krea from the description) is the reference
   * of one H3 reference clip whose eight timed shots show the person from every side and with three expressions; one frame
   * is taken per shot and the sheet is laid out by code. Writes the sheet to `output_path` and the two frames the videos
   * use as references next to it (`<name>-front.png`, `<name>-face.png`).
   */
  async character_sheet(inputs, context) {
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const description = String(inputs.prompt);
    const style = String(inputs.style ?? "");
    const photos = inputs.reference_image_paths ?? [];
    for (const photo of [inputs.reference_image_path, ...photos].filter(Boolean)) if (!(await exists(photo))) throw new ToolError(`참조 사진이 없습니다: ${photo}`, "bad_input");
    const work = await mkdtemp(path.join(os.tmpdir(), "vsom-sheet-"));
    try {
      // 1) <Picture 1>: the character's own full-body picture, or one drawn from the description.
      let body = inputs.reference_image_path;
      if (!body) {
        body = path.join(work, "body.png");
        const drawn = await HANDLERS.comfyui_krea_image({ prompt: sheetReferencePrompt({ description, style }), width: 1280, height: 704, seed: inputs.seed, output_path: body }, context);
        if (!drawn.artifacts?.length) throw new ToolError("전신 참조 그림을 만들지 못했습니다.");
      }
      // 2) the clip: eight shots, one per second (extra photos only fix the face).
      const clip = path.join(work, "turnaround.mp4");
      const result = await HANDLERS.h3_reference_video(
        { prompt: sheetPrompt({ description, style, faceReferences: photos.length }), reference_image_paths: [body, ...photos].slice(0, 9), model: inputs.model, width: 1472, height: 832, duration_seconds: SHEET_SECONDS, upscale: inputs.upscale ?? false, upscale_scale: Number(inputs.upscale_scale ?? 2.6), seed: inputs.seed, overrides: inputs.overrides, output_path: clip },
        context,
      );
      // 3) one frame per shot, then the sheet.
      const frames = [];
      for (const shot of SHEET_SHOTS) {
        const frame = path.join(work, `${shot.id}.png`);
        await extractFrame({ ffmpegPath: context.ffmpegPath, clip, shot, output: frame, capture: context.capture });
        frames.push(frame);
      }
      await composeSheet({ ffmpegPath: context.ffmpegPath, frames, output, capture: context.capture });
      const front = `${stem}-front.png`;
      const face = `${stem}-face.png`;
      await copyFile(frames[SHEET_SHOTS.findIndex((shot) => shot.id === "front")], front);
      await copyFile(frames[SHEET_SHOTS.findIndex((shot) => shot.id === "face-neutral")], face);
      return { artifacts: [output, front, face], seed: result.seed, model: "minimax-h3-ref2va (character sheet)", data: { provider: "minimax-h3-local", output, front, face, shots: SHEET_SHOTS.length } };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  },

  async comfyui_workflow(inputs, context) {
    const workflow = await loadApiWorkflow(inputs.workflow_path);
    const files = [...(inputs.image_paths ?? []).map((file) => ["이미지", file]), ["영상", inputs.video_path], ["오디오", inputs.audio_path]].filter(([, file]) => file);
    for (const [label, file] of files) if (!(await exists(file))) throw new WorkflowError(`입력 ${label} 파일이 없습니다: ${file}`);
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    if (!(await comfy.isUp())) throw new WorkflowError(`ComfyUI에 연결할 수 없습니다: ${comfy.url}`);
    const seed = inputs.seed ?? randomSeed();
    let frames = inputs.frames;
    if (!frames && inputs.duration_seconds) frames = 4 * Math.max(1, Math.round((Number(inputs.duration_seconds) * 24 - 1) / 4)) + 1;
    const patched = patchWorkflow(workflow, {
      prompt: inputs.prompt, negative: inputs.negative_prompt, width: inputs.width, height: inputs.height, frames, seed, models: inputs.models, loras: inputs.loras, upscaleModel: inputs.upscale_model,
      images: await Promise.all((inputs.image_paths ?? []).map((file) => comfy.upload(file, path.basename(file)))),
      video: inputs.video_path ? await comfy.upload(inputs.video_path, path.basename(inputs.video_path)) : undefined,
      audio: inputs.audio_path ? await comfy.upload(inputs.audio_path, path.basename(inputs.audio_path)) : undefined,
    });
    const graph = patched.workflow;
    const classes = [...new Set(Object.values(graph).map((node) => node.class_type))];
    const info = new Map(await Promise.all(classes.map(async (cls) => [cls, await comfy.nodeInfo(cls)])));
    const absent = missingNodes(graph, info);
    if (absent.length > 0) throw new WorkflowError(`ComfyUI에 설치되지 않은 노드가 필요합니다: ${absent.join(", ")}. 해당 커스텀 노드를 설치한 뒤 ComfyUI를 다시 시작하세요.`);
    const problems = missingModels(graph, info);
    if (problems.length > 0) throw new WorkflowError(`ComfyUI에 없는 모델이 지정돼 있습니다: ${problems.join("; ")}`);
    const node = outputNode(graph);
    if (!node) throw new WorkflowError("워크플로에 결과를 저장하는 노드(SaveImage/SaveVideo 등)가 없습니다.");
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, node, dest, { timeoutMs: (inputs.timeout_seconds ?? 3000) * 1000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: path.basename(inputs.workflow_path), data: { provider: "comfyui-local", output: dest, seed, notes: patched.notes } };
  },

  async qwen3_tts(inputs, context) {
    const root = context.connections.songyueDir;
    const cli = path.join(root, "engine", "audio.cpp", "build", "windows-cuda-release", "bin", "audiocpp_cli.exe");
    const model = path.join(root, "models", "audio-cpp", "audio.cpp-gguf", "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF", "qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf");
    if (!(await exists(cli)) || !(await exists(model))) throw new ToolError(`Qwen3-TTS를 쓸 수 없습니다. SongYUE2의 audio.cpp와 CustomVoice 모델이 필요합니다 (${root}).`, "unavailable");
    const chunks = splitSpeech(inputs.text);
    if (chunks.length === 0) throw new ToolError("읽을 글이 비어 있습니다.", "bad_input");
    const voice = inputs.voice ?? "Sohee";
    const language = { ko: "korean", en: "english", auto: "auto" }[inputs.language ?? "ko"] ?? "korean";
    const output = await prepareOutput(inputs);
    // The speech engine cannot open a file whose path has Korean letters (a project folder named after its title), so
    // the pieces are written to a plain ASCII folder and only the finished file goes to the project.
    const work = await mkdtemp(path.join(os.tmpdir(), "vsom-tts-"));
    const parts = [];
    try {
      for (const [index, chunk] of chunks.entries()) {
        const part = path.join(work, `part${index}.wav`);
        parts.push(part);
        // audiocpp_cli looks up its model specs relative to the audio.cpp source root.
        await context.capture(cli, ["--backend", "cuda", "--task", "tts", "--family", "qwen3_tts", "--model", model, "--speaker", voice, ...(inputs.style ? ["--instruct", inputs.style] : []), "--language", language, "--text", chunk, "--out", part], {
          cwd: path.join(root, "engine", "audio.cpp"),
          timeoutMs: 600_000,
          signal: context.signal,
        });
        if (!(await exists(part))) throw new ToolError("음성 파일이 만들어지지 않았습니다.");
      }
      if (parts.length === 1) await copyFile(parts[0], output);
      else await concatMedia({ ffmpegPath: context.ffmpegPath, kind: "audio", inputs: parts, output });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return { artifacts: [output], seed: null, model: "qwen3-tts-12hz-1.7b-customvoice-q8_0", data: { provider: "qwen3", voice, language, text_length: inputs.text.length, output, format: "wav" } };
  },

  async songyue_music(inputs, context) {
    await context.ensure("songyue");
    const dest = await prepareOutput(inputs);
    const lyrics = String(inputs.lyrics ?? "").trim();
    const body = {
      lyric: lyrics || "[Instrumental]",
      style: inputs.prompt,
      mode: lyrics ? "melody" : "instrumental",
      outputFormat: path.extname(dest).slice(1).toLowerCase() || "wav",
      outputFolder: path.dirname(dest),
      fileName: path.basename(dest),
      ...(inputs.seed !== undefined ? { seed: inputs.seed } : {}),
    };
    const res = await context.fetchImpl(`${context.connections.songyueUrl}/api/external/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: abortAfter(context.signal, 1_800_000) });
    if (!res.ok) throw new ToolError(`SongYUE2가 ${res.status}로 답했습니다: ${(await res.text()).slice(0, 300)}`);
    const out = (await res.json()).output?.path;
    if (!out || !(await exists(out))) throw new ToolError("SongYUE2가 결과 파일을 알려 주지 않았습니다.");
    return { artifacts: [out], seed: inputs.seed ?? null, model: "yue2", data: { provider: "songyue2", output: out } };
  },

  async songyue_sfx(inputs, context) {
    await context.ensure("songyue");
    const dest = await prepareOutput(inputs);
    const body = { prompt: inputs.prompt, durationSeconds: inputs.duration_seconds ?? 5, steps: inputs.steps ?? 8, ...(inputs.seed !== undefined ? { seed: inputs.seed } : {}), ...(inputs.negative_prompt ? { negativePrompt: inputs.negative_prompt } : {}) };
    const res = await context.fetchImpl(`${context.connections.songyueUrl}/api/audio-tools/sfx`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: abortAfter(context.signal, 600_000) });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error;
      } catch {
        detail = "";
      }
      throw new ToolError(`SongYUE2: ${detail || res.status}`);
    }
    const dataUrl = (await res.json()).dataUrl ?? "";
    if (!dataUrl.includes(",")) throw new ToolError("SongYUE2가 소리를 돌려주지 않았습니다.");
    await writeFile(dest, Buffer.from(dataUrl.split(",", 2)[1], "base64"));
    return { artifacts: [dest], seed: inputs.seed ?? null, model: "stable-audio-3-small-sfx", data: { provider: "songyue2", output: dest } };
  },
};

/** An abort signal that fires after `ms` or when `signal` does. */
const abortAfter = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

const MAX_CHARS = 200;

/** Packs sentences into chunks of at most 200 characters (the speech engine reads short pieces best). */
export function splitSpeech(text) {
  const chunks = [];
  for (const raw of text.trim().split(/(?<=[.!?。！？])\s+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (chunks.length > 0 && chunks.at(-1).length + sentence.length < MAX_CHARS) chunks[chunks.length - 1] += ` ${sentence}`;
    else for (let i = 0; i < sentence.length; i += MAX_CHARS) chunks.push(sentence.slice(i, i + MAX_CHARS));
  }
  return chunks;
}

export { ToolError };
