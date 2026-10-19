import {
  AUDIO_SOURCES,
  IMAGE_MODELS,
  MUSIC_FORMATS,
  UPSCALES,
  VIDEO_MODES,
} from "../shared/settings.mjs";

export type FieldKind = "select" | "segmented" | "number" | "text" | "bool" | "size" | "chain";

export interface FieldDef {
  path: string;
  label: string;
  kind: FieldKind;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** Shown (muted) in an empty text field: the default that applies when it stays empty. */
  placeholder?: string;
  wide?: boolean;
}

const options = (values: readonly string[], labels: Record<string, string> = {}) =>
  values.map((value) => ({ value, label: labels[value] ?? value }));

const VIDEO_MODE_LABELS = { T2V: "T2V 텍스트 → 영상", I2V: "I2V 첫 이미지 → 영상", FL2V: "FL2V 첫+끝 이미지", R2V: "R2V 참조 영상/이미지" };
const AUDIO_LABELS = { input: "입력한 노래", songyue: "SongYUE2로 생성", h3: "H3 자체 오디오", s2v: "S2V (음성 → 영상)" };
const IMAGE_LABELS = { "krea2-turbo": "Krea 2 Turbo", "h3-still": "H3 스틸" };
const UPSCALE_LABELS = { "rtx-2pass": "RTX 2패스", none: "없음", lanczos: "Lanczos" };

export const FIELDS: Record<string, FieldDef> = {};
const add = (def: FieldDef) => {
  FIELDS[def.path] = def;
};

add({ path: "defaults.customSize.generate", label: "생성 크기", kind: "size", hint: "영상 모델이 만드는 크기(가로 × 세로, 32의 배수)" });
add({ path: "defaults.customSize.final", label: "최종 크기", kind: "size", hint: "완성 파일 크기. 생성 크기와 모양이 같아야 합니다." });
add({ path: "defaults.durationSeconds", label: "목표 길이(초)", kind: "number", min: 2, max: 600, step: 1 });
add({ path: "defaults.videoMode", label: "영상 모드", kind: "select", options: options(VIDEO_MODES, VIDEO_MODE_LABELS) });
add({ path: "defaults.audioSource", label: "오디오 원천", kind: "select", options: options(AUDIO_SOURCES, AUDIO_LABELS) });
add({ path: "defaults.imageModel", label: "이미지 모델", kind: "select", options: options(IMAGE_MODELS, IMAGE_LABELS) });

add({ path: "video.model", label: "영상 모델", kind: "select", options: [{ value: "minimax-h3-turbo", label: "MiniMax H3 Turbo" }] });
add({ path: "video.upscale", label: "확대 방식", kind: "select", options: options(UPSCALES, UPSCALE_LABELS) });
add({ path: "video.finalFps", label: "최종 FPS", kind: "number", min: 12, max: 60, step: 1, hint: "생성은 24fps, 최종 파일에서 변환합니다." });

add({ path: "audio.musicFormat", label: "노래 저장 형식", kind: "select", options: options(MUSIC_FORMATS) });
add({ path: "audio.voice.tool", label: "음성 도구", kind: "text" });
add({ path: "audio.voice.name", label: "음성 이름", kind: "text" });
add({ path: "audio.voice.language", label: "음성 언어", kind: "text" });

add({ path: "llm.chain", label: "폴백 순서", kind: "chain", wide: true, hint: "선택한 LLM이 실패하면 아래 순서대로 다음 것을 씁니다." });
add({ path: "llm.model", label: "LLM 모델 이름", kind: "text", placeholder: "비워 두면 CLI의 기본 모델", wide: true });
add({ path: "llm.ollama.endpoint", label: "연결 주소", kind: "text", wide: true });
add({ path: "llm.ollama.model", label: "LLM 모델 이름", kind: "text", placeholder: "예: gemma4:latest", wide: true });
add({ path: "llm.timeoutSec", label: "호출 제한 시간(초)", kind: "number", min: 30, max: 900, step: 10 });

add({ path: "connections.songyueUrl", label: "SongYUE2 연결 주소", kind: "text", wide: true });
add({ path: "connections.comfyUrl", label: "ComfyUI 연결 주소", kind: "text", wide: true });
add({ path: "connections.openmontageDir", label: "OpenMontage 폴더", kind: "text", wide: true });
add({ path: "connections.ffmpegPath", label: "ffmpeg 경로", kind: "text", wide: true, placeholder: "PATH의 ffmpeg" });
add({ path: "storage.projectsDir", label: "프로젝트 폴더", kind: "text", wide: true, placeholder: "OpenMontage 폴더의 projects", hint: "바꾸면 서버를 다시 시작해야 새 폴더를 지켜봅니다." });
add({ path: "storage.inputDir", label: "입력 폴더", kind: "text", wide: true, placeholder: "input", hint: "가져올 노래, 참조 이미지·영상을 두는 곳입니다." });
add({ path: "storage.outputDir", label: "출력 폴더", kind: "text", wide: true, placeholder: "output", hint: "내보낸 완성본이 저장되는 곳입니다." });

/** Settings that can be overridden for one project from the collapsed area of the start page. */
export const PROJECT_ONLY_PATHS = ["video.upscale", "video.finalFps", "audio.musicFormat"];

export function getIn(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), object);
}

/** Immutable set: returns a copy of `object` with `value` at the dotted `path`. */
export function setIn(object: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const child = rest.length === 0 ? value : setIn((object[head] as Record<string, unknown> | undefined) ?? {}, rest.join("."), value);
  return { ...object, [head]: child };
}

/** Dotted paths whose values differ between two settings trees (arrays compared by content). */
export function changedPaths(before: unknown, after: unknown, paths: string[]): string[] {
  return paths.filter((path) => JSON.stringify(getIn(before, path)) !== JSON.stringify(getIn(after, path)));
}
