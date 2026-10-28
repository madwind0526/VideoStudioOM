import { mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";
import { resolveInside } from "./paths.mjs";

export const VERSIONS_FILE = "studio/versions.json";
const LOG_LIMIT = 100;

const emptyEntry = () => ({ selected: null, versions: [], log: [], draft: null });
const keyOf = (rel) => String(rel).replace(/\\/g, "/");

/** Every file's versions, by project path of the file that is shown (the "main" file). */
export async function readVersions(dir) {
  try {
    const data = JSON.parse(await readFile(path.join(dir, VERSIONS_FILE), "utf8"));
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/**
 * Versions of generated files. The file at its normal path (assets/images/x.png) is always the chosen one; the others
 * live in assets/versions/ and are never deleted. Choosing a version swaps the two files, so a choice can be undone later.
 * `readAssets`/`updateAssets` give access to studio/assets.json (how each file was made); `mutex` serialises writes.
 */
export function createVersionStore({ projectDir, mutex, readAssets, updateAssets, checkAssetPath }) {
  async function locked(id, work) {
    const dir = await projectDir(id);
    const manifest = await resolveInside(dir, VERSIONS_FILE);
    return mutex(manifest, () => work(dir, manifest));
  }

  const save = (manifest, all) => writeFileAtomic(manifest, `${JSON.stringify(all, null, 2)}\n`);

  /** The first time a file gets a second version, the file as it is now becomes version 1. */
  async function withBase(dir, all, main) {
    const entry = all[main] ?? emptyEntry();
    if (entry.versions.length === 0) {
      const info = await stat(path.join(dir, main)).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, "파일을 찾을 수 없습니다.");
      entry.versions.push({ id: "v1", file: main, record: (await readAssets(dir))[main] ?? null, createdAt: info.mtimeMs });
      entry.selected = "v1";
    }
    all[main] = entry;
    return entry;
  }

  const note = (entry, item) => {
    entry.log.push({ at: Date.now(), ...item });
    if (entry.log.length > LOG_LIMIT) entry.log.splice(0, entry.log.length - LOG_LIMIT);
  };

  return {
    async versionsOf(id, rel) {
      checkAssetPath(rel);
      return (await readVersions(await projectDir(id)))[keyOf(rel)] ?? emptyEntry();
    },

    /** Keeps an edited prompt (and lyrics) of a file without making anything. */
    async saveDraft(id, rel, { prompt, lyrics }) {
      checkAssetPath(rel);
      if (typeof prompt !== "string" || prompt.length > 7000 || (lyrics !== undefined && (typeof lyrics !== "string" || lyrics.length > 4000))) {
        throw new HttpError(400, "프롬프트는 7000자 이하의 글이어야 합니다.");
      }
      const main = keyOf(rel);
      return locked(id, async (dir, manifest) => {
        const all = await readVersions(dir);
        const entry = all[main] ?? emptyEntry();
        entry.draft = { prompt, ...(lyrics === undefined ? {} : { lyrics }) };
        note(entry, { type: "saved", prompt, ...(lyrics === undefined ? {} : { lyrics }) });
        all[main] = entry;
        await save(manifest, all);
        return entry;
      });
    },

    /** Called when a job made a new file for `rel`: it becomes another version, the shown file stays as it is. */
    async addVersion(id, rel, { file, record }) {
      checkAssetPath(rel);
      checkAssetPath(file);
      const main = keyOf(rel);
      return locked(id, async (dir, manifest) => {
        if (!(await stat(path.join(dir, file)).catch(() => null))?.isFile()) throw new HttpError(404, "새로 만든 파일을 찾을 수 없습니다.");
        const all = await readVersions(dir);
        const entry = await withBase(dir, all, main);
        const next = `v${Math.max(...entry.versions.map((item) => Number(item.id.slice(1)))) + 1}`;
        entry.versions.push({ id: next, file: keyOf(file), record: record ?? null, createdAt: Date.now() });
        note(entry, { type: "remade", version: next, prompt: record?.prompt, ...(record?.lyrics ? { lyrics: record.lyrics } : {}) });
        await save(manifest, all);
        return entry;
      });
    },

    /** Makes a version the shown one: the files of the two versions trade places (nothing is deleted). */
    async selectVersion(id, rel, versionId) {
      checkAssetPath(rel);
      const main = keyOf(rel);
      return locked(id, async (dir, manifest) => {
        const all = await readVersions(dir);
        const entry = all[main];
        const chosen = entry?.versions.find((item) => item.id === versionId);
        if (!chosen) throw new HttpError(404, "그 버전을 찾을 수 없습니다.");
        const current = entry.versions.find((item) => item.id === entry.selected);
        if (current === chosen) return entry;
        const ext = path.extname(main);
        const archive = `assets/versions/${path.basename(main, ext)}-${current.id}-${Date.now().toString(36)}${ext}`;
        await mkdir(path.join(dir, "assets", "versions"), { recursive: true });
        const [mainPath, archivePath, chosenPath] = await Promise.all([main, archive, chosen.file].map((rel_) => resolveInside(dir, rel_)));
        await rename(mainPath, archivePath);
        await rename(chosenPath, mainPath);
        await updateAssets(dir, (records) => {
          delete records[chosen.file];
          if (current.record) records[archive] = current.record;
          if (chosen.record) records[main] = chosen.record;
          else delete records[main];
        });
        current.file = archive;
        chosen.file = main;
        entry.selected = chosen.id;
        // The prompt box shows the chosen version's own prompt again.
        entry.draft = null;
        note(entry, { type: "selected", version: chosen.id });
        await save(manifest, all);
        return entry;
      });
    },
  };
}
