import { access, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createComfy } from "./engine/comfy.mjs";
import { loadApiWorkflow, missingModels, missingNodes, WorkflowError } from "./engine/workflow-patch.mjs";
import { HttpError } from "./http.mjs";

const MAX_ENTRIES = 500;

/** Which workflow slot a tool call belongs to (settings.engine.<kind>.workflow<SLOT>), or null when it has none. */
export function engineSlot(tool, inputs) {
  // `slot: "sheet"` marks a character-sheet image: it has its own workflow, and shares the image models and LoRAs.
  if (tool === "comfyui_krea_image") return { kind: "image", slot: inputs.slot === "sheet" ? "Sheet" : inputs.reference_image_path ? "I2I" : "T2I" };
  if (tool === "h3_reference_video") return { kind: "video", slot: "R2V" };
  if (tool === "h3_local_video") return { kind: "video", slot: inputs.reference_image_path ? "I2V" : "T2V" };
  return null;
}

/** Model names and LoRAs of one settings section (plus a call's extra LoRAs), in the shape the tools take (empty when nothing is set). */
function overridesOf(section, extra = []) {
  const models = Object.fromEntries(
    [["diffusion", section.diffusion], ["text_encoder", section.textEncoder], ["vae", section.vae]].filter(([, value]) => value),
  );
  const loras = [...section.loras, ...extra].map((lora) => ({ name: lora.name, strength: lora.strength }));
  return Object.keys(models).length || loras.length ? { ...(Object.keys(models).length ? { models } : {}), ...(loras.length ? { loras } : {}) } : null;
}

/**
 * Without a workflow in the settings the built-in tool runs, but still with the chosen models and LoRAs (`overrides`).
 * With a workflow, the call becomes a comfyui_workflow call: the same prompt/size/seed/files, plus the workflow file,
 * the model overrides, the LoRAs and the upscaler model from the settings.
 * Returns { tool, inputs, allowRoots } where allowRoots lists extra folders the tool may read from.
 */
export function applyEngine(settings, call) {
  const picked = engineSlot(call.tool, call.inputs);
  // `slot` only selects the workflow and `extra_loras` adds LoRAs for this one call (a scene's own LoRAs); the tools know neither.
  const { slot: _slot, extra_loras: extraLoras, ...inputs } = call.inputs;
  const extra = Array.isArray(extraLoras) ? extraLoras.filter((lora) => lora && typeof lora.name === "string" && lora.name).slice(0, 4).map((lora) => ({ name: lora.name, strength: Number.isFinite(lora.strength) ? lora.strength : 1 })) : [];
  const tool = call.tool;
  const section = picked && settings.engine?.[picked.kind];
  const workflow = section?.[`workflow${picked?.slot}`];
  if (!workflow) {
    const overrides = section && overridesOf(section, extra);
    return { tool, inputs: overrides ? { ...inputs, overrides } : inputs, allowRoots: [] };
  }

  const files = [inputs.reference_image_path, inputs.last_frame_path, ...(inputs.reference_image_paths ?? [])].filter(Boolean);
  const mapped = {
    workflow_path: workflow,
    prompt: inputs.prompt,
    width: inputs.width,
    height: inputs.height,
    seed: inputs.seed,
    output_path: inputs.output_path,
    ...overridesOf(section, extra),
    upscale_model: settings.engine.upscale.model,
  };
  if (inputs.duration_seconds) mapped.duration_seconds = inputs.duration_seconds;
  if (files.length) mapped.image_paths = files;
  if (inputs.reference_video_path) mapped.video_path = inputs.reference_video_path;
  if (inputs.audio_path ?? inputs.reference_audio_path) mapped.audio_path = inputs.audio_path ?? inputs.reference_audio_path;
  for (const key of Object.keys(mapped)) if (mapped[key] === undefined || mapped[key] === "") delete mapped[key];
  return { tool: "comfyui_workflow", inputs: mapped, allowRoots: [path.dirname(workflow)] };
}

/** Quick-jump folders of the file picker: the usual user folders, the open project, ComfyUI's workflows, the projects folder and the drives. */
async function pickerShortcuts(projectsDir, projectDir) {
  const home = os.homedir();
  const candidates = [
    { label: "바탕화면", path: path.join(home, "Desktop") },
    { label: "문서", path: path.join(home, "Documents") },
    { label: "다운로드", path: path.join(home, "Downloads") },
    ...(projectDir ? [{ label: "현재 프로젝트", path: projectDir }] : []),
    { label: "ComfyUI 워크플로", path: path.join(home, "Documents", "ComfyUI", "user", "default", "workflows") },
    ...(projectsDir ? [{ label: "프로젝트 폴더", path: projectsDir }] : []),
  ];
  for (let code = 67; code <= 90; code += 1) candidates.push({ label: `${String.fromCharCode(code)}:`, path: `${String.fromCharCode(code)}:\\` });
  const found = [];
  for (const item of candidates) if (await access(item.path).then(() => true, () => false)) found.push(item);
  return found;
}

/**
 * One folder for the built-in file picker: folders first, then files, hidden names left out. A folder that cannot be
 * opened comes back with `error` (and no entries) instead of failing, so the picker can show the message and stay open.
 * With no `dir` it opens the user's Documents folder.
 */
export async function listDir(dir, { projectsDir, projectDir } = {}) {
  const shortcuts = await pickerShortcuts(projectsDir, projectDir);
  const target = dir && dir.trim() ? dir.trim() : path.join(os.homedir(), "Documents");
  if (target.includes("\0") || !path.isAbsolute(target)) throw new HttpError(400, "폴더 경로가 올바르지 않습니다.");
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  try {
    if (!(await stat(resolved)).isDirectory()) throw new Error("폴더가 아닙니다.");
    const names = await readdir(resolved, { withFileTypes: true });
    const entries = names
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name, "ko", { numeric: true }) : a.isDirectory ? -1 : 1))
      .slice(0, MAX_ENTRIES);
    return { path: resolved, parent: parent === resolved ? null : parent, entries, shortcuts };
  } catch (error) {
    return { path: resolved, parent: parent === resolved ? null : parent, entries: [], shortcuts, error: error instanceof Error ? error.message : "폴더를 열지 못했습니다." };
  }
}

/** Model file names ComfyUI offers, for the suggestion lists in the settings. Empty lists when ComfyUI is off. */
export async function comfyModels(comfyUrl) {
  const comfy = createComfy(comfyUrl);
  return {
    diffusion: await comfy.options("UNETLoader", "unet_name"),
    textEncoder: await comfy.options("CLIPLoader", "clip_name"),
    vae: await comfy.options("VAELoader", "vae_name"),
    loras: await comfy.options("LoraLoaderModelOnly", "lora_name"),
    upscale: await comfy.options("UpscaleModelLoader", "model_name"),
  };
}

/** Reads a workflow file and asks ComfyUI whether every node class and model name in it exists. */
export async function checkWorkflow(file, comfyUrl) {
  if (typeof file !== "string" || !path.isAbsolute(file) || !/\.json$/i.test(file)) throw new HttpError(400, "워크플로는 .json 파일의 전체 경로여야 합니다.");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 20_000_000) throw new HttpError(404, "워크플로 파일을 찾을 수 없습니다.");
  const fail = (message) => ({ ok: false, problems: [message], missingNodes: [], missingModels: [] });
  let workflow;
  try {
    workflow = await loadApiWorkflow(file);
  } catch (error) {
    return fail(error instanceof WorkflowError ? error.message : "JSON을 읽을 수 없습니다.");
  }
  const comfy = createComfy(comfyUrl);
  const classes = [...new Set(Object.values(workflow).map((node) => node.class_type))];
  const infos = new Map(await Promise.all(classes.map(async (cls) => [cls, await comfy.nodeInfo(cls)])));
  if ([...infos.values()].every((value) => value === undefined)) return fail("ComfyUI에 연결할 수 없어 노드를 확인하지 못했습니다. ComfyUI를 켜고 다시 확인하세요.");
  const absent = missingNodes(workflow, infos);
  const absentModels = missingModels(workflow, infos);
  const count = (cls) => Object.values(workflow).filter((node) => node.class_type === cls).length;
  const problems = [
    ...(absent.length ? [`설치되지 않은 노드: ${absent.join(", ")}. 해당 커스텀 노드를 설치한 뒤 ComfyUI를 다시 시작하세요.`] : []),
    ...(absentModels.length ? [`ComfyUI에 없는 모델: ${absentModels.join("; ")}`] : []),
  ];
  return { ok: problems.length === 0, problems, missingNodes: absent, missingModels: absentModels, nodeCount: Object.keys(workflow).length, imageInputs: count("LoadImage"), videoInputs: count("LoadVideo"), audioInputs: count("LoadAudio") };
}
