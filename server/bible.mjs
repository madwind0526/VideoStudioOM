/**
 * The story bible (studio/bible.json): the look of the video, its characters (each with its own character sheet image)
 * and places. Prompts take the matching entries word for word so every scene keeps the same people and settings.
 */
export async function readBible(projects, id) {
  try {
    const text = await projects.readText(id, "studio/bible.json", { optional: true });
    const raw = typeof text === "string" ? text : text?.content;
    const data = raw ? JSON.parse(raw) : {};
    const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item.name === "string" && item.name.trim()) : []);
    return { style: typeof data.style === "string" ? data.style : "", characters: list(data.characters), places: list(data.places) };
  } catch {
    return { style: "", characters: [], places: [] };
  }
}

const mentions = (text, name) => text.toLowerCase().includes(name.trim().toLowerCase());

/** Characters whose name appears in `text`, in the order of the bible. */
export const charactersIn = (bible, text) => bible.characters.filter((character) => mentions(text, character.name));

/** The bible lines that apply to `text`: the style, the characters and places it names (descriptions verbatim). */
export function bibleContext(bible, text) {
  const lines = [];
  if (bible.style.trim()) lines.push(`Visual style: ${bible.style.trim()}`);
  charactersIn(bible, text).forEach((character, index) => lines.push(`Character "${character.name}" (S${index + 1}): ${String(character.description ?? "").trim()}`));
  for (const place of bible.places.filter((item) => mentions(text, item.name))) lines.push(`Place "${place.name}": ${String(place.description ?? "").trim()}`);
  return lines.length ? `STORY BIBLE (authoritative, repeat verbatim):\n${lines.join("\n")}` : "";
}
