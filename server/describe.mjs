/** Where the descriptions are kept (project file): { "<project path>": { mtimeMs, text } }. A changed picture is described again. */
export const DESCRIPTIONS_FILE = "studio/descriptions.json";

/**
 * What a vision model sees in each picture (or in the last picture of a clip), by project path.
 * `run(file)` returns the text (tests pass a fake). A picture that cannot be described is left out: the prompt maker then
 * works without it, so a failure here never stops a prompt.
 */
export async function describePictures({ projects, id, rels, run, kind = "" }) {
  const stored = await projects.readText(id, DESCRIPTIONS_FILE, { optional: true });
  const cached = JSON.parse(stored.content ?? "{}");
  const found = {};
  let changed = false;
  for (const rel of [...new Set(rels.filter(Boolean))]) {
    try {
      const { target, mtimeMs } = await projects.statMedia(id, rel);
      // `kind` keeps two descriptions of one file apart (the last picture of a clip, and a summary of the whole clip).
      const key = `${kind}${rel}`;
      if (cached[key]?.mtimeMs === mtimeMs) {
        found[rel] = cached[key].text;
        continue;
      }
      found[rel] = await run(target);
      cached[key] = { mtimeMs, text: found[rel] };
      changed = true;
    } catch {
      // Not describable right now (Rev0 off, a job on the GPU ...).
    }
  }
  if (changed) await projects.writeText(id, DESCRIPTIONS_FILE, `${JSON.stringify(cached, null, 2)}\n`, stored.mtimeMs);
  return found;
}
