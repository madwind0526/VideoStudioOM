import { resolveSize } from "../../shared/settings.mjs";
import { api, type Settings } from "../api";

export type MakeKind = "image" | "sheet" | "voice" | "sfx" | "instrumental" | "vocal" | "i2v" | "fl2v" | "s2v" | "r2v";

/** What a script section sounds like. Dialogue is read by TTS; the other three are made by SongYUE2. */
export type AudioKind = "dialogue" | "sfx" | "instrumental" | "vocal";
export const AUDIO_KINDS: { id: AudioKind; label: string; make: MakeKind }[] = [
  { id: "dialogue", label: "대화 (TTS)", make: "voice" },
  { id: "sfx", label: "효과음", make: "sfx" },
  { id: "instrumental", label: "연주곡", make: "instrumental" },
  { id: "vocal", label: "보컬", make: "vocal" },
];
/** studio/scene_opts.json: options of single scenes (scene_plan.json has no field for them): LoRAs, how the clip is made, a saved prompt. */
export const SCENE_OPTS_FILE = "studio/scene_opts.json";
export interface SceneLora {
  name: string;
  strength: number;
}
export interface SceneOpt {
  /** LoRAs that only this scene uses (a fight move, a look). */
  loras?: SceneLora[];
  /** How the clip is made: from a first and a last picture ("fl2v", the default), a first picture ("i2v"), a face and the song ("s2v") or reference pictures of the people ("r2v"). */
  mode?: "fl2v" | "i2v" | "s2v" | "r2v";
  /** Connected to the clip before: the clip before ends on the picture this one starts with (fl2v), or this one starts from its last picture (r2v). On unless switched off. */
  continuePrevious?: boolean;
  /** The song of the project guides the mouth in this scene. Unset: on when the scene shows people. */
  song?: boolean;
  /** Reference pictures chosen for this scene instead of the ones its text calls for. */
  refs?: string[];
  /** The clip prompt kept for this scene (the prompt maker is not asked again for it). */
  prompt?: string;
}
export type SceneOpts = Record<string, SceneOpt>;

/** Sidecar file with the kind of every script section (script.json itself follows OpenMontage's fixed schema). */
export const AUDIO_KINDS_FILE = "studio/audio_kinds.json";
export const audioKindOf = (kinds: Record<string, string> | null | undefined, id: string): AudioKind => (AUDIO_KINDS.some((kind) => kind.id === kinds?.[id]) ? (kinds?.[id] as AudioKind) : "dialogue");

/** How a generated file was made. Saved next to the file so it can be made again. */
export interface Recipe {
  kind: MakeKind;
  /** Picture or motion description (image, video), the spoken line (voice), the sound description in English (sfx) or style tags (instrumental, vocal). */
  prompt: string;
  /** Words to sing (vocal). */
  lyrics?: string;
  /** LoRAs that only this scene uses, added after the ones of the settings. */
  loras?: SceneLora[];
  /** The user's own short description, kept when `prompt` was written by the prompt maker. */
  idea?: string;
  first?: string;
  last?: string;
  audio?: string;
  /** Reference pictures of an R2V clip (character sheets, a scene picture), at most nine. */
  refs?: string[];
  /** Reference clip of an R2V clip: the new clip follows its motion and camera. */
  refVideo?: string;
  duration?: number;
  /** Scene or script section this file belongs to. */
  source?: string;
  /** [start, length] of the piece of the audio file that is the guide of the clip (a scene's part of the song). */
  audioRange?: [number, number];
  /** The clip before this one: its last picture is the first picture here. */
  continuedFrom?: string;
  /** A picture made as a new picture of the people in these reference pictures (Qwen image edit on an empty canvas) instead of from the text alone. */
  editRefs?: string[];
  /** A picture edited with other pictures (Qwen edit): the first is the one that changes, the others are named in the prompt as <image2>, <image3>, ... */
  editFrom?: string[];
  /** The picture whose pose or depth a Krea 2 + Pose / Krea 2 + Depth picture follows. */
  controlFrom?: string;
  /** The model of a text-to-image picture (see shared/imageModels.mjs), Krea 2 Turbo when missing. */
  imageModel?: string;
  /** The sampling values that differ from the model's defaults (steps, cfg, sampler_name, scheduler), kept so that making it again uses them. */
  sampling?: Record<string, number | string>;
  /** With editRefs: keep the people of the references ("person", default) or only take their style, colours and mood ("style"). */
  refMode?: RefMode;
  /** A picture whose pose the new picture follows (used with editRefs). */
  pose?: string;
}

export type RefMode = "person" | "style";

export interface MakeItem {
  tool: string;
  label: string;
  inputs: Record<string, unknown>;
  record: Recipe;
  /** The prompt is already the one to use (a saved prompt of the scene), so the prompt maker is not asked. */
  final?: boolean;
  /** The result is saved as another version of this file instead of a file of its own. */
  candidateOf?: string;
}

export const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(2, 14);

/** Reads a stored record back as a recipe, or null when it is missing or from another version. */
export function recipeOf(record: Record<string, unknown> | null | undefined): Recipe | null {
  if (!record || typeof record.prompt !== "string") return null;
  return ["image", "sheet", "voice", "sfx", "instrumental", "vocal", "i2v", "fl2v", "s2v", "r2v"].includes(String(record.kind)) ? (record as unknown as Recipe) : null;
}

/** The prompt of a picture made from reference pictures: <image1> is the empty canvas, the references follow. */
export const editPrompt = (text: string, count: number, mode: RefMode = "person", pose = false) => {
  const names = Array.from({ length: count }, (_, i) => `<image${i + 2}>`).join(", ");
  const keep =
    mode === "style"
      ? `Use ${names} only as a reference for the art style, colour palette, light and mood; the subject and the composition are new.`
      : `The ${count > 1 ? "people" : "person"} shown in ${names} must keep exactly the same face, hair and clothes.`;
  const posing = pose ? ` The figure takes exactly the pose of the figure in <image${count + 2}>; copy only that pose, not its look, clothes or background.` : "";
  return `Fill <image1> with a completely new picture. ${keep}${posing} ${text}`;
};

/** The job for one recipe, built from the current settings. The result goes to `output` (a project-relative path). */
export function makeItem(settings: Settings, recipe: Recipe, output: string): MakeItem | string {
  const size = resolveSize(settings);
  const text = recipe.prompt.trim();
  if (!text) return recipe.kind === "voice" ? "읽을 대사를 입력하세요." : "내용을 입력하세요.";
  const sceneLoras = recipe.loras && recipe.loras.length > 0 ? { extra_loras: recipe.loras } : {};
  if (recipe.kind === "image" && recipe.editFrom && recipe.editFrom.length > 0 && (recipe.imageModel === "krea2-identity" || recipe.imageModel === "flux2-klein-edit")) {
    return { tool: "comfyui_edit_model", label: text, record: recipe, inputs: { model: recipe.imageModel === "krea2-identity" ? "krea2-identity" : "flux2-klein", prompt: text, reference_image_path: recipe.editFrom[0], reference_image_paths: recipe.editFrom.slice(1, 4), ...(recipe.sampling ?? {}), output_path: output } };
  }
  if (recipe.kind === "image" && recipe.editFrom && recipe.editFrom.length > 0) {
    // The result has the shape of the first picture, so no size is given.
    return { tool: "comfyui_image_edit", label: text, record: recipe, inputs: { prompt: text, reference_image_path: recipe.editFrom[0], reference_image_paths: recipe.editFrom.slice(1, 10), ...(recipe.sampling ?? {}), output_path: output } };
  }
  if (recipe.kind === "image" && recipe.editRefs && recipe.editRefs.length > 0) {
    const refs = recipe.editRefs.slice(0, recipe.pose ? 8 : 9);
    return {
      tool: "comfyui_image_edit",
      label: text,
      record: recipe,
      // The pose picture goes last, after the references.
      inputs: { prompt: editPrompt(text, refs.length, recipe.refMode, Boolean(recipe.pose)), blank_canvas: true, reference_image_paths: recipe.pose ? [...refs, recipe.pose] : refs, width: size.image[0], height: size.image[1], ...(recipe.sampling ?? {}), output_path: output },
    };
  }
  if (recipe.kind === "image" && recipe.controlFrom && (recipe.imageModel === "krea2-pose" || recipe.imageModel === "krea2-depth")) {
    return { tool: "comfyui_krea_control", label: text, record: recipe, inputs: { control: recipe.imageModel === "krea2-pose" ? "pose" : "depth", prompt: text, control_image_path: recipe.controlFrom, ...(recipe.sampling ?? {}), output_path: output } };
  }
  if (recipe.kind === "image" && recipe.imageModel && recipe.imageModel !== "krea2-turbo") {
    return { tool: "comfyui_t2i", label: text, record: recipe, inputs: { model: recipe.imageModel, prompt: text, width: size.image[0], height: size.image[1], ...(recipe.sampling ?? {}), output_path: output } };
  }
  if (recipe.kind === "image") {
    return { tool: "comfyui_krea_image", label: text, record: recipe, inputs: { prompt: text, width: size.image[0], height: size.image[1], ...sceneLoras, ...(recipe.sampling ?? {}), output_path: output } };
  }
  if (recipe.kind === "sheet") {
    // Same image tool, models and LoRAs; `slot` only picks the character-sheet workflow when one is set.
    return { tool: "comfyui_krea_image", label: text, record: recipe, inputs: { prompt: text, width: size.image[0], height: size.image[1], slot: "sheet", output_path: output } };
  }
  if (recipe.kind === "voice") {
    return { tool: "qwen3_tts", label: text, record: recipe, inputs: { text, voice: settings.audio.voice.name, language: settings.audio.voice.language, output_path: output } };
  }
  if (recipe.kind === "sfx") {
    const seconds = Math.min(30, Math.max(1, recipe.duration ?? 5));
    return { tool: "songyue_sfx", label: text, record: recipe, inputs: { prompt: text, duration_seconds: seconds, output_path: output } };
  }
  if (recipe.kind === "instrumental") return { tool: "songyue_music", label: text, record: recipe, inputs: { prompt: text, output_path: output } };
  if (recipe.kind === "vocal") {
    const lyrics = (recipe.lyrics ?? "").trim();
    if (!lyrics) return "가사를 입력하세요.";
    return { tool: "songyue_music", label: text, record: recipe, inputs: { prompt: text, lyrics, output_path: output } };
  }
  const duration = recipe.duration ?? 5;
  if (!(duration >= 2 && duration <= 15)) return "길이는 2~15초로 입력하세요.";
  // Only the RTX pass is wired to the tool; other settings mean "no enlargement" for now.
  const upscale = settings.video.upscale === "rtx-2pass" && size.final[0] > size.generate[0];
  const inputs: Record<string, unknown> = {
    prompt: text,
    width: size.generate[0],
    height: size.generate[1],
    duration_seconds: duration,
    upscale,
    upscale_scale: size.final[0] / size.generate[0],
    // The upscale rounds to multiples of 32; the finished clip is cut to exactly the chosen size.
    ...(upscale ? { final_size: size.final } : {}),
    ...sceneLoras,
    output_path: output,
  };
  if (recipe.kind === "r2v") {
    const refs = recipe.refs ?? [];
    if (refs.length === 0 && !recipe.refVideo) return "참조할 그림(인물 시트나 장면 이미지)이나 참조 영상을 하나 이상 고르세요.";
    if (refs.length > 9) return "참조 그림은 9장까지입니다.";
    inputs.reference_image_paths = refs;
    // Motion continuation (settings): the clip saves its latent and, after another clip, pins that clip's last frames.
    if (settings.video.continueMode === "motion") inputs.continue_mode = "motion";
    if (recipe.refVideo) inputs.reference_video_path = recipe.refVideo;
    if (recipe.audio) {
      // The song (or a piece of it, see audioRange) moves the mouth of the people in the clip.
      inputs.audio_path = recipe.audio;
      if (recipe.audioRange) inputs.audio_range = recipe.audioRange;
    }
    if (recipe.continuedFrom) inputs.first_frame_video_path = recipe.continuedFrom;
    return { tool: "h3_reference_video", label: text, record: recipe, inputs };
  }
  // A clip that continues the one before starts from its last frame instead of a picture of its own (not fl2v: that one shares a picture).
  const motion = settings.video.continueMode === "motion" && recipe.kind !== "fl2v";
  if (!recipe.first && !(recipe.continuedFrom && recipe.kind !== "fl2v")) return "첫 이미지를 고르세요. 이미지가 없으면 이미지 화면에서 먼저 만드세요.";
  if (recipe.first) inputs.reference_image_path = recipe.first;
  else inputs.first_frame_video_path = recipe.continuedFrom;
  // Motion continuation (settings): the clip saves its latent and, after another clip, pins that clip's last frames.
  if (motion) inputs.continue_mode = "motion";
  if (recipe.kind === "fl2v") {
    if (!recipe.last || recipe.last === recipe.first) return "서로 다른 첫 이미지와 마지막 이미지를 고르세요.";
    inputs.last_frame_path = recipe.last;
  }
  if (recipe.kind === "s2v" && !recipe.audio) return "얼굴 이미지와 음성을 고르세요. 음성은 오디오 화면에서 만들 수 있습니다.";
  if (recipe.audio) {
    // The audio guides the mouth (a whole file, or the piece in audioRange: a scene's part of the song).
    inputs.audio_path = recipe.audio;
    if (recipe.audioRange) inputs.audio_range = recipe.audioRange;
  }
  return { tool: "h3_local_video", label: text, record: recipe, inputs };
}

/** The job that enlarges a picture (RTX): the result becomes another version of the picture, so the original is kept. */
export function upscaleItem(file: string, record: Recipe, scale: number, how: { workflow?: string; model?: string } = {}): MakeItem {
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const inputs = { image_path: file, scale, ...(how.workflow && how.workflow !== "rtx" ? { workflow: how.workflow, model: how.model } : {}), output_path: `assets/versions/${name}-up-${stamp()}.png` };
  return { tool: "image_upscale", label: `확대 ×${scale}`, record, final: true, candidateOf: file, inputs };
}

/** How a picture is enlarged: the scale, and the workflow with its model (RTX when none). */
export interface UpscaleHow {
  scale: number;
  workflow?: string;
  model?: string;
}

/** The items followed by one enlarge job per picture (all pictures first, so the GPU swaps models once); no choice adds nothing. */
export const withUpscale = (items: MakeItem[], how: UpscaleHow | null): MakeItem[] => (how ? [...items, ...items.map((item) => upscaleItem(String(item.inputs.output_path), item.record, how.scale, how))] : items);

/** Starts one job, or a run of jobs that go one after another (a failure stops the rest). */
export async function startItems(projectId: string, items: MakeItem[]): Promise<void> {
  const body = items.map((item) => ({ tool: item.tool, label: item.label, inputs: item.inputs, record: item.record, candidateOf: item.candidateOf }));
  await api("POST", "/api/jobs", { project: projectId, items: body });
}

/** Asks the LLM to write a model-ready prompt (Krea 2 for images, MiniMax H3 for video, English for sound effects). */
export async function makePrompt(projectId: string, body: { target: "image" | "video" | "sfx" | "sheet"; mode?: string; text: string; duration?: number; hasAudio?: boolean; first?: string; last?: string; refs?: string[]; refPaths?: string[]; refVideo?: string }): Promise<string> {
  const { prompt } = await api<{ prompt: string }>("POST", "/api/prompt", { project: projectId, ...body });
  return prompt;
}

/** Copies a picture picked in the file browser into the project (assets/images) and returns its project path. */
export const importImage = (projectId: string, from: string) => api<{ path: string }>("POST", `/api/projects/${encodeURIComponent(projectId)}/import`, { from }).then((data) => data.path);
/** Puts a picture from the file browser at a fixed name of the project (clip number-1 / -2), cut to `size` without stretching. */
export const importPicture = (projectId: string, from: string, as: string, size: [number, number]) =>
  api<{ path: string }>("POST", `/api/projects/${encodeURIComponent(projectId)}/import`, { from, as, fit: size }).then((data) => data.path);
/** Moves the first/last picture files to where the changed scene list wants them (see pictureMoves in shared/scenes.mjs). */
export const arrangePictures = (projectId: string, body: { moves: { from: string | null; to: string | null }[]; clips: { clip: string; first: string; last: string | null }[] }) =>
  api<{ copied: number; aside: number }>("POST", `/api/projects/${encodeURIComponent(projectId)}/arrange`, body);
export const importAudio = (projectId: string, from: string) => api<{ path: string }>("POST", `/api/projects/${encodeURIComponent(projectId)}/import`, { from, kind: "audio" }).then((data) => data.path);

export const deleteMedia = (projectId: string, rel: string) => api("DELETE", `/api/projects/${encodeURIComponent(projectId)}/media?path=${encodeURIComponent(rel)}`);

export interface JoinOptions {
  colorMatch?: boolean;
  overlapSeconds?: number | "auto";
  seamColor?: boolean;
}
export const joinMedia = (projectId: string, kind: "audio" | "video", inputs: string[], options: JoinOptions = {}) =>
  api<{ output: string; count: number; resized: number }>("POST", `/api/projects/${encodeURIComponent(projectId)}/concat`, { kind, inputs, ...options });

/** Audio pieces laid on one timeline: each starts at its own second. */
export const mixMedia = (projectId: string, inputs: { path: string; start: number; role: "dialogue" | "sfx" | "music" }[], duck: boolean) =>
  api<{ output: string; count: number }>("POST", `/api/projects/${encodeURIComponent(projectId)}/concat`, { kind: "mix", inputs, duck });

const projectUrl = (projectId: string, what: string) => `/api/projects/${encodeURIComponent(projectId)}/${what}`;

export interface ClipCheck {
  path: string;
  durationSeconds: number;
  issues: { type: "black" | "freeze"; start: number; seconds: number }[];
}

/** Black and frozen stretches of every video file of the project. */
export const checkClips = (projectId: string) => api<{ results: ClipCheck[] }>("POST", projectUrl(projectId, "qa"), {}).then((data) => data.results);
/** SRT of the spoken lines of the script, saved as renders/subtitles.srt. */
export const makeSubtitles = (projectId: string) => api<{ output: string }>("POST", projectUrl(projectId, "subtitles"), {});
export const exportFinal = (projectId: string, options: { codec: string; burnSubtitles: boolean; sound: boolean }) =>
  api<{ output: string; codec: string; sound: boolean; subtitles: boolean }>("POST", projectUrl(projectId, "export"), options);
export const listCodecs = () => api<{ codecs: { id: string; label: string }[] }>("GET", "/api/export/codecs").then((data) => data.codecs);

/** Rewrites an item's prompt with the prompt maker (images, video clips, non-English sound effects). Items it cannot improve come back unchanged. */
export async function refineItem(projectId: string, settings: Settings, item: MakeItem, describeRef?: (path: string) => string): Promise<MakeItem> {
  const recipe = item.record;
  const target = recipe.kind === "image" ? "image" : recipe.kind === "fl2v" || recipe.kind === "i2v" || recipe.kind === "s2v" || recipe.kind === "r2v" ? "video" : recipe.kind === "sfx" && /[^\x00-\x7F]/.test(recipe.prompt) ? "sfx" : null;
  if (!target) return item;
  const prompt = await makePrompt(projectId, { target, mode: recipe.kind, text: recipe.prompt, duration: recipe.duration, first: recipe.first ?? recipe.continuedFrom, last: recipe.last, refs: recipe.refs && describeRef ? recipe.refs.map(describeRef) : undefined, refPaths: recipe.refs, refVideo: recipe.refVideo });
  const next = makeItem(settings, { ...recipe, prompt, idea: recipe.prompt }, String(item.inputs.output_path));
  return typeof next === "string" ? item : next;
}

/** The texts the model was really given, stored in the file's record when it was made. */
export function sentOf(record: Record<string, unknown> | null | undefined): { node: string; key: string; text: string }[] {
  const sent = record?.sent;
  return Array.isArray(sent) ? sent.filter((entry): entry is { node: string; key: string; text: string } => typeof entry?.text === "string") : [];
}

/** Versions and prompt history of one file (studio/versions.json). The shown file is the `selected` version. */
export interface VersionEntry {
  selected: string | null;
  versions: { id: string; file: string; record: Record<string, unknown> | null; createdAt: number }[];
  log: { at: number; type: "saved" | "remade" | "selected"; prompt?: string; lyrics?: string; version?: string }[];
  draft: { prompt: string; lyrics?: string } | null;
}
const versionsUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/versions`;
export const getVersions = (projectId: string, path: string) => api<{ entry: VersionEntry }>("GET", `${versionsUrl(projectId)}?path=${encodeURIComponent(path)}`).then((data) => data.entry);
export const saveDraft = (projectId: string, path: string, prompt: string) => api<{ entry: VersionEntry }>("PUT", versionsUrl(projectId), { path, prompt }).then((data) => data.entry);
export const selectVersion = (projectId: string, path: string, select: string) => api<{ entry: VersionEntry }>("POST", versionsUrl(projectId), { path, select }).then((data) => data.entry);

export const baseName = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
