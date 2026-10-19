// Settings shared by the server and the UI: defaults, validation, and project-over-global resolution.
// Global values live in data/settings.json (Settings screen, changed rarely). Per-project values live
// in studio/settings.json (start page, changed often) and only hold the keys that differ.

export const ASPECTS = ["16:9", "9:16", "1:1"];
export const VIDEO_MODES = ["T2V", "I2V", "FL2V", "R2V"];
export const AUDIO_SOURCES = ["input", "songyue", "h3", "lipsync"];
export const IMAGE_MODELS = ["krea2-turbo", "h3-still"];
export const UPSCALES = ["rtx-2pass", "none", "lanczos"];
export const MUSIC_FORMATS = ["wav", "flac", "mp3", "mp4"];
export const LLM_PROVIDERS = ["claude-cli", "codex-cli", "opencode-cli", "ollama"];

// Sizes are width x height. The image size is what the still is generated at; the video generate
// size is what the video model renders (then upscaled to final). All must be multiples of 32.
export const DEFAULTS = {
  defaults: {
    aspect: "16:9",
    durationSeconds: 60,
    videoMode: "I2V",
    audioSource: "input",
    imageModel: "krea2-turbo",
  },
  presets: {
    "16:9": { image: [1920, 1088], generate: [736, 416], final: [1920, 1088] },
    "9:16": { image: [1088, 1920], generate: [416, 736], final: [1088, 1920] },
    "1:1": { image: [1088, 1088], generate: [576, 576], final: [1088, 1088] },
  },
  image: { allowCustomSize: false },
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
  storage: { projectsDir: "" },
};

// Fields shown on the start page. Keep this at 7 or fewer; move the least-used one to the
// collapsed "this project only" area when it grows (docs/design.md 4.2).
export const START_PAGE_FIELDS = [
  "defaults.aspect",
  "defaults.durationSeconds",
  "defaults.videoMode",
  "defaults.audioSource",
  "defaults.imageModel",
  "llm.provider",
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
  "defaults.aspect": oneOf("화면 비율", ASPECTS),
  "defaults.durationSeconds": numBetween("목표 길이(초)", 2, 600),
  "defaults.videoMode": oneOf("영상 모드", VIDEO_MODES),
  "defaults.audioSource": oneOf("오디오 원천", AUDIO_SOURCES),
  "defaults.imageModel": oneOf("이미지 모델", IMAGE_MODELS),
  "image.allowCustomSize": bool("크기 직접 입력"),
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
  "storage.projectsDir": text("프로젝트 폴더"),
};
for (const aspect of ASPECTS) {
  for (const key of ["image", "generate", "final"]) {
    RULES[`presets.${aspect}.${key}`] = size(`${aspect} ${key} 크기`);
  }
}

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
