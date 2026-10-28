// Settings shared by the server and the UI: defaults, validation, and project-over-global resolution.
// Global values live in data/settings.json (Settings screen, changed rarely). Per-project values live
// in studio/settings.json (start page, changed often) and only hold the keys that differ.

// Video size = the size the video model renders (`generate`): a pixel budget x an aspect ratio, each side a multiple of 32.
// Nothing is enlarged afterwards for now (the finished size is the generated size). "custom" in place of a ratio uses
// `customSize.generate` as typed.
export const SIZE_MEGAPIXELS = [0.3, 0.5, 0.7, 1, 1.5];
export const ASPECTS = [
  { id: "16x9", label: "16:9", w: 16, h: 9 },
  { id: "21x9", label: "21:9", w: 21, h: 9 },
  { id: "4x3", label: "4:3", w: 4, h: 3 },
  { id: "5x4", label: "5:4", w: 5, h: 4 },
  { id: "1x1", label: "1:1", w: 1, h: 1 },
];
// A ratio is written wide (16:9); "portrait" turns it around (9:16).
export const ORIENTATIONS = ["landscape", "portrait"];
export const CUSTOM_SIZE_ID = "custom";
export const VIDEO_MODES = ["T2V", "I2V", "FL2V", "R2V"];
export const AUDIO_SOURCES = ["input", "songyue", "h3", "s2v"];
export const IMAGE_MODELS = ["krea2-turbo", "h3-still"];
export const UPSCALES = ["rtx-2pass", "none", "lanczos"];
// Same ids as server/codecs.mjs (a test keeps them equal).
export const VIDEO_CODECS = ["h264", "h265", "nvenc_h264", "nvenc_h265", "nvenc_av1"];
export const MUSIC_FORMATS = ["wav", "flac", "mp3", "mp4"];
export const LLM_PROVIDERS = ["claude-cli", "codex-cli", "opencode-cli", "ollama"];

// Sizes are [width, height]. `sizeMegapixels`, `aspect` and `orientation` give the video size; aspect "custom" uses `customSize`.
export const DEFAULTS = {
  defaults: {
    sizeMegapixels: 1,
    aspect: "16x9",
    orientation: "landscape",
    customSize: { generate: [736, 416] },
    durationSeconds: 60,
    videoMode: "I2V",
    audioSource: "input",
    // Project path of the song picked for audioSource "input" (set per project on the start page).
    songFile: "",
    imageModel: "krea2-turbo",
  },
  video: { model: "minimax-h3-turbo", upscale: "rtx-2pass", finalFps: 24, seamRampSeconds: 3, codec: "h264", freeVramWhenIdle: true },
  audio: { musicFormat: "flac", voice: { tool: "qwen3_tts", name: "Sohee", language: "ko" } },
  llm: {
    provider: "claude-cli",
    chain: [...LLM_PROVIDERS],
    model: "",
    ollama: { endpoint: "http://127.0.0.1:11434", model: "" },
    timeoutSec: 180,
    // System prompt of the character-sheet prompt maker. Empty means the bundled server/prompts/character-sheet.md.
    sheetPrompt: "",
  },
  connections: {
    songyueUrl: "http://127.0.0.1:4311",
    comfyUrl: "http://127.0.0.1:8190",
    // Where SongYUE2 lives (its backend, its ComfyUI with Krea and H3, its speech engine).
    songyueDir: "C:\\Claude\\SongYUE2",
    // The second ComfyUI (Rev0 portable): the two-stage reference video (H3 latent upscaler, Deno nodes) and the RTX 2-pass upscale
    // run here. Its results are read from <refDir>/ComfyUI/output.
    refUrl: "http://127.0.0.1:8188",
    refDir: "C:\\ComfyUI-Portable\\ComfyUI-Rev0",
    ffmpegPath: "",
  },
  // Advanced: empty means the built-in workflow and models. A workflow file (ComfyUI API format) replaces the built-in
  // one; model names and LoRAs then replace what that workflow loads, and the upscaler model replaces its upscaler.
  engine: {
    image: { workflowT2I: "", workflowI2I: "", workflowSheet: "", diffusion: "", textEncoder: "", vae: "", loras: [] },
    video: { workflowT2V: "", workflowI2V: "", workflowR2V: "", diffusion: "", textEncoder: "", vae: "", loras: [] },
    upscale: { model: "" },
  },
  // Empty means the default folder (see server/folders.mjs). Relative paths are relative to the app folder.
  storage: { projectsDir: "", inputDir: "", outputDir: "" },
};

// Fields shown on the start page. Keep this at 7 or fewer; move the least-used one to the
// collapsed "this project only" area when it grows (docs/design.md 4.2).
export const START_PAGE_FIELDS = [
  "defaults.sizeMegapixels",
  "defaults.aspect",
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
const loraList = (label) => (value) =>
  Array.isArray(value) &&
  value.length <= 8 &&
  value.every(
    (lora) =>
      isObject(lora) &&
      Object.keys(lora).every((key) => key === "name" || key === "strength") &&
      typeof lora.name === "string" &&
      lora.name.length > 0 &&
      lora.name.length <= 300 &&
      typeof lora.strength === "number" &&
      lora.strength >= -4 &&
      lora.strength <= 4,
  )
    ? null
    : `${label}: 이름과 강도(-4~4)를 가진 항목 8개 이하여야 합니다.`;
const providerChain = (label) => (value) =>
  Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every((p) => LLM_PROVIDERS.includes(p))
    ? null
    : `${label}: ${LLM_PROVIDERS.join(", ")} 중 중복 없이 1개 이상이어야 합니다.`;

// One rule per leaf path of DEFAULTS (a test checks that none is missing).
const RULES = {
  "defaults.sizeMegapixels": oneOf("영상 크기(백만 화소)", SIZE_MEGAPIXELS),
  "defaults.aspect": oneOf("영상 비율", [...ASPECTS.map((aspect) => aspect.id), CUSTOM_SIZE_ID]),
  "defaults.orientation": oneOf("영상 방향", ORIENTATIONS),
  "defaults.customSize.generate": size("직접 입력 생성 크기"),
  "defaults.durationSeconds": numBetween("목표 길이(초)", 2, 600),
  "defaults.videoMode": oneOf("영상 모드", VIDEO_MODES),
  "defaults.audioSource": oneOf("오디오 원천", AUDIO_SOURCES),
  "defaults.songFile": text("노래 파일", 300),
  "defaults.imageModel": oneOf("이미지 모델", IMAGE_MODELS),
  "video.model": oneOf("영상 모델", ["minimax-h3-turbo"]),
  "video.upscale": oneOf("확대 방식", UPSCALES),
  "video.finalFps": intBetween("최종 FPS", 12, 60),
  "video.seamRampSeconds": numBetween("이음새 색 보정 구간(초)", 0.5, 10),
  "video.codec": oneOf("영상 저장 방식", VIDEO_CODECS),
  "video.freeVramWhenIdle": bool("작업이 끝나면 VRAM 비우기"),
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
  "llm.sheetPrompt": text("캐릭터 시트 시스템 프롬프트", 20000),
  "connections.songyueUrl": localUrl("SongYUE2 주소"),
  "connections.comfyUrl": localUrl("ComfyUI 주소"),
  "connections.songyueDir": folder("SongYUE2 폴더"),
  "connections.refUrl": localUrl("참조 영상 ComfyUI 주소"),
  "connections.refDir": folder("참조 영상 ComfyUI 폴더"),
  "connections.ffmpegPath": text("ffmpeg 경로"),
  "engine.image.workflowT2I": folder("image T2I 워크플로"),
  "engine.image.workflowI2I": folder("image I2I 워크플로"),
  "engine.image.workflowSheet": folder("캐릭터 시트 워크플로"),
  "engine.image.diffusion": text("diffusion 모델", 300),
  "engine.image.textEncoder": text("text encoder", 300),
  "engine.image.vae": text("VAE", 300),
  "engine.image.loras": loraList("image LoRA"),
  "engine.video.workflowT2V": folder("video T2V 워크플로"),
  "engine.video.workflowI2V": folder("video I2V 워크플로"),
  "engine.video.workflowR2V": folder("video R2V 워크플로"),
  "engine.video.diffusion": text("diffusion 모델", 300),
  "engine.video.textEncoder": text("text encoder", 300),
  "engine.video.vae": text("VAE", 300),
  "engine.video.loras": loraList("video LoRA"),
  "engine.upscale.model": text("업스케일 모델", 300),
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

/** [width, height] of a given pixel count at one aspect ratio, each side a multiple of 32 (64..4096). */
export function sizeFor(pixels, aspect, orientation = "landscape") {
  const [w, h] = orientation === "portrait" ? [aspect.h, aspect.w] : [aspect.w, aspect.h];
  const fit = (value) => Math.min(4096, roundTo32(value));
  return [fit(Math.sqrt((pixels * w) / h)), fit(Math.sqrt((pixels * h) / w))];
}

/** The effective video size of a settings tree: the chosen budget at the chosen ratio, or the custom size. `final` is `generate` (no enlargement). */
export function resolveSize(settings) {
  const { sizeMegapixels, aspect, orientation, customSize } = settings.defaults;
  const ratio = ASPECTS.find((item) => item.id === aspect);
  const generate = ratio ? sizeFor(sizeMegapixels * 1_000_000, ratio, orientation) : customSize.generate;
  return {
    id: ratio ? `${sizeMegapixels}m-${ratio.id}-${orientation}` : CUSTOM_SIZE_ID,
    label: ratio ? `${sizeMegapixels}M ${ratio.label} ${orientation === "portrait" ? "세로" : "가로"}` : "직접 입력",
    generate,
    final: generate,
    image: imageSizeFor(generate),
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
