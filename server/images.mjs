import { readFile } from "node:fs/promises";

import { HttpError } from "./http.mjs";
import { parseJson } from "./story.mjs";

/** What can be changed while the rest of the picture stays: the id (sent by the screen) and what the model is told. */
export const AXES = {
  outfit: "outfit (clothes, accessories)",
  background: "background (the place around the subject)",
  time: "time (time of day, season, weather)",
  pose: "pose (posture, action, gesture)",
  mood: "mood (feeling, expression, matching light)",
  style: "style (medium and art direction)",
};

export const MAX_VARIATIONS = 12;

/**
 * Several prompts that differ in one thing only. `ask(system, user)` is the LLM text call (tests pass a fake).
 * One call asks for all of them, so they differ from each other instead of repeating the same idea; a short or invalid answer is asked again once.
 */
export async function makeVariations({ prompt, axis, count }, ask) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 7000) throw new HttpError(400, "프롬프트는 1~7000자로 입력하세요.");
  if (!Object.hasOwn(AXES, axis)) throw new HttpError(400, `바꿀 항목은 ${Object.keys(AXES).join(", ")} 중 하나여야 합니다.`);
  const wanted = Math.min(MAX_VARIATIONS, Math.max(1, Math.floor(Number(count)) || 1));
  const system = await readFile(new URL("./prompts/image-vary.md", import.meta.url), "utf8");
  const user = `BASE PROMPT:\n${prompt.trim()}\n\nAXIS: ${AXES[axis]}\nCOUNT: ${wanted}`;
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await ask(system, attempt === 0 ? user : `${user}\n\nYour previous answer was rejected: ${problem}\nReturn only valid JSON in the format above.`);
    try {
      const list = parseJson(answer).prompts;
      const prompts = (Array.isArray(list) ? list : []).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
      if (prompts.length < wanted) throw new Error(`${wanted}개가 필요한데 ${prompts.length}개입니다.`);
      return prompts.slice(0, wanted);
    } catch (error) {
      problem = error.message;
    }
  }
  throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${problem}`);
}
