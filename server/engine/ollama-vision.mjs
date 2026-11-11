import { readFile } from "node:fs/promises";

const ENDPOINT = "http://127.0.0.1:11434";
/** Vision models to try, first installed one wins (gemma4:latest described a picture that was not there, qwen3.5:9b read it right in 17 s). */
const PREFERRED = ["qwen3.5:9b"];

/** The captioning instruction of the Wan Animate 2 workflow (Deno): the picture only, no motion, no guesses. */
export const CAPTION_SYSTEM =
  "You are a visual captioning assistant for Wan Animate 2. Analyze only the supplied reference image. Describe the visible character and scene faithfully in one concise English paragraph. Include facial features, hairstyle, clothing, colors, body proportions, camera angle, shot size, lighting, and background. Do not describe movement, intended actions, personality, identity, or anything that is not visibly supported. Do not change the character, composition, viewpoint, or art style. Output only the final English caption with no headings, labels, analysis, or extra commentary.";

/**
 * An English description of a picture from a local Ollama vision model; the model is unloaded again right after (keep_alive 0) so
 * ComfyUI gets the GPU back. Returns "" when Ollama is not running or has no vision model.
 */
export async function describeWithOllama(file, { endpoint = ENDPOINT, models = PREFERRED, fetchImpl = fetch, timeoutMs = 180_000 } = {}) {
  try {
    const tags = await (await fetchImpl(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) })).json();
    const installed = new Set((tags.models ?? []).map((model) => model.name));
    const model = models.find((name) => installed.has(name));
    if (!model) return "";
    const image = (await readFile(file)).toString("base64");
    const res = await fetchImpl(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: 0,
        messages: [
          { role: "system", content: CAPTION_SYSTEM },
          { role: "user", content: "Describe this reference image faithfully for Wan Animate 2.", images: [image] },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return "";
    const text = (await res.json()).message?.content;
    return typeof text === "string" ? text.trim() : "";
  } catch {
    return "";
  }
}
