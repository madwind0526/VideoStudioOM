/**
 * The prompts of a prompt file. Three shapes are read:
 *  - text where the prompts are separated by a line of three or more dashes or equal signs (a prompt may have blank lines in it),
 *  - text where the prompts are separated by blank lines,
 *  - text with one prompt per line,
 *  - JSON: a list of strings, or of objects with `text` or `prompt`, or { prompts: [...] }.
 * The first shape found in this order wins. Blank prompts are dropped.
 */
export function parsePromptFile(content, name = "") {
  const body = String(content).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (/\.json$/i.test(name)) {
    try {
      const data = JSON.parse(body);
      const list = Array.isArray(data) ? data : Array.isArray(data?.prompts) ? data.prompts : [];
      return list.map((item) => (typeof item === "string" ? item : typeof item?.text === "string" ? item.text : typeof item?.prompt === "string" ? item.prompt : "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  const split = (pattern) => body.split(pattern).map((part) => part.trim()).filter(Boolean);
  const bySeparator = split(/^[ \t]*(?:-{3,}|={3,})[ \t]*$/m);
  if (bySeparator.length > 1) return bySeparator;
  const byBlankLine = split(/\n[ \t]*\n/);
  if (byBlankLine.length > 1) return byBlankLine;
  return split(/\n/);
}
