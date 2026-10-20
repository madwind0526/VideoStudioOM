import { readFile } from "node:fs/promises";

/**
 * Fills the usual inputs of a ComfyUI API-format workflow without knowing the graph in advance.
 * Rules (by node class and input name): the positive prompt is the text node feeding the sampler's positive input,
 * seeds are every literal `seed`/`noise_seed`, size is every latent-style node with literal width and height,
 * LoadImage/LoadVideo/LoadAudio get the uploaded files in id order, loaders get model overrides, and LoRAs are chained
 * after the diffusion loader.
 */

const DIFFUSION_LOADERS = { UNETLoader: "unet_name", UnetLoaderGGUF: "unet_name", CheckpointLoaderSimple: "ckpt_name" };
export const MODEL_FIELDS = ["unet_name", "ckpt_name", "clip_name", "clip_name1", "clip_name2", "vae_name", "lora_name", "model_name"];
const SAVE_CLASSES = ["SaveImage", "SaveVideo", "SaveAnimatedWEBP", "SaveAnimatedPNG", "VHS_VideoCombine", "SaveAudio", "SaveWEBM", "PreviewImage"];

/** A problem the user can fix; the message is shown on screen. */
export class WorkflowError extends Error {}

const isLink = (value) => Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && Number.isInteger(value[1]);
const sortedIds = (wf) => Object.keys(wf).sort((a, b) => (/^\d+$/.test(a) ? Number(a) : 1e9) - (/^\d+$/.test(b) ? Number(b) : 1e9) || a.localeCompare(b));

export async function loadApiWorkflow(file) {
  let data;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new WorkflowError(error.code === "ENOENT" ? `워크플로 파일이 없습니다: ${file}` : `워크플로 파일을 읽을 수 없습니다: ${error.message}`);
  }
  if (Array.isArray(data?.nodes)) throw new WorkflowError("ComfyUI 화면용 형식(UI)입니다. ComfyUI에서 'Save (API Format)'으로 내보낸 JSON을 선택하세요.");
  const entries = Object.values(data ?? {});
  if (entries.length === 0 || !entries.every((node) => node && typeof node === "object" && "class_type" in node)) throw new WorkflowError("ComfyUI API 형식(노드 번호별 class_type)이 아닙니다.");
  return data;
}

/** Node classes the workflow uses that the server does not have. `info` maps class to its object_info (null when missing). */
export const missingNodes = (wf, info) => [...new Set(Object.values(wf).map((node) => node.class_type).filter((cls) => !info.get(cls)))].sort();

/** Model names the workflow sets that the server does not list. */
export function missingModels(wf, info) {
  const problems = [];
  for (const [id, node] of Object.entries(wf)) {
    const spec = info.get(node.class_type)?.input ?? {};
    for (const field of MODEL_FIELDS) {
      const value = node.inputs?.[field];
      if (typeof value !== "string") continue;
      const options = (spec.required?.[field] ?? spec.optional?.[field])?.[0];
      if (Array.isArray(options) && !options.includes(value)) problems.push(`${field}=${value} (노드 ${id}, ${node.class_type})`);
    }
  }
  return problems;
}

const textKey = (node) => ["text", "prompt", "positive_prompt"].find((key) => typeof node.inputs[key] === "string") ?? null;

function traceText(wf, id, seen) {
  if (seen.has(id) || !wf[id]) return null;
  seen.add(id);
  const node = wf[id];
  if (textKey(node)) return id;
  for (const [key, value] of Object.entries(node.inputs)) {
    if (isLink(value) && !["clip", "model", "vae", "latent_image", "image", "images"].includes(key)) {
      const found = traceText(wf, value[0], seen);
      if (found) return found;
    }
  }
  return null;
}

function samplerTextNode(wf, side) {
  for (const node of Object.values(wf)) {
    let link = node.inputs[side];
    if (side === "positive" && !link) link = node.inputs.conditioning;
    if (isLink(link)) {
      const found = traceText(wf, link[0], new Set());
      if (found) return found;
    }
  }
  return null;
}

const setLiteral = (node, key, value) => {
  if (key in node.inputs && !isLink(node.inputs[key])) node.inputs[key] = value;
};

/** Returns { workflow: patched copy, notes: what could not be applied }. */
export function patchWorkflow(source, { prompt, negative, width, height, frames, seed, models = {}, loras = [], upscaleModel, images = [], video, audio } = {}) {
  const wf = structuredClone(source);
  const notes = [];
  const ids = sortedIds(wf);

  if (prompt) {
    const target = samplerTextNode(wf, "positive");
    if (target) wf[target].inputs[textKey(wf[target])] = prompt;
    else notes.push("프롬프트를 넣을 텍스트 노드를 찾지 못했습니다.");
  }
  if (negative) {
    const target = samplerTextNode(wf, "negative");
    if (target) wf[target].inputs[textKey(wf[target])] = negative;
  }

  for (const id of ids) {
    const node = wf[id];
    if (seed !== undefined && seed !== null) for (const key of ["seed", "noise_seed"]) setLiteral(node, key, seed);
    const cls = node.class_type;
    const sized = cls.includes("Latent") || cls.startsWith("Empty") || cls.endsWith("ToVideo") || cls.startsWith("Wan") || cls.startsWith("LTX");
    if (sized && Number.isInteger(node.inputs.width) && Number.isInteger(node.inputs.height)) {
      if (width && height) [node.inputs.width, node.inputs.height] = [width, height];
      if (frames) for (const key of ["length", "frames", "video_length"]) setLiteral(node, key, frames);
    }
  }

  const queues = { LoadImage: ["image", [...images]], LoadVideo: ["file", video ? [video] : []], LoadAudio: ["audio", audio ? [audio] : []] };
  for (const [cls, [key, files]] of Object.entries(queues)) {
    const nodes = ids.filter((id) => wf[id].class_type === cls);
    nodes.forEach((id, index) => {
      if (index < files.length) wf[id].inputs[key] = files[index];
    });
    if (files.length > nodes.length) notes.push(`${cls} 노드가 ${nodes.length}개뿐이라 파일 ${files.length - nodes.length}개는 쓰이지 않았습니다.`);
  }

  const diffusion = ids.find((id) => wf[id].class_type in DIFFUSION_LOADERS);
  if (models.diffusion) {
    if (diffusion) wf[diffusion].inputs[DIFFUSION_LOADERS[wf[diffusion].class_type]] = models.diffusion;
    else notes.push("diffusion 모델을 넣을 로더 노드가 없습니다.");
  }
  if (models.text_encoder) {
    const clip = ids.find((id) => ["CLIPLoader", "DualCLIPLoader"].includes(wf[id].class_type));
    if (clip) wf[clip].inputs["clip_name1" in wf[clip].inputs ? "clip_name1" : "clip_name"] = models.text_encoder;
    else notes.push("text encoder를 넣을 로더 노드가 없습니다.");
  }
  if (models.vae) {
    // The first VAE that is not an audio VAE (H3 loads a video VAE and an audio VAE).
    const vae = ids.find((id) => wf[id].class_type === "VAELoader" && !String(wf[id].inputs.vae_name ?? "").toLowerCase().includes("audio"));
    if (vae) wf[vae].inputs.vae_name = models.vae;
    else notes.push("VAE를 넣을 로더 노드가 없습니다.");
  }
  if (upscaleModel) {
    const ups = ids.filter((id) => wf[id].class_type === "UpscaleModelLoader");
    for (const id of ups) wf[id].inputs.model_name = upscaleModel;
    if (ups.length === 0) notes.push("업스케일 모델을 넣을 UpscaleModelLoader 노드가 없습니다.");
  }

  const chosen = loras.filter((lora) => lora?.name);
  if (chosen.length > 0 && diffusion) {
    const consumers = ids.flatMap((id) => Object.entries(wf[id].inputs).filter(([, value]) => isLink(value) && value[0] === diffusion && value[1] === 0).map(([key]) => [id, key]));
    let previous = [diffusion, 0];
    chosen.forEach((lora, index) => {
      const id = String(9001 + index);
      wf[id] = { class_type: "LoraLoaderModelOnly", inputs: { model: previous, lora_name: lora.name, strength_model: Number(lora.strength ?? 1) } };
      previous = [id, 0];
    });
    for (const [id, key] of consumers) wf[id].inputs[key] = previous;
  } else if (chosen.length > 0) {
    notes.push("LoRA를 연결할 diffusion 로더 노드가 없습니다.");
  }
  return { workflow: wf, notes };
}

/** Model names and LoRAs the user picked, applied to a tool's built-in graph. */
export function applyOverrides(wf, overrides) {
  if (!overrides) return wf;
  return patchWorkflow(wf, { models: overrides.models, loras: overrides.loras }).workflow;
}

/** The last save-type node (highest id) is the result. */
export function outputNode(wf) {
  const saves = Object.keys(wf).filter((id) => SAVE_CLASSES.includes(wf[id].class_type));
  return saves.length ? saves.sort((a, b) => (/^\d+$/.test(a) ? Number(a) : -1) - (/^\d+$/.test(b) ? Number(b) : -1) || a.localeCompare(b)).at(-1) : null;
}
