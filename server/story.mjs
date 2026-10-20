import { readFile } from "node:fs/promises";

import { presetHint } from "../shared/presets.mjs";
import { HttpError } from "./http.mjs";

const read = (name) => readFile(new URL(`./prompts/${name}`, import.meta.url), "utf8");

let queue = Promise.resolve();
/** LLM calls one after another (also used by the prompt maker's own queue discipline). */
const serial = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

/** The first JSON object in an answer (the LLM may add a sentence or a code fence around it). */
export function parseJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("JSON이 없습니다.");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("JSON이 끝나지 않았습니다.");
}

/** Asks for JSON and checks it; one retry tells the model what was wrong. */
async function askJson(ask, systemFile, user, check) {
  const system = await read(systemFile);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await serial(() => ask(system, attempt === 0 ? user : `${user}\n\nYour previous answer was rejected: ${lastError}\nReturn only valid JSON in the requested shape.`));
    try {
      return check(parseJson(answer));
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${lastError}`);
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const directionLine = (preset) => (presetHint(preset) ? `DIRECTION STYLE: ${presetHint(preset)}` : "");

/** Story options from an idea: several distinct title + logline + synopsis candidates. */
export async function generateSynopses({ idea, preset, count = 4, totalSeconds = 60 }, ask) {
  if (!text(idea, 4000)) throw new HttpError(400, "아이디어를 입력하세요.");
  const wanted = Math.min(4, Math.max(1, Number(count) || 4));
  const user = [`IDEA:\n${idea.trim()}`, `OPTIONS: ${wanted}`, `TARGET LENGTH: about ${totalSeconds} seconds`, directionLine(preset)].filter(Boolean).join("\n\n");
  return askJson(ask, "story-synopsis.md", user, (data) => {
    const options = (Array.isArray(data.options) ? data.options : [])
      .map((option) => ({ title: text(option?.title, 60), logline: text(option?.logline, 300), synopsis: text(option?.synopsis, 4000) }))
      .filter((option) => option.synopsis);
    if (options.length === 0) throw new Error("options가 비어 있습니다.");
    return options.slice(0, wanted);
  });
}

/** Style, characters and places for the story bible, taken from the synopsis. */
export async function generateBible({ synopsis, preset }, ask) {
  if (!text(synopsis, 20000)) throw new HttpError(400, "먼저 줄거리를 쓰세요.");
  const user = [`SYNOPSIS:\n${synopsis.trim()}`, directionLine(preset)].filter(Boolean).join("\n\n");
  return askJson(ask, "story-bible.md", user, (data) => {
    const named = (list, limit) =>
      (Array.isArray(list) ? list : [])
        .map((item) => ({ name: text(item?.name, 60), description: text(item?.description, 1000) }))
        .filter((item) => item.name && item.description)
        .slice(0, limit);
    const characters = named(data.characters, 6).map((item, index) => ({ id: `c${index + 1}`, ...item }));
    if (characters.length === 0) throw new Error("characters가 비어 있습니다.");
    return { style: text(data.style, 500), characters, places: named(data.places, 5) };
  });
}

const bibleLines = (bible) =>
  [
    bible?.style ? `Visual style: ${bible.style}` : "",
    ...(bible?.characters ?? []).map((character) => `Character "${character.name}": ${character.description}`),
    ...(bible?.places ?? []).map((place) => `Place "${place.name}": ${place.description}`),
  ]
    .filter(Boolean)
    .join("\n");

const snap = (seconds) => Math.round(seconds * 2) / 2;

/**
 * The scene plan (OpenMontage's scene_plan schema): contiguous scenes, each 2-15 s. Durations are fixed here, not trusted:
 * snapped to half seconds, clamped, and scaled so the total is close to the target.
 */
export async function generateScenario({ synopsis, bible, preset, totalSeconds = 60 }, ask) {
  if (!text(synopsis, 20000)) throw new HttpError(400, "먼저 줄거리를 쓰세요.");
  const user = [`SYNOPSIS:\n${synopsis.trim()}`, bible ? `STORY BIBLE:\n${bibleLines(bible)}` : "", `TARGET LENGTH: ${totalSeconds} seconds`, directionLine(preset)].filter(Boolean).join("\n\n");
  return askJson(ask, "story-scenario.md", user, (data) => {
    const raw = (Array.isArray(data.scenes) ? data.scenes : []).map((scene) => ({ description: text(scene?.description, 3000), seconds: Number(scene?.seconds) })).filter((scene) => scene.description);
    if (raw.length === 0) throw new Error("scenes가 비어 있습니다.");
    const sum = raw.reduce((total, scene) => total + (scene.seconds > 0 ? scene.seconds : 5), 0);
    const factor = Math.abs(sum - totalSeconds) / totalSeconds > 0.25 ? totalSeconds / sum : 1;
    let at = 0;
    const scenes = raw.map((scene, index) => {
      const length = Math.min(15, Math.max(2, snap((scene.seconds > 0 ? scene.seconds : 5) * factor)));
      const entry = { id: `scene-${index + 1}`, type: "generated", description: scene.description, start_seconds: at, end_seconds: at + length };
      at += length;
      return entry;
    });
    return { version: "1.0", scenes };
  });
}

const KINDS = new Set(["dialogue", "sfx", "instrumental", "vocal"]);

/**
 * Sound sections for the scenes. Returns the script (OpenMontage's script schema), the kind of each section (kept in
 * studio/audio_kinds.json) and the scenes with `script_section_id` filled in.
 */
export async function generateScript({ synopsis, scenario, bible, title = "" }, ask) {
  const scenes = scenario?.scenes ?? [];
  if (scenes.length === 0) throw new HttpError(400, "먼저 시나리오를 만드세요.");
  const sceneLines = scenes.map((scene, index) => `${index + 1}. (${scene.end_seconds - scene.start_seconds}s) ${scene.description}`).join("\n");
  const user = [`SYNOPSIS:\n${(synopsis ?? "").trim()}`, bible ? `STORY BIBLE:\n${bibleLines(bible)}` : "", `SCENES:\n${sceneLines}`].filter(Boolean).join("\n\n");
  return askJson(ask, "story-script.md", user, (data) => {
    const sections = [];
    const kinds = {};
    const linked = scenes.map((scene) => ({ ...scene }));
    for (const item of Array.isArray(data.sections) ? data.sections : []) {
      const index = Math.round(Number(item?.scene)) - 1;
      const kind = KINDS.has(item?.kind) ? item.kind : "dialogue";
      // A sound effect or an instrumental is described in "text"; models often put that description into "style" and leave
      // "text" empty, so the style is taken as the description for those two kinds.
      const body = text(item?.text, 2000) || (kind === "sfx" || kind === "instrumental" ? text(item?.style, 2000) : "");
      if (!(index >= 0 && index < scenes.length) || !body) continue;
      const id = `s${sections.length + 1}`;
      const scene = scenes[index];
      const section = { id, label: `장면 ${index + 1}`, text: body, start_seconds: scene.start_seconds, end_seconds: scene.end_seconds };
      if (kind === "vocal" && text(item?.style, 300)) section.speaker_directions = text(item.style, 300);
      sections.push(section);
      kinds[id] = kind;
      if (!linked[index].script_section_id) linked[index].script_section_id = id;
    }
    if (sections.length === 0) throw new Error("sections가 비어 있습니다.");
    const total = Math.max(...scenes.map((scene) => scene.end_seconds));
    return { script: { version: "1.0", title, total_duration_seconds: total, sections }, kinds, scenes: linked };
  });
}
