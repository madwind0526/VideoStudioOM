import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULTS, deepMerge, sanitizeSettings, validateSettings } from "../shared/settings.mjs";
import { createMutex, writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";

/** Global settings in <dir>/settings.json. The file only holds what the user changed. */
export function createSettingsStore({ dir, onSaved }) {
  const file = path.join(dir, "settings.json");
  const mutex = createMutex();

  async function readStored() {
    let raw;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new HttpError(500, "data/settings.json을 읽을 수 없습니다. 파일을 확인하세요.");
    }
    // Stale or invalid keys (e.g. from an older version) are ignored; the next save rewrites the file without them.
    return sanitizeSettings(raw).value;
  }

  return {
    /** Effective global settings (defaults + stored). */
    async get() {
      return deepMerge(DEFAULTS, await readStored());
    },
    /** Merges a partial patch into the stored file. Invalid patches change nothing. */
    update(patch) {
      return mutex("settings", async () => {
        const merged = deepMerge(await readStored(), patch ?? {});
        const checked = validateSettings(merged);
        if (!checked.ok) throw new HttpError(400, "설정 값이 올바르지 않습니다.", { errors: checked.errors });
        await mkdir(dir, { recursive: true });
        await writeFileAtomic(file, `${JSON.stringify(checked.value, null, 2)}\n`);
        const effective = deepMerge(DEFAULTS, checked.value);
        await onSaved?.(effective);
        return effective;
      });
    },
  };
}
