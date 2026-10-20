import { readFile } from "node:fs/promises";

import { snapFrames } from "../shared/settings.mjs";
import { HttpError } from "./http.mjs";
import { askLlm } from "./llm.mjs";

const read = (name) => readFile(new URL(`./prompts/${name}`, import.meta.url), "utf8");

export const TARGETS = ["image", "video", "sfx", "sheet"];
export const VIDEO_MODES = ["t2v", "i2v", "fl2v", "s2v", "r2v"];

// First lines the H3 guide prescribes when pictures are given. They are added here, not written by the LLM, so they stay exact.
const FIRST_FRAME = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
const firstAndLast = (seconds) =>
  `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the ${seconds.toFixed(2)}-second mark of the target video.`;

const MODE_TASKS = {
  t2v: "TASK: text to video. No reference picture; build the whole timeline from the idea.",
  i2v: "TASK: image to video. <Picture 1> is the real first frame at 0.00 seconds and belongs to [Shot 1]. Establish its style, subject, composition and scene anchors first, keep identity, clothing, colours and layout consistent, then develop forward: first-frame anchor, action onset, continuous development, result or reaction. Do not write the alignment line; it is added automatically.",
  fl2v: "TASK: first and last frame to video. <Picture 1> is the opening and <Picture 2> the ending. Describe the path between them: how the subject moves, how poses, objects, composition and light change, with the differences narrowing until the last frame is reached by the end of the final shot. Use a single shot. Do not write the alignment line; it is added automatically.",
  s2v: "TASK: sound to video (lip sync). <Picture 1> is the first frame (the speaker's face). A real recording is supplied separately and is placed into the clip as <Audio 1>: the speaker's lips stay synchronized with every syllable of it, and the mouth stays unobstructed. Do not invent dialogue, a song or sound events that are not in the idea; put no <d> lines unless the idea quotes the words. Use a single shot. Do not write the alignment line; it is added automatically.",
  r2v: "TASK: reference to video. Reference pictures are <Picture 1>, <Picture 2> ... and an optional reference clip is <Video 1>. Give every reference an explicit job in a full sentence (who or what it is, what it fixes). Keep identity, face, hair and outfit of the subject identical to the pictures, and follow the reference clip's motion and camera when one is given.",
};

let queue = Promise.resolve();

/** LLM calls one after another: a CLI call can take a minute and several at once only slow each other down. */
const serial = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

/**
 * Writes the prompt for one image, video clip or sound effect from the user's short idea.
 * `ask(system, user)` returns the LLM text (the server passes askLlm bound to the settings; tests pass a fake).
 */
export async function makePrompt({ target, mode, text, duration, title, firstPrompt, lastPrompt, refs = [], bible = "" }, ask) {
  if (!TARGETS.includes(target)) throw new HttpError(400, "만들 대상이 올바르지 않습니다.");
  if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new HttpError(400, "설명은 1~4000자로 입력하세요.");
  const context = [title ? `Project title: ${title}` : "", firstPrompt ? `Prompt of <Picture 1> (what the first frame shows): ${firstPrompt}` : "", lastPrompt ? `Prompt of <Picture 2> (what the last frame shows): ${lastPrompt}` : "", bible].filter(Boolean).join("\n");
  // Reference pictures of an R2V clip, in the order they are given to the model.
  const refLines = refs.map((ref, index) => `<Picture ${index + 1}> = ${ref}`).join("\n");

  if (target === "image") {
    const answer = await serial(async () => ask(await read("krea-image.md"), `IDEA:\n${text.trim()}${context ? `\n\nCONTEXT:\n${context}` : ""}`));
    // One paragraph is asked for; anything after a blank line is a remark.
    return answer.split(/\n\s*\n/)[0].trim().replace(/^["“]|["”]$/g, "");
  }
  if (target === "sheet") {
    // The description is the character itself; the bible adds only the shared visual style.
    return serial(async () => ask(await read("character-sheet.md"), `CHARACTER:\n${text.trim()}${context ? `\n\n${context}` : ""}`));
  }
  if (target === "sfx") return serial(async () => ask(await read("sfx.md"), `IDEA:\n${text.trim()}`));

  const videoMode = VIDEO_MODES.includes(mode) ? mode : "i2v";
  const seconds = snapFrames(Number(duration) > 0 ? Number(duration) : 5).seconds;
  const user = `${MODE_TASKS[videoMode]}\nCLIP LENGTH: ${seconds.toFixed(2)} seconds (24 fps)\n\n${refLines ? `REFERENCES (in this order):\n${refLines}\n\n` : ""}IDEA:\n${text.trim()}${context ? `\n\nCONTEXT:\n${context}` : ""}`;
  if (videoMode === "r2v") return referenceVideoPrompt(await serial(async () => ask(await read("h3-ref-video.md"), user)));
  const answer = await serial(async () => ask(await read("h3-video.md"), user));
  // The music field is the last one; a remark after its paragraph is dropped.
  const start = Math.max(0, answer.indexOf("integrated_multimodal_description:"));
  const music = answer.indexOf("non_diegetic_music:", start);
  const gap = music < 0 ? -1 : answer.indexOf("\n\n", music);
  const body = answer.slice(start, gap < 0 ? answer.length : gap);
  if (!/integrated_multimodal_description:\s*\[Shot 1\]/.test(body) || !/overall_soundscape:/.test(body) || !/non_diegetic_music:/.test(body)) {
    throw new HttpError(502, "LLM이 H3 형식으로 쓰지 않았습니다. 다시 시도하세요.");
  }
  const lead = videoMode === "i2v" || videoMode === "s2v" ? `${FIRST_FRAME}\n\n` : videoMode === "fl2v" ? `${firstAndLast(seconds)}\n\n` : "";
  return `${lead}${body.trim()}`;
}

// The six sections of the official full-reference (Ref2VA) prompt, in their order.
export const REF_SECTIONS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];

/** Checks an answer in the official Ref2VA format and drops anything before the first section or after the last paragraph. */
export function referenceVideoPrompt(answer) {
  const start = answer.indexOf("subject_definitions:");
  if (start < 0) throw new HttpError(502, "LLM이 H3 참조 형식(subject_definitions ...)으로 쓰지 않았습니다. 다시 시도하세요.");
  const music = answer.indexOf("non_diegetic_music:", start);
  const gap = music < 0 ? -1 : answer.indexOf("\n\n", music);
  const body = answer.slice(start, gap < 0 ? answer.length : gap).trim();
  let at = -1;
  for (const name of REF_SECTIONS) {
    const next = body.indexOf(`${name}:`, at + 1);
    if (next <= at) throw new HttpError(502, `LLM이 H3 참조 형식의 ${name} 섹션을 빠뜨렸거나 순서가 다릅니다. 다시 시도하세요.`);
    at = next;
  }
  if (!/detailed_description:[\s\S]*\[Shot 1\]/.test(body)) throw new HttpError(502, "detailed_description에 [Shot 1]이 없습니다. 다시 시도하세요.");
  return body;
}

export const askWith = (llm) => (system, user) => askLlm(llm, system, user).then((result) => result.text);
