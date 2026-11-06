import { readFile } from "node:fs/promises";

import { HttpError } from "./http.mjs";
import { parseJson } from "./story.mjs";

/**
 * The base prompt rewritten with the change the user asked for (free text: any kind of change). `ask(system, user)` is the
 * LLM text call (tests pass a fake); an answer that is not usable is asked again once.
 */
export async function reviseImagePrompt({ prompt, request }, ask) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 7000) throw new HttpError(400, "프롬프트는 1~7000자로 입력하세요.");
  if (typeof request !== "string" || !request.trim() || request.length > 2000) throw new HttpError(400, "바꿀 내용을 1~2000자로 적어 주세요.");
  const system = await readFile(new URL("./prompts/image-vary.md", import.meta.url), "utf8");
  const user = `BASE PROMPT:
${prompt.trim()}

CHANGE:
${request.trim()}`;
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await ask(system, attempt === 0 ? user : `${user}

Your previous answer was rejected: ${problem}
Return only valid JSON in the format above.`);
    try {
      const revised = parseJson(answer).prompt;
      if (typeof revised !== "string" || !revised.trim()) throw new Error("prompt 항목이 비어 있습니다.");
      return revised.trim();
    } catch (error) {
      problem = error.message;
    }
  }
  throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${problem}`);
}

/**
 * The English instruction for a multi-picture edit (Qwen Image Edit) from the user's request, which points at the pictures as
 * 그림1, 그림2, ... (the edit model follows English; a Korean sentence leaves out the changes). Pictures are named <imageN>.
 */
export async function editInstruction({ text, count, naming = "tokens" }, ask) {
  if (typeof text !== "string" || !text.trim() || text.length > 2000) throw new HttpError(400, "바꿀 내용을 1~2000자로 적어 주세요.");
  const pictures = Math.floor(Number(count));
  if (!(pictures >= 1 && pictures <= 10)) throw new HttpError(400, "그림은 1~10장이어야 합니다.");
  const outside = [...text.matchAll(/(?:그림|이미지|picture|image)\s*(\d+)/gi)].map((match) => Number(match[1])).find((n) => n < 1 || n > pictures);
  if (outside) throw new HttpError(400, `그림${outside}은(는) 고른 그림(${pictures}장) 밖입니다.`);
  const system = await readFile(new URL(naming === "plain" ? "./prompts/image-edit-plain.md" : "./prompts/image-edit.md", import.meta.url), "utf8");
  const user = `PICTURES: ${pictures}
REQUEST:
${text.trim()}`;
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await ask(system, attempt === 0 ? user : `${user}

Your previous answer was rejected: ${problem}
Return only valid JSON in the format above.`);
    try {
      const prompt = parseJson(answer).prompt;
      if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt 항목이 비어 있습니다.");
      if (naming !== "plain" && !/<image\d+>/.test(prompt)) throw new Error("<image1> 같은 그림 이름이 없습니다.");
      return prompt.trim();
    } catch (error) {
      problem = error.message;
    }
  }
  throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${problem}`);
}

const PART_NAMES = { person: "person", outfit: "outfit", style: "style", place: "place", action: "action", prop: "prop", expression: "expression and gaze", time: "time and weather", camera: "camera and framing", lighting: "lighting", palette: "color palette" };

/** One Krea prompt per combination from the pool (one LLM call for all, so they differ from each other). */
export async function composePrompts({ combinations, labels = {} }, ask) {
  if (!Array.isArray(combinations) || combinations.length < 1 || combinations.length > 24) throw new HttpError(400, "조합은 1~24개여야 합니다.");
  const lines = combinations.map((combination, index) => {
    const parts = Object.entries(combination ?? {}).filter(([, phrase]) => typeof phrase === "string" && phrase.trim()).map(([id, phrase]) => `${PART_NAMES[id] ?? labels[id] ?? id}: ${phrase.trim().slice(0, 200)}`);
    if (parts.length === 0) throw new HttpError(400, `${index + 1}번 조합이 비어 있습니다.`);
    return `${index + 1}. ${parts.join(" | ")}`;
  });
  const system = await readFile(new URL("./prompts/image-compose.md", import.meta.url), "utf8");
  const user = `COMBINATIONS (${lines.length}):\n${lines.join("\n")}`;
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await ask(system, attempt === 0 ? user : `${user}\n\nYour previous answer was rejected: ${problem}\nReturn only valid JSON in the format above.`);
    try {
      const list = parseJson(answer).prompts;
      const prompts = (Array.isArray(list) ? list : []).filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
      if (prompts.length < lines.length) throw new Error(`${lines.length}개가 필요한데 ${prompts.length}개입니다.`);
      return prompts.slice(0, lines.length);
    } catch (error) {
      problem = error.message;
    }
  }
  throw new HttpError(502, `LLM의 답을 쓸 수 없습니다: ${problem}`);
}
