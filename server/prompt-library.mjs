import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";
import { parseJson } from "./story.mjs";

/** The four shelves of the prompt library: what is made (image, video) and where (Local = ComfyUI, API = an online service). */
export const PROMPT_GROUPS = [
  { id: "image-local", label: "이미지-Local" },
  { id: "video-local", label: "동영상-Local" },
  { id: "image-api", label: "이미지-API" },
  { id: "video-api", label: "동영상-API" },
];
const GROUP_IDS = new Set(PROMPT_GROUPS.map((group) => group.id));
const MAX_ITEMS = 2000;
const MAX_TEXT = 20_000;
const MAX_TITLE = 120;
/** Blocks sent to the LLM at once, and how much of each block it sees. */
const BATCH = 12;
const PREVIEW = 700;

const idOf = (text) => createHash("sha1").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);

/** The saved library, or an empty one. */
export async function readLibrary(file) {
  try {
    const { items } = JSON.parse(await readFile(file, "utf8"));
    return { items: Array.isArray(items) ? items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeLibrary(file, library) {
  await writeFileAtomic(file, `${JSON.stringify(library, null, 2)}\n`);
  return library;
}

/** A prompt as the screen may send it; anything else is refused. `partial` keeps the missing fields out (an edit). */
export function checkItem(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "프롬프트 정보가 필요합니다.");
  const out = {};
  if (!partial || input.group !== undefined) {
    if (!GROUP_IDS.has(input.group)) throw new HttpError(400, "분류는 이미지-Local, 동영상-Local, 이미지-API, 동영상-API 중 하나입니다.");
    out.group = input.group;
  }
  if (!partial || input.text !== undefined) {
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > MAX_TEXT) throw new HttpError(400, `프롬프트는 1~${MAX_TEXT}자로 입력하세요.`);
    out.text = input.text.trim();
  }
  if (!partial || input.title !== undefined) {
    if (typeof input.title !== "string" || !input.title.trim()) throw new HttpError(400, "제목을 입력하세요.");
    out.title = input.title.trim().slice(0, MAX_TITLE);
  }
  if (input.thumb !== undefined) {
    // A picture of the image library (project-relative path) or "" for none.
    if (typeof input.thumb !== "string" || input.thumb.length > 300 || /(^|[\\/])\.\.([\\/]|$)/.test(input.thumb)) throw new HttpError(400, "썸네일 경로가 올바르지 않습니다.");
    out.thumb = input.thumb;
  }
  if (input.note !== undefined) out.note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  return out;
}

/** Adds items that are not in the library yet (same text); returns how many were added and how many were already there. */
export async function addItems(file, inputs) {
  const library = await readLibrary(file);
  const known = new Set(library.items.map((item) => item.id));
  let added = 0;
  for (const input of inputs) {
    const item = checkItem(input);
    const id = idOf(item.text);
    if (known.has(id)) continue;
    if (library.items.length >= MAX_ITEMS) throw new HttpError(400, `프롬프트는 ${MAX_ITEMS}개까지 보관할 수 있습니다.`);
    known.add(id);
    library.items.push({ id, ...item, createdAt: new Date().toISOString() });
    added += 1;
  }
  if (added) await writeLibrary(file, library);
  return { added, skipped: inputs.length - added, items: library.items };
}

export async function updateItem(file, id, patch) {
  const library = await readLibrary(file);
  const item = library.items.find((entry) => entry.id === id);
  if (!item) throw new HttpError(404, "없는 프롬프트입니다.");
  Object.assign(item, checkItem(patch, { partial: true }));
  await writeLibrary(file, library);
  return item;
}

export async function deleteItem(file, id) {
  const library = await readLibrary(file);
  const items = library.items.filter((entry) => entry.id !== id);
  if (items.length === library.items.length) throw new HttpError(404, "없는 프롬프트입니다.");
  await writeLibrary(file, { items });
}

/** Markdown escapes (\_ \& ...) and bold marks of pasted text are taken out. */
const unescape = (text) => text.replace(/\\([_&*#.\-()[\]!>])/g, "$1").replace(/\*\*/g, "");

/**
 * The prompts of a text file: blocks apart by two or more blank lines. A short block that is only a heading (######) is not a
 * prompt: it becomes the context of the blocks after it.
 */
export function splitBlocks(text) {
  const blocks = [];
  let heading = "";
  for (const raw of unescape(text.replace(/\r\n/g, "\n")).split(/\n{3,}/)) {
    const block = raw.trim();
    if (!block) continue;
    const head = /^#{1,6}\s*(.+)$/.exec(block.split("\n")[0]);
    const body = head ? block.split("\n").slice(1).join("\n").trim() : block;
    if (head) heading = head[1].trim();
    if (body.length < 40) continue;
    blocks.push({ heading, text: body.slice(0, MAX_TEXT) });
  }
  return blocks;
}

const SYSTEM = `You sort prompts that a user collected for AI picture and video makers.

You get a numbered list of text blocks (each cut short). For every block decide:
- "skip": true when it is NOT a prompt for making a picture or a video (links, setup notes, shell commands, music or lyrics instructions, chat instructions, node lists).
- otherwise "group", one of:
  "image-local"  a picture prompt that an open model run in ComfyUI can make (Qwen Image, Flux, Z-Image, SDXL, Krea, plain descriptions)
  "video-local"  a video prompt for an open model run in ComfyUI (Wan, LTX, Hunyuan, MiniMax H3 local, image-to-video descriptions)
  "image-api"    a picture prompt written for an online service (Nano Banana, Gemini, GPT Image, Midjourney, Ideogram...) or one that needs its strength (long layouts, infographics, text rendering, a person kept from a photo)
  "video-api"    a video prompt written for an online service (Sora, Veo, Kling, Seedance, Runway, Hailuo...)
  When the block names the service, follow it. When it does not, plain picture prompts are image-local and plain video prompts are video-local.
- "title": a short Korean title (max 30 characters) that says what the prompt makes.

Return JSON only: {"items": [{"i": 0, "skip": false, "group": "image-local", "title": "..."}, ...]} with one entry per block.`;

/** The LLM's sorting of blocks: [{ skip, group, title }] in the order of `blocks`. A batch that stays unusable fails the import. */
export async function classifyBlocks(blocks, ask) {
  const out = [];
  for (let start = 0; start < blocks.length; start += BATCH) {
    const batch = blocks.slice(start, start + BATCH);
    const user = batch.map((block, index) => `[${index}]${block.heading ? ` (section: ${block.heading})` : ""}\n${block.text.slice(0, PREVIEW)}`).join("\n\n");
    let problem = "";
    let sorted = null;
    for (let attempt = 0; attempt < 2 && !sorted; attempt += 1) {
      try {
        const answer = await ask(SYSTEM, attempt === 0 ? user : `${user}\n\nYour previous answer was rejected: ${problem}\nReturn only valid JSON in the format above.`);
        const items = parseJson(answer).items;
        if (!Array.isArray(items)) throw new Error("items 목록이 없습니다.");
        sorted = batch.map((_, index) => {
          const entry = items.find((item) => Number(item?.i) === index);
          if (!entry) throw new Error(`[${index}]번 판정이 없습니다.`);
          if (entry.skip === true) return { skip: true };
          if (!GROUP_IDS.has(entry.group) || typeof entry.title !== "string" || !entry.title.trim()) throw new Error(`[${index}]번의 분류나 제목이 올바르지 않습니다.`);
          return { skip: false, group: entry.group, title: entry.title.trim().slice(0, MAX_TITLE) };
        });
      } catch (error) {
        problem = error.message;
      }
    }
    if (!sorted) throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${problem}`);
    out.push(...sorted);
  }
  return out;
}

const TEXT_FILES = /\.(txt|md)$/i;

/** Reads the .txt and .md files of a folder (not the sub-folders), sorts their blocks and adds the prompts to the library. */
export async function importFolder({ dir, file, ask }) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new HttpError(400, "폴더의 전체 경로를 입력하세요.");
  let names;
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile() && TEXT_FILES.test(entry.name)).map((entry) => entry.name);
  } catch {
    throw new HttpError(400, `폴더를 읽을 수 없습니다: ${dir}`);
  }
  const library = await readLibrary(file);
  const known = new Set(library.items.map((item) => item.id));
  const blocks = [];
  for (const name of names.sort()) {
    for (const block of splitBlocks(await readFile(path.join(dir, name), "utf8"))) if (!known.has(idOf(block.text))) blocks.push({ ...block, source: name });
  }
  const sorted = await classifyBlocks(blocks, ask);
  const found = blocks.flatMap((block, index) => (sorted[index].skip ? [] : [{ group: sorted[index].group, title: sorted[index].title, text: block.text, note: `가져옴: ${block.source}` }]));
  const result = await addItems(file, found);
  return { files: names.length, blocks: blocks.length, added: result.added, skipped: blocks.length - found.length, items: result.items };
}
