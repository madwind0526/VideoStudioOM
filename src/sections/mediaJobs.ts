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
  /** The user's own short description, kept when `prompt` was written by the prompt maker. */
  idea?: string;
  first?: string;
  last?: string;
  audio?: string;
  /** Reference pictures of an R2V clip (character sheets, a scene picture), at most nine. */
  refs?: string[];
  duration?: number;
  /** Scene or script section this file belongs to. */
  source?: string;
}

export interface MakeItem {
  tool: string;
  label: string;
  inputs: Record<string, unknown>;
  record: Recipe;
}

export const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(2, 14);

/** Reads a stored record back as a recipe, or null when it is missing or from another version. */
export function recipeOf(record: Record<string, unknown> | null | undefined): Recipe | null {
  if (!record || typeof record.prompt !== "string") return null;
  return ["image", "sheet", "voice", "sfx", "instrumental", "vocal", "i2v", "fl2v", "s2v", "r2v"].includes(String(record.kind)) ? (record as unknown as Recipe) : null;
}

/** The job for one recipe, built from the current settings. The result goes to `output` (a project-relative path). */
export function makeItem(settings: Settings, recipe: Recipe, output: string): MakeItem | string {
  const size = resolveSize(settings);
  const text = recipe.prompt.trim();
  if (!text) return recipe.kind === "voice" ? "읽을 대사를 입력하세요." : "내용을 입력하세요.";
  if (recipe.kind === "image") {
    return { tool: "comfyui_krea_image", label: text, record: recipe, inputs: { prompt: text, width: size.image[0], height: size.image[1], output_path: output } };
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
  const inputs: Record<string, unknown> = {
    prompt: text,
    width: size.generate[0],
    height: size.generate[1],
    duration_seconds: duration,
    // Only the RTX pass is wired to the tool; other settings mean "no enlargement" for now.
    upscale: settings.video.upscale === "rtx-2pass" && size.final[0] > size.generate[0],
    upscale_scale: size.final[0] / size.generate[0],
    output_path: output,
  };
  if (recipe.kind === "r2v") {
    const refs = recipe.refs ?? [];
    if (refs.length === 0) return "참조할 그림(인물 시트나 장면 이미지)을 하나 이상 고르세요.";
    if (refs.length > 9) return "참조 그림은 9장까지입니다.";
    inputs.reference_image_paths = refs;
    return { tool: "h3_reference_video", label: text, record: recipe, inputs };
  }
  if (!recipe.first) return "첫 이미지를 고르세요. 이미지가 없으면 이미지 화면에서 먼저 만드세요.";
  inputs.reference_image_path = recipe.first;
  if (recipe.kind === "fl2v") {
    if (!recipe.last || recipe.last === recipe.first) return "서로 다른 첫 이미지와 마지막 이미지를 고르세요.";
    inputs.last_frame_path = recipe.last;
  }
  if (recipe.kind === "s2v") {
    if (!recipe.audio) return "얼굴 이미지와 음성을 고르세요. 음성은 오디오 화면에서 만들 수 있습니다.";
    inputs.audio_path = recipe.audio;
  }
  return { tool: "h3_local_video", label: text, record: recipe, inputs };
}

/** Starts one job, or a run of jobs that go one after another (a failure stops the rest). */
export async function startItems(projectId: string, items: MakeItem[]): Promise<void> {
  const body = items.map((item) => ({ tool: item.tool, label: item.label, inputs: item.inputs, record: item.record }));
  await api("POST", "/api/jobs", { project: projectId, items: body });
}

/** Asks the LLM to write a model-ready prompt (Krea 2 for images, MiniMax H3 for video, English for sound effects). */
export async function makePrompt(projectId: string, body: { target: "image" | "video" | "sfx" | "sheet"; mode?: string; text: string; duration?: number; hasAudio?: boolean; first?: string; last?: string; refs?: string[] }): Promise<string> {
  const { prompt } = await api<{ prompt: string }>("POST", "/api/prompt", { project: projectId, ...body });
  return prompt;
}

export const deleteMedia = (projectId: string, rel: string) => api("DELETE", `/api/projects/${encodeURIComponent(projectId)}/media?path=${encodeURIComponent(rel)}`);

export const joinMedia = (projectId: string, kind: "audio" | "video", inputs: string[], options: { colorMatch?: boolean } = {}) =>
  api<{ output: string; count: number }>("POST", `/api/projects/${encodeURIComponent(projectId)}/concat`, { kind, inputs, ...options });

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
  const prompt = await makePrompt(projectId, { target, mode: recipe.kind, text: recipe.prompt, duration: recipe.duration, first: recipe.first, last: recipe.last, refs: recipe.refs && describeRef ? recipe.refs.map(describeRef) : undefined });
  const next = makeItem(settings, { ...recipe, prompt, idea: recipe.prompt }, String(item.inputs.output_path));
  return typeof next === "string" ? item : next;
}

export const baseName = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
