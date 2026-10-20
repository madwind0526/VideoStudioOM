import path from "node:path";

import { HttpError } from "./http.mjs";
import { resolveInside } from "./paths.mjs";

// Only the free local tools this app drives; the bridge would run any registered tool otherwise.
export const ALLOWED_TOOLS = new Set(["comfyui_krea_image", "h3_local_video", "h3_reference_video", "character_sheet", "qwen3_tts", "songyue_music", "songyue_sfx"]);
const OUTPUT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".wav", ".mp3", ".flac"]);

/**
 * Turns a browser request into tool inputs: every *_path value is a path relative to the project and
 * becomes an absolute path inside it. Outputs may only go under assets/.
 */
export async function prepareInputs(projectDir, inputs) {
  if (inputs === null || typeof inputs !== "object" || Array.isArray(inputs)) throw new HttpError(400, "inputs는 객체여야 합니다.");
  const prepared = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (key.endsWith("_dir")) throw new HttpError(400, `지원하지 않는 입력입니다: ${key}`);
    if (key.endsWith("_paths")) {
      // A list of project-relative files (e.g. several reference images); each one is checked like a single path.
      if (!Array.isArray(value) || value.length > 9 || value.some((item) => typeof item !== "string")) throw new HttpError(400, `${key}는 경로 문자열 목록이어야 합니다.`);
      prepared[key] = await Promise.all(value.map((item) => resolveInside(projectDir, item)));
      continue;
    }
    if (!key.endsWith("_path")) {
      prepared[key] = value;
      continue;
    }
    if (typeof value !== "string") throw new HttpError(400, `${key}는 경로 문자열이어야 합니다.`);
    const target = await resolveInside(projectDir, value);
    if (key === "output_path") {
      const segments = value.split(/[\\/]/);
      if (segments.length < 2 || segments[0].toLowerCase() !== "assets" || !OUTPUT_EXTENSIONS.has(path.extname(value).toLowerCase())) {
        throw new HttpError(400, "결과 파일은 assets/ 아래의 이미지, 영상, 오디오 파일이어야 합니다.");
      }
    }
    prepared[key] = target;
  }
  if (!prepared.output_path) throw new HttpError(400, "output_path가 필요합니다.");
  return prepared;
}
