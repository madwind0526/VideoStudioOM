// Collects the prompts that ComfyUI stored in the PNG files of a folder (one folder per day) and sorts their phrases into the categories
// of the random-mix pool.
//
//   node scripts/extract-prompts/build.mjs <image folder> <output folder> [--merge http://127.0.0.1:4314]
//
// Writes into <output folder>:
//   prompts.txt             every different prompt, separated by a line of five dashes (the file the prompt picker of the image menu reads)
//   prompt-categories.json  all phrases found, by category, with how often they were used
//   prompt-pool.json        the pool of the image menu with the phrases added (only with --merge; importable on the pool screen)
// With --merge the phrases are also added to the saved pool of the running app.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { classifyPrompt, fixMojibake, hasMinor, keyOf } from "./classify.mjs";

const [imageRoot, outDir, ...flags] = process.argv.slice(2);
if (!imageRoot || !outDir) {
  console.error("usage: node scripts/extract-prompts/build.mjs <image folder> <output folder> [--merge http://127.0.0.1:4314]");
  process.exit(1);
}
const mergeAt = flags[0] === "--merge" ? flags[1] : null;
// --retag: the gender marks of phrases that are already in the pool are set again (otherwise only missing ones are filled in).
const retag = flags.includes("--retag");

/** Where each kind of phrase goes in the pool: the id and the name on the screen (ids of the built-in pool are kept). */
const TARGETS = {
  gender: { id: "gender", label: "성별", cap: 5 },
  age: { id: "age", label: "나이", cap: 10 },
  hair: { id: "hair", label: "머리", cap: 80 },
  outfit: { id: "outfit", label: "의상", cap: 150 },
  expression: { id: "expression", label: "표정·시선", cap: 70 },
  action: { id: "action", label: "동작", cap: 100 },
  place: { id: "place", label: "배경", cap: 120 },
  composition: { id: "camera", label: "구도", cap: 40 },
  gear: { id: "gear", label: "카메라", cap: 40 },
  lighting: { id: "lighting", label: "조명", cap: 80 },
  palette: { id: "palette", label: "색감", cap: 12 },
  mood: { id: "mood", label: "분위기", cap: 60 },
};
/** The order of the categories on the screen (the order the phrases are joined in). */
const ORDER = ["gender", "age", "hair", "person", "outfit", "expression", "action", "place", "time", "camera", "gear", "lighting", "palette", "mood", "style", "prop"];
/** The pool keeps at most this many phrases per category. */
const MAX_PHRASES = 300;

// ---- 1. the prompts of the pictures
function promptChunk(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let at = 8;
    while (at + 12 <= size) {
      const head = Buffer.alloc(8);
      fs.readSync(fd, head, 0, 8, at);
      const length = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      if (type === "IDAT" || type === "IEND") return null;
      if (type === "tEXt" || type === "iTXt" || type === "zTXt") {
        const data = Buffer.alloc(length);
        fs.readSync(fd, data, 0, length, at + 8);
        const zero = data.indexOf(0);
        if (data.toString("latin1", 0, zero) === "prompt") {
          if (type === "tEXt") return data.toString("utf8", zero + 1);
          if (type === "zTXt") return zlib.inflateSync(data.subarray(zero + 2)).toString("utf8");
          let rest = data.subarray(zero + 3);
          rest = rest.subarray(rest.indexOf(0) + 1);
          rest = rest.subarray(rest.indexOf(0) + 1);
          return (data[zero + 1] === 1 ? zlib.inflateSync(rest) : rest).toString("utf8");
        }
      }
      at += 12 + length;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

const files = [];
for (const day of fs.readdirSync(imageRoot, { withFileTypes: true })) {
  if (!day.isDirectory()) continue;
  for (const name of fs.readdirSync(path.join(imageRoot, day.name))) {
    if (!/\.png$/i.test(name)) continue;
    const file = path.join(imageRoot, day.name, name);
    files.push({ file, mtime: fs.statSync(file).mtimeMs });
  }
}
files.sort((a, b) => a.mtime - b.mtime);

const prompts = new Map();
let withoutPrompt = 0;
for (const { file } of files) {
  let graph = null;
  try {
    const raw = promptChunk(file);
    graph = raw ? JSON.parse(raw) : null;
  } catch {
    graph = null;
  }
  // The final text of the wildcard node is what was really sent to the model.
  const texts = Object.values(graph ?? {})
    .filter((node) => node.class_type === "ImpactWildcardProcessor" && typeof node.inputs?.populated_text === "string")
    .map((node) => fixMojibake(node.inputs.populated_text).replace(/\r\n/g, "\n").trim())
    .filter(Boolean);
  if (texts.length === 0) withoutPrompt += 1;
  for (const text of texts) prompts.set(text.replace(/\s+/g, " "), text);
}
const list = [...prompts.values()];
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "prompts.txt"), `${list.join("\n\n-----\n\n")}\n`, "utf8");

// ---- 2. the phrases by category
/** Kinds of phrases that depend on the gender of the person (the pool uses `for` to keep them from the other gender). */
const GENDERED = new Set(["outfit", "hair", "expression", "action"]);
const FEMALE = /\b(her|she|woman|women|girl|female|lady|bikini|bra|thong|lingerie|dress|gown|skirt|halter|corset|camisole|blouse|stockings|heels|strapless|lace|ruffled?|sarong|one-piece|crop top|mini|bodysuit|leggings|tights|spaghetti|off-shoulder|cropped|belly|navel|midriff|makeup|lipstick|nail polish|bangs|ponytail|pigtails?|braids?)\b/i;
const MALE = /\b(his|he|him|man|men|male|guy|tuxedo|necktie|beard|mustache|stubble)\b/i;
/** The words of a phrase decide; a phrase without words of either gender fits both (most of the archive is about women, so the source prompt says little). */
function genderOfPhrase(kind, item) {
  if (!GENDERED.has(kind)) return "";
  const female = FEMALE.test(item.text);
  const male = MALE.test(item.text);
  return female !== male ? (female ? "woman" : "man") : "";
}
/** The phrases of the built-in (Korean) pool that clearly belong to one gender. */
const KOREAN_WOMAN = /원피스|드레스|스커트|치마|비키니|블라우스|하이힐|레이스|베일|이브닝|새틴|플리츠|크롭/;
const KOREAN_MAN = /턱시도|넥타이|보타이|양복|수염/;

const found = {};
let skippedMinor = 0;
for (const text of list) {
  if (hasMinor(text)) {
    skippedMinor += 1;
    continue;
  }
  const phrasesOf = classifyPrompt(text);
  const promptGender = phrasesOf.gender?.includes("man") && !phrasesOf.gender.includes("woman") ? "man" : phrasesOf.gender?.includes("woman") && !phrasesOf.gender.includes("man") ? "woman" : "";
  for (const [kind, phrases] of Object.entries(phrasesOf)) {
    found[kind] ??= new Map();
    for (const phrase of new Set(phrases)) {
      // Phrases that only differ at the end count as one.
      const key = keyOf(phrase).slice(0, kind === "palette" ? 90 : 60);
      const item = found[kind].get(key) ?? { text: phrase, count: 0, women: 0, men: 0 };
      item.count += 1;
      if (promptGender === "woman") item.women += 1;
      if (promptGender === "man") item.men += 1;
      found[kind].set(key, item);
    }
  }
}
const hash = (text) => [...text].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);
const all = {};
for (const [kind, map] of Object.entries(found)) all[kind] = [...map.values()].sort((a, b) => b.count - a.count || hash(a.text) - hash(b.text));
fs.writeFileSync(path.join(outDir, "prompt-categories.json"), JSON.stringify({ prompts: list.length, skippedMinor, categories: all }, null, 1), "utf8");

// ---- 3. the phrases for the pool
const weightOf = (kind, item) => {
  if (kind === "gender") return item.text === "woman" ? 4 : 1;
  if (kind === "age") return item.text === "young adult" ? 4 : item.text === "adult" ? 2 : 1;
  return Math.max(1, Math.min(4, Math.round(Math.log2(item.count + 1))));
};
const additions = {};
for (const [kind, target] of Object.entries(TARGETS)) {
  let items = all[kind] ?? [];
  if (kind === "palette") items = items.filter((item) => !/\b(street|sofa|couple|bookshop|apartment|living-room)\b/i.test(item.text));
  additions[target.id] = { label: target.label, phrases: items.slice(0, target.cap).map((item) => ({ text: item.text, weight: weightOf(kind, item), ...(genderOfPhrase(kind, item) ? { for: genderOfPhrase(kind, item) } : {}) })) };
}

/** The saved pool with the new phrases added: known categories get the phrases they did not have, new ones are appended. */
function merge(pool) {
  const byId = new Map(pool.categories.map((category) => [category.id, { ...category, phrases: [...category.phrases] }]));
  for (const [id, added] of Object.entries(additions)) {
    const category = byId.get(id) ?? { id, label: added.label, phrases: [] };
    // The built-in outfits of one gender (dress, tuxedo, ...) get their mark too.
    if (id === "outfit") for (const phrase of category.phrases) if (!phrase.for && (KOREAN_WOMAN.test(phrase.text) !== KOREAN_MAN.test(phrase.text))) phrase.for = KOREAN_WOMAN.test(phrase.text) ? "woman" : "man";
    const known = new Map(category.phrases.map((phrase) => [keyOf(phrase.text).slice(0, 60), phrase]));
    for (const phrase of added.phrases) {
      const key = keyOf(phrase.text).slice(0, 60);
      if (known.has(key)) {
        // Added before: only the gender mark can be new.
        const existing = known.get(key);
        if (retag) {
          if (phrase.for) existing.for = phrase.for;
          else delete existing.for;
        } else if (phrase.for && !existing.for) existing.for = phrase.for;
        continue;
      }
      if (category.phrases.length >= MAX_PHRASES) continue;
      known.set(key, phrase);
      category.phrases.push(phrase);
    }
    byId.set(id, category);
  }
  const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return { categories: [...byId.values()].sort((a, b) => rank(a.id) - rank(b.id)) };
}

console.log(JSON.stringify({ pngFiles: files.length, withoutPrompt, differentPrompts: list.length, skippedMinor, phrasesFound: Object.fromEntries(Object.entries(all).map(([kind, items]) => [kind, items.length])), forPool: Object.fromEntries(Object.entries(additions).map(([id, item]) => [id, item.phrases.length])) }, null, 1));

if (mergeAt) {
  const { token } = await (await fetch(`${mergeAt}/api/session`)).json();
  const headers = { "content-type": "application/json", "x-studio-token": token };
  const current = (await (await fetch(`${mergeAt}/api/images/pool`)).json()).pool;
  const merged = merge(current);
  const response = await fetch(`${mergeAt}/api/images/pool`, { method: "PUT", headers, body: JSON.stringify({ pool: merged }) });
  if (!response.ok) throw new Error(`pool was not saved: ${response.status} ${await response.text()}`);
  fs.writeFileSync(path.join(outDir, "prompt-pool.json"), JSON.stringify(merged, null, 1), "utf8");
  console.log("pool saved:", merged.categories.map((category) => `${category.label}(${category.phrases.length})`).join(" "));
}
