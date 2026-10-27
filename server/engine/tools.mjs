import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { concatMedia, ffmpegFor } from "../concat.mjs";
import { ffprobeFor } from "../probe.mjs";
import { runCapture } from "../post.mjs";
import { createComfy } from "./comfy.mjs";
import { h3Graph, h3RefGraph, H3, kreaGraph, pickKreaModels, rtxGraph } from "./graphs.mjs";
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
  h3_local_video: ["prompt", "output_path"],
  h3_reference_video: ["prompt", "output_path"],
  comfyui_workflow: ["workflow_path", "output_path"],
  character_sheet: ["prompt", "output_path"],
  qwen3_tts: ["text", "output_path"],
  songyue_music: ["prompt", "output_path"],
  songyue_sfx: ["prompt", "output_path"],
};
export const TOOL_NAMES = Object.keys(REQUIRED);

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);
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
      // One 12 GB card serves all three ComfyUI servers: release the others before this one loads its models.
      // A service that shares this one's address (rtx on the Rev0 server) is the same server, so it stays loaded.
      for (const other of ["comfy", "ref", "rtx"]) if (other !== name && connections[`${other}Url`] && connections[`${other}Url`] !== connections[`${name}Url`]) await createComfy(connections[`${other}Url`]).free();
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

/** The RTX 2-pass upscale on the second ComfyUI. The main server is busy while the node runs, so waiting is patient. */
async function rtxUpscale(context, source, dest, scale) {
  await context.ensure("rtx");
  const rtx = context.comfy(context.connections.rtxUrl);
  const name = await rtx.upload(source, path.basename(source));
  const prefix = `RTXvsom_${path.basename(source, path.extname(source))}`;
  const promptId = await rtx.submit(rtxGraph({ video: name, scale, prefix }));
  const entry = await rtx.wait(promptId, { timeoutMs: 900_000, signal: context.signal, pollMs: 3000 });
  const item = (entry.outputs?.["3"]?.gifs ?? [])[0];
  if (!item) throw new ToolError("RTX 확대의 결과 파일이 없습니다.");
  // The desktop ComfyUI writes into a known folder; copying is faster and does not depend on its web server being free.
  const local = path.join(context.connections.rtxOutputDir, item.subfolder ?? "", item.filename);
  if (await exists(local)) await copyFile(local, dest);
  else await rtx.download(item, dest);
}

const cleanup = (files) => Promise.all(files.map((file) => rm(file, { force: true })));

async function h3Models(comfy, wanted) {
  const unets = await comfy.options("UNETLoader", "unet_name");
  const missing = wanted.filter((name) => !unets.includes(name));
  if (missing.length > 0) throw new ToolError(`ComfyUI에 H3 모델이 없습니다: ${missing.join(", ")}`, "unavailable");
}

const HANDLERS = {
  async comfyui_krea_image(inputs, context) {
    await context.ensure("comfy");
    const comfy = context.comfy(context.connections.comfyUrl);
    const models = pickKreaModels({ unets: await comfy.options("UNETLoader", "unet_name"), clips: await comfy.options("CLIPLoader", "clip_name"), vaes: await comfy.options("VAELoader", "vae_name") });
    if (!models) throw new ToolError("Krea 2 Turbo 모델 파일(unet, qwen3vl_4b, qwen_image_vae)이 ComfyUI에 보이지 않습니다.", "unavailable");
    const seed = inputs.seed ?? randomSeed();
    const graph = applyOverrides(kreaGraph({ prompt: inputs.prompt, width: inputs.width ?? 1536, height: inputs.height ?? 864, steps: inputs.steps ?? 8, seed, models }), inputs.overrides);
    const dest = await prepareOutput(inputs);
    await comfy.generate(graph, "10", dest, { timeoutMs: 600_000, signal: context.signal, onProgress: context.onProgress });
    return { artifacts: [dest], seed, model: models.unet, data: { provider: "comfyui-krea", output: dest, seed, model: models.unet } };
  },

  async h3_local_video(inputs, context) {
    const image = inputs.reference_image_path;
    const last = inputs.last_frame_path;
    const audio = inputs.audio_path;
    if (!image || !(await exists(image))) throw new ToolError("첫 이미지(reference_image_path) 파일이 없습니다.", "bad_input");
    if (last && !(await exists(last))) throw new ToolError("마지막 이미지(last_frame_path) 파일이 없습니다.", "bad_input");
    if (audio && !(await exists(audio))) throw new ToolError("오디오(audio_path) 파일이 없습니다.", "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const [width, height] = [Number(inputs.width ?? 736), Number(inputs.height ?? 416)];
    const upscale = inputs.upscale ?? true;
    const seed = inputs.seed ?? randomSeed();
    const temps = [`${stem}.lo.mp4`, `${stem}.up.mp4`, `${stem}.first.png`, `${stem}.last.png`];
    try {
      await context.ensure("comfy");
      const comfy = context.comfy(context.connections.comfyUrl);
      await h3Models(comfy, [H3.unet]);
      let [firstFile, lastFile] = [image, last];
      if (inputs.fit_images ?? true) {
        firstFile = await fitImage(context, image, width, height, temps[2]);
        if (last) lastFile = await fitImage(context, last, width, height, temps[3]);
      }
      const upload = (file) => (file ? comfy.upload(file, path.basename(file)) : null);
      const graph = applyOverrides(
        h3Graph({ prompt: inputs.prompt, width, height, seconds: Number(inputs.duration_seconds ?? 5), steps: Number(inputs.steps ?? 4), seed, image: await upload(firstFile), last: await upload(lastFile), audio: await upload(audio) }),
        inputs.overrides,
      );
      await comfy.generate(graph, "15", temps[0], { timeoutMs: 3_000_000, signal: context.signal, onProgress: context.onProgress });
      let clip = temps[0];
      if (upscale) {
        await rtxUpscale(context, clip, temps[1], Number(inputs.upscale_scale ?? 2.6));
        clip = temps[1];
      }
      await finishVideo(context, clip, output, { keepAudio: Boolean(inputs.keep_audio), audio: (inputs.mux_audio ?? true) ? audio : null, fit: Array.isArray(inputs.final_size) ? inputs.final_size.map(Number) : null });
    } finally {
      await cleanup(temps);
    }
    const model = `minimax-h3-turbo-4step${upscale ? "+rtx-2pass" : ""}`;
    return { artifacts: [output], seed, model, data: { provider: "minimax-h3-local", output: output, upscaled: upscale, seed, last_frame: Boolean(last), audio_guided: Boolean(audio) } };
  },

  async h3_reference_video(inputs, context) {
    const images = inputs.reference_image_paths ?? [];
    const video = inputs.reference_video_path;
    const audio = inputs.reference_audio_path;
    if (images.length === 0 && !video && !audio) throw new ToolError("참조 이미지, 영상, 오디오 중 하나는 필요합니다.", "bad_input");
    if (images.length > 9) throw new ToolError("참조 이미지는 9장까지입니다.", "bad_input");
    for (const [label, file] of [...images.map((item) => ["참조 이미지", item]), ["참조 영상", video], ["참조 오디오", audio]]) {
      if (file && !(await exists(file))) throw new ToolError(`${label} 파일이 없습니다: ${file}`, "bad_input");
    }
    const model = inputs.model ?? "deno";
    if (!(model in H3.refUnets)) throw new ToolError("model은 turbo, official, deno 중 하나여야 합니다.", "bad_input");
    const output = await prepareOutput(inputs);
    const stem = output.slice(0, -path.extname(output).length);
    const twoStage = model === "deno" && (inputs.two_stage ?? true);
    // Two-stage: width and height are the FINAL size; the first stage runs at half of it (multiples of 32) and the latent is enlarged 2x.
    const half = (value) => Math.max(32, Math.round(Number(value) / 2 / 32) * 32);
    const [width, height] = [Number(inputs.width ?? 736), Number(inputs.height ?? 416)];
    const upscale = inputs.upscale ?? !twoStage;
    const seed = inputs.seed ?? randomSeed();
    const temps = [`${stem}.lo.mp4`, `${stem}.up.mp4`];
    try {
      // The Deno profile runs on the Rev0 ComfyUI (it has the H3 latent upscaler); the other profiles stay on SongYUE2's.
      const server = model === "deno" ? "ref" : "comfy";
      await context.ensure(server);
      const comfy = context.comfy(context.connections[`${server}Url`]);
      await h3Models(comfy, [H3.refUnets[model]]);
      if (model === "deno" && !(await comfy.options("LoraLoaderModelOnly", "lora_name")).includes(H3.denoLora)) throw new ToolError(`ComfyUI에 LoRA가 없습니다: ${H3.denoLora}`, "unavailable");
      const uploaded = [];
      for (const image of images) uploaded.push(await comfy.upload(image, path.basename(image)));
      const graph = applyOverrides(
        h3RefGraph({
          prompt: inputs.prompt, width: twoStage ? half(width) : width, height: twoStage ? half(height) : height, seconds: Number(inputs.duration_seconds ?? 5), steps: inputs.steps, seed, model, twoStage,
          images: uploaded, video: video ? await comfy.upload(video, path.basename(video)) : null, audio: audio ? await comfy.upload(audio, path.basename(audio)) : null, useVideoAudio: Boolean(inputs.use_video_audio),
        }),
        inputs.overrides,
      );
      await comfy.generate(graph, "15", temps[0], { timeoutMs: 3_000_000, signal: context.signal, onProgress: context.onProgress });
      let clip = temps[0];
      if (upscale) {
        await rtxUpscale(context, clip, temps[1], Number(inputs.upscale_scale ?? 2.6));
        clip = temps[1];
      }
      await finishVideo(context, clip, output, { keepAudio: Boolean(inputs.keep_audio), audio: (inputs.mux_audio ?? true) ? audio : null, fit: Array.isArray(inputs.final_size) ? inputs.final_size.map(Number) : null });
    } finally {
      await cleanup(temps);
    }
    return { artifacts: [output], seed, model: `minimax-h3-ref2va-${model}${upscale ? "+rtx-2pass" : ""}`, data: { provider: "minimax-h3-local", output, seed, images: images.length, reference_video: Boolean(video), reference_audio: Boolean(audio) } };
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
