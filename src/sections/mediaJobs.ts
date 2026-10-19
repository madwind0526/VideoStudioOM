import { resolveSize } from "../../shared/settings.mjs";
import { api, type Settings } from "../api";

export type MakeKind = "image" | "voice" | "i2v" | "fl2v" | "s2v";

/** How a generated file was made. Saved next to the file so it can be made again. */
export interface Recipe {
  kind: MakeKind;
  /** Picture or motion description (image, video) or the spoken line (voice). */
  prompt: string;
  first?: string;
  last?: string;
  audio?: string;
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
  return ["image", "voice", "i2v", "fl2v", "s2v"].includes(String(record.kind)) ? (record as unknown as Recipe) : null;
}

/** The job for one recipe, built from the current settings. The result goes to `output` (a project-relative path). */
export function makeItem(settings: Settings, recipe: Recipe, output: string): MakeItem | string {
  const size = resolveSize(settings);
  const text = recipe.prompt.trim();
  if (!text) return recipe.kind === "voice" ? "읽을 대사를 입력하세요." : "내용을 입력하세요.";
  if (recipe.kind === "image") {
    return { tool: "comfyui_krea_image", label: text, record: recipe, inputs: { prompt: text, width: size.image[0], height: size.image[1], output_path: output } };
  }
  if (recipe.kind === "voice") {
    return { tool: "qwen3_tts", label: text, record: recipe, inputs: { text, voice: settings.audio.voice.name, language: settings.audio.voice.language, output_path: output } };
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

export const deleteMedia = (projectId: string, rel: string) => api("DELETE", `/api/projects/${encodeURIComponent(projectId)}/media?path=${encodeURIComponent(rel)}`);

export const joinMedia = (projectId: string, kind: "audio" | "video", inputs: string[]) =>
  api<{ output: string; count: number }>("POST", `/api/projects/${encodeURIComponent(projectId)}/concat`, { kind, inputs });

export const baseName = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
