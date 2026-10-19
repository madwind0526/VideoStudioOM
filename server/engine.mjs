import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "./http.mjs";

const MODEL_FIELDS = ["unet_name", "ckpt_name", "clip_name", "clip_name1", "clip_name2", "vae_name", "lora_name", "model_name"];
const MAX_ENTRIES = 500;

/** Which workflow slot a tool call belongs to (settings.engine.<kind>.workflow<SLOT>), or null when it has none. */
export function engineSlot(tool, inputs) {
  if (tool === "comfyui_krea_image") return { kind: "image", slot: inputs.reference_image_path ? "I2I" : "T2I" };
  if (tool === "h3_reference_video") return { kind: "video", slot: "R2V" };
  if (tool === "h3_local_video") return { kind: "video", slot: inputs.reference_image_path ? "I2V" : "T2V" };
  return null;
}

/**
 * Without a workflow in the settings the call is left alone (default workflow and default models).
 * With one, the call becomes a comfyui_workflow call: the same prompt/size/seed/files, plus the workflow file,
 * the model overrides, the LoRAs and the upscaler model from the settings.
 * Returns { tool, inputs, allowRoots } where allowRoots lists extra folders the bridge may read from.
 */
export function applyEngine(settings, { tool, inputs }) {
  const picked = engineSlot(tool, inputs);
  const section = picked && settings.engine?.[picked.kind];
  const workflow = section?.[`workflow${picked?.slot}`];
  if (!workflow) return { tool, inputs, allowRoots: [] };

  const files = [inputs.reference_image_path, inputs.last_frame_path, ...(inputs.reference_image_paths ?? [])].filter(Boolean);
  const mapped = {
    workflow_path: workflow,
    prompt: inputs.prompt,
    width: inputs.width,
    height: inputs.height,
    seed: inputs.seed,
    output_path: inputs.output_path,
    models: { diffusion: section.diffusion, text_encoder: section.textEncoder, vae: section.vae },
    loras: section.loras.map((lora) => ({ name: lora.name, strength: lora.strength })),
    upscale_model: settings.engine.upscale.model,
  };
  if (inputs.duration_seconds) mapped.duration_seconds = inputs.duration_seconds;
  if (files.length) mapped.image_paths = files;
  if (inputs.reference_video_path) mapped.video_path = inputs.reference_video_path;
  if (inputs.audio_path ?? inputs.reference_audio_path) mapped.audio_path = inputs.audio_path ?? inputs.reference_audio_path;
  for (const key of Object.keys(mapped)) if (mapped[key] === undefined || mapped[key] === "") delete mapped[key];
  return { tool: "comfyui_workflow", inputs: mapped, allowRoots: [path.dirname(workflow)] };
}

/** Folders and .json files of one folder, for the workflow picker. An empty `dir` lists the drives. */
export async function listDir(dir) {
  if (!dir) {
    const drives = [];
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (await access(root).then(() => true, () => false)) drives.push({ name: root, type: "dir" });
    }
    return { dir: "", parent: null, entries: drives };
  }
  if (typeof dir !== "string" || dir.includes("\0") || !path.isAbsolute(dir)) throw new HttpError(400, "폴더 경로가 올바르지 않습니다.");
  const resolved = path.resolve(dir);
  const names = await readdir(resolved, { withFileTypes: true }).catch(() => {
    throw new HttpError(404, "폴더를 열 수 없습니다.");
  });
  const entries = names
    .filter((entry) => entry.isDirectory() || (entry.isFile() && /\.json$/i.test(entry.name)))
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "dir" ? -1 : 1))
    .slice(0, MAX_ENTRIES);
  const parent = path.dirname(resolved);
  return { dir: resolved, parent: parent === resolved ? "" : parent, entries };
}

async function nodeInfo(comfyUrl, cls) {
  try {
    const res = await fetch(`${comfyUrl}/object_info/${encodeURIComponent(cls)}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json())[cls] ?? null;
  } catch {
    return undefined; // server unreachable: unknown, not "missing"
  }
}

/** Model file names ComfyUI offers, for the suggestion lists in the settings. Empty lists when ComfyUI is off. */
export async function comfyModels(comfyUrl) {
  const pick = async (cls, field) => {
    const info = await nodeInfo(comfyUrl, cls);
    const list = info?.input?.required?.[field]?.[0];
    return Array.isArray(list) ? list : [];
  };
  return {
    diffusion: await pick("UNETLoader", "unet_name"),
    textEncoder: await pick("CLIPLoader", "clip_name"),
    vae: await pick("VAELoader", "vae_name"),
    loras: await pick("LoraLoaderModelOnly", "lora_name"),
    upscale: await pick("UpscaleModelLoader", "model_name"),
  };
}

/** Reads a workflow file and asks ComfyUI whether every node class and model name in it exists. */
export async function checkWorkflow(file, comfyUrl) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !/\.json$/i.test(file)) throw new HttpError(400, "워크플로는 .json 파일의 전체 경로여야 합니다.");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 20_000_000) throw new HttpError(404, "워크플로 파일을 찾을 수 없습니다.");
  let data;
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { ok: false, problems: ["JSON을 읽을 수 없습니다."], missingNodes: [], missingModels: [] };
  }
  if (Array.isArray(data?.nodes)) {
    return { ok: false, problems: ["ComfyUI 화면용 형식(UI)입니다. ComfyUI에서 'Save (API Format)'으로 내보낸 JSON을 선택하세요."], missingNodes: [], missingModels: [] };
  }
  const nodes = Object.entries(data ?? {});
  if (nodes.length === 0 || !nodes.every(([, node]) => node && typeof node === "object" && typeof node.class_type === "string")) {
    return { ok: false, problems: ["ComfyUI API 형식(노드 번호별 class_type)이 아닙니다."], missingNodes: [], missingModels: [] };
  }
  const classes = [...new Set(nodes.map(([, node]) => node.class_type))];
  const infos = new Map(await Promise.all(classes.map(async (cls) => [cls, await nodeInfo(comfyUrl, cls)])));
  if ([...infos.values()].every((value) => value === undefined)) {
    return { ok: false, problems: ["ComfyUI에 연결할 수 없어 노드를 확인하지 못했습니다. ComfyUI를 켜고 다시 확인하세요."], missingNodes: [], missingModels: [] };
  }
  const missingNodes = classes.filter((cls) => infos.get(cls) === null).sort();
  const missingModels = [];
  for (const [id, node] of nodes) {
    const spec = infos.get(node.class_type)?.input ?? {};
    for (const field of MODEL_FIELDS) {
      const value = node.inputs?.[field];
      const options = (spec.required?.[field] ?? spec.optional?.[field])?.[0];
      if (typeof value === "string" && Array.isArray(options) && !options.includes(value)) missingModels.push(`${field}=${value} (노드 ${id}, ${node.class_type})`);
    }
  }
  const count = (cls) => nodes.filter(([, node]) => node.class_type === cls).length;
  const problems = [
    ...(missingNodes.length ? [`설치되지 않은 노드: ${missingNodes.join(", ")}. 해당 커스텀 노드를 설치한 뒤 ComfyUI를 다시 시작하세요.`] : []),
    ...(missingModels.length ? [`ComfyUI에 없는 모델: ${missingModels.join("; ")}`] : []),
  ];
  return { ok: problems.length === 0, problems, missingNodes, missingModels, nodeCount: nodes.length, imageInputs: count("LoadImage"), videoInputs: count("LoadVideo"), audioInputs: count("LoadAudio") };
}
