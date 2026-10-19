// Settings shared by the server and the UI: defaults, validation, and project-over-global resolution.
// Global values live in data/settings.json (Settings screen, changed rarely). Per-project values live
// in studio/settings.json (start page, changed often) and only hold the keys that differ.

// Video size presets: the size the video model renders (`generate`) and the size of the finished file
// (`final`); the RTX pass scales one into the other. Every side is a multiple of 32. Only the 16:9 1080p
// pair was tried end to end (OpenMontage h3_local_video defaults); the others are untested until P5.
export const SIZE_PRESETS = [
  { id: "s169-1080", group: "가로 16:9", label: "1080p (1920×1088)", generate: [736, 416], final: [1920, 1088], tested: true },
  { id: "s169-720", group: "가로 16:9", label: "720p (1280×704)", generate: [736, 416], final: [1280, 704], tested: false },
  { id: "s169-draft", group: "가로 16:9", label: "시안 (736×416, 확대 없음)", generate: [736, 416], final: [736, 416], tested: false },
  { id: "s219-cinema", group: "와이드 21:9", label: "시네마 (1792×768)", generate: [896, 384], final: [1792, 768], tested: false },
  { id: "s43-960", group: "가로 4:3", label: "960p (1280×960)", generate: [640, 480], final: [1280, 960], tested: false },
  { id: "s916-1080", group: "세로 9:16", label: "쇼츠·릴스 1080p (1088×1920)", generate: [416, 736], final: [1088, 1920], tested: false },
  { id: "s916-720", group: "세로 9:16", label: "720p (704×1280)", generate: [416, 736], final: [704, 1280], tested: false },
  { id: "s45-1280", group: "세로 4:5", label: "인스타 (1024×1280)", generate: [512, 640], final: [1024, 1280], tested: false },
  { id: "s34-1280", group: "세로 3:4", label: "1280p (960×1280)", generate: [480, 640], final: [960, 1280], tested: false },
  { id: "s11-1080", group: "정사각 1:1", label: "1080 (1088×1088)", generate: [576, 576], final: [1088, 1088], tested: false },
  { id: "s11-720", group: "정사각 1:1", label: "720 (704×704)", generate: [576, 576], final: [704, 704], tested: false },
];
export const CUSTOM_SIZE_ID = "custom";
export const VIDEO_MODES = ["T2V", "I2V", "FL2V", "R2V"];
export const AUDIO_SOURCES = ["input", "songyue", "h3", "s2v"];
export const IMAGE_MODELS = ["krea2-turbo", "h3-still"];
export const UPSCALES = ["rtx-2pass", "none", "lanczos"];
export const MUSIC_FORMATS = ["wav", "flac", "mp3", "mp4"];
export const LLM_PROVIDERS = ["claude-cli", "codex-cli", "opencode-cli", "ollama"];

// Sizes are [width, height]. `sizeId` picks a preset from SIZE_PRESETS or "custom", which uses `customSize`.
export const DEFAULTS = {
  defaults: {
    sizeId: "s169-1080",
    customSize: { generate: [736, 416], final: [1920, 1088] },
    durationSeconds: 60,
    videoMode: "I2V",
    audioSource: "input",
    imageModel: "krea2-turbo",
  },
  video: { model: "minimax-h3-turbo", upscale: "rtx-2pass", finalFps: 24 },
  audio: { musicFormat: "flac", voice: { tool: "qwen3_tts", name: "Sohee", language: "ko" } },
  llm: {
    provider: "claude-cli",
    chain: [...LLM_PROVIDERS],
    model: "",
    ollama: { endpoint: "http://127.0.0.1:11434", model: "" },
    timeoutSec: 180,
  },
  connections: {
    songyueUrl: "http://127.0.0.1:4311",
    comfyUrl: "http://127.0.0.1:8190",
    openmontageDir: "E:\\Claude\\OpenMontage",
    ffmpegPath: "",
  },
  // Empty means the default folder (see server/folders.mjs). Relative paths are relative to the app folder.
  storage: { projectsDir: "", inputDir: "", outputDir: "" },
};

// Fields shown on the start page. Keep this at 7 or fewer; move the least-used one to the
// collapsed "this project only" area when it grows (docs/design.md 4.2).
export const START_PAGE_FIELDS = [
  "defaults.sizeId",
  "defaults.durationSeconds",
  "defaults.videoMode",
  "defaults.audioSource",
  "defaults.imageModel",
];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const oneOf = (label, list) => (value) =>
  list.includes(value) ? null : `${label}: ${list.join(", ")} 중 하나여야 합니다.`;
const intBetween = (label, min, max) => (value) =>
  Number.isInteger(value) && value >= min && value <= max ? null : `${label}: ${min}~${max} 사이의 정수여야 합니다.`;
const numBetween = (label, min, max) => (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? null
    : `${label}: ${min}~${max} 사이의 숫자여야 합니다.`;
const bool = (label) => (value) => (typeof value === "boolean" ? null : `${label}: 켜짐/꺼짐 값이어야 합니다.`);
const text = (label, max = 500) => (value) =>
  typeof value === "string" && value.length <= max ? null : `${label}: ${max}자 이하의 문자열이어야 합니다.`;
// A folder path typed by the user: free text, but no control characters and not absurdly long.
const folder = (label) => (value) =>
  typeof value === "string" && value.length <= 500 && !/[\u0000\r\n]/.test(value) ? null : `${label}: 줄바꿈 없는 500자 이하의 경로여야 합니다.`;
const size = (label) => (value) =>
  Array.isArray(value) && value.length === 2 && value.every((n) => Number.isInteger(n) && n >= 64 && n <= 4096 && n % 32 === 0)
    ? null
    : `${label}: 64~4096 사이의 32의 배수 두 개(가로, 세로)여야 합니다.`;
const localUrl = (label) => (value) => {
  const message = `${label}: 이 PC의 http 주소(127.0.0.1 또는 localhost)여야 합니다.`;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) ? null : message;
  } catch {
    return message;
  }
};
const providerChain = (label) => (value) =>
  Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every((p) => LLM_PROVIDERS.includes(p))
    ? null
    : `${label}: ${LLM_PROVIDERS.join(", ")} 중 중복 없이 1개 이상이어야 합니다.`;

// One rule per leaf path of DEFAULTS (a test checks that none is missing).
const RULES = {
  "defaults.sizeId": oneOf("영상 크기", [...SIZE_PRESETS.map((preset) => preset.id), CUSTOM_SIZE_ID]),
  "defaults.customSize.generate": size("직접 입력 생성 크기"),
  "defaults.customSize.final": size("직접 입력 최종 크기"),
  "defaults.durationSeconds": numBetween("목표 길이(초)", 2, 600),
  "defaults.videoMode": oneOf("영상 모드", VIDEO_MODES),
  "defaults.audioSource": oneOf("오디오 원천", AUDIO_SOURCES),
  "defaults.imageModel": oneOf("이미지 모델", IMAGE_MODELS),
  "video.model": oneOf("영상 모델", ["minimax-h3-turbo"]),
  "video.upscale": oneOf("확대 방식", UPSCALES),
  "video.finalFps": intBetween("최종 FPS", 12, 60),
  "audio.musicFormat": oneOf("노래 저장 형식", MUSIC_FORMATS),
  "audio.voice.tool": text("음성 도구", 60),
  "audio.voice.name": text("음성 이름", 60),
  "audio.voice.language": text("음성 언어", 10),
  "llm.provider": oneOf("LLM 제공자", LLM_PROVIDERS),
  "llm.chain": providerChain("LLM 폴백 순서"),
  "llm.model": text("LLM 모델", 100),
  "llm.ollama.endpoint": localUrl("Ollama 주소"),
  "llm.ollama.model": text("Ollama 모델", 100),
  "llm.timeoutSec": intBetween("LLM 호출 제한 시간(초)", 30, 900),
  "connections.songyueUrl": localUrl("SongYUE2 주소"),
  "connections.comfyUrl": localUrl("ComfyUI 주소"),
  "connections.openmontageDir": text("OpenMontage 폴더"),
  "connections.ffmpegPath": text("ffmpeg 경로"),
  "storage.projectsDir": folder("프로젝트 폴더"),
  "storage.inputDir": folder("입력 폴더"),
  "storage.outputDir": folder("출력 폴더"),
};

export function leafPaths(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isObject(child) ? leafPaths(child, path) : [path];
  });
}

export function ruleFor(path) {
  return RULES[path];
}

/** Recursively merges `patch` into a copy of `base`. Arrays and scalars are replaced whole. */
export function deepMerge(base, patch) {
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (UNSAFE_KEYS.has(key)) continue;
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : structuredClone(value);
  }
  return out;
}

function walk(input, template, prefix, errors) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.hasOwn(template, key)) {
      errors.push({ path, message: "알 수 없는 설정 항목입니다." });
    } else if (isObject(template[key])) {
      if (isObject(value)) out[key] = walk(value, template[key], path, errors);
      else errors.push({ path, message: "객체여야 합니다." });
    } else {
      const message = RULES[path](value);
      if (message) errors.push({ path, message });
      else out[key] = structuredClone(value);
    }
  }
  return out;
}

/**
 * Validates a full or partial settings object. Unknown keys are errors so typos do not pass silently.
 * @returns {{ ok: boolean, value: object | null, errors: { path: string, message: string }[] }}
 */
export function validateSettings(input) {
  if (!isObject(input)) return { ok: false, value: null, errors: [{ path: "", message: "설정은 객체여야 합니다." }] };
  const errors = [];
  const value = walk(input, DEFAULTS, "", errors);
  return errors.length ? { ok: false, value: null, errors } : { ok: true, value, errors };
}

/** Effective settings: defaults, then global, then project. `overridden` lists keys the project sets. */
export function resolveSettings(global, project) {
  return {
    value: deepMerge(deepMerge(DEFAULTS, global ?? {}), project ?? {}),
    overridden: leafPaths(project ?? {}),
  };
}

/**
 * Snaps a duration to the video model's frame grid (17k + 5 frames, 24 fps generation).
 * @returns {{ frames: number, seconds: number }}
 */
export function snapFrames(seconds, fps = 24) {
  const k = Math.max(1, Math.round((seconds * fps - 5) / 17));
  const frames = 17 * k + 5;
  return { frames, seconds: frames / fps };
}

const roundTo32 = (value) => Math.max(64, Math.round(value / 32) * 32);

/** Size of the still image for a given final video size: same shape, long edge at most 1920. */
export function imageSizeFor(final) {
  const scale = Math.min(1, 1920 / Math.max(final[0], final[1]));
  return [roundTo32(final[0] * scale), roundTo32(final[1] * scale)];
}

/** Relative difference between the shapes of two [width, height] sizes (0 = same shape). */
export function shapeGap(a, b) {
  const ratioA = a[0] / a[1];
  const ratioB = b[0] / b[1];
  return Math.abs(ratioA - ratioB) / ratioB;
}

/** The effective video size of a settings tree: the chosen preset, or the custom size. */
export function resolveSize(settings) {
  const { sizeId, customSize } = settings.defaults;
  const preset = SIZE_PRESETS.find((item) => item.id === sizeId);
  const generate = preset ? preset.generate : customSize.generate;
  const final = preset ? preset.final : customSize.final;
  return {
    id: preset ? preset.id : CUSTOM_SIZE_ID,
    label: preset ? `${preset.group} ${preset.label}` : "직접 입력",
    generate,
    final,
    image: imageSizeFor(final),
    tested: preset ? preset.tested : false,
  };
}

/**
 * Lenient read of a stored settings object: keeps every valid value and drops what is unknown or
 * invalid (for example a key from an older version), so one stale key never hides the whole file.
 * Writes still go through validateSettings. `dropped` lists the dotted paths that were ignored.
 */
export function sanitizeSettings(input) {
  if (!isObject(input)) return { value: {}, dropped: [""] };
  const errors = [];
  const value = walk(input, DEFAULTS, "", errors);
  return { value, dropped: errors.map((error) => error.path) };
}
