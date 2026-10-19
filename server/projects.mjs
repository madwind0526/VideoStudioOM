import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { deepMerge, validateSettings } from "../shared/settings.mjs";
import { createMutex, writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";
import { isValidProjectId, resolveInside } from "./paths.mjs";

// Only these folders are written by the GUI; project.json, checkpoints and renders stay untouched.
const WRITABLE_DIRS = new Set(["studio", "artifacts", "assets"]);
const WRITE_EXTENSIONS = new Set([".json", ".md", ".txt"]);
const READ_EXTENSIONS = new Set([".json", ".md", ".txt", ".jsonl", ".log"]);
const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;
const MEDIA_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const PROJECT_SETTINGS_FILE = "studio/settings.json";

const exists = (target) => stat(target).then(() => true, () => false);

function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug || `project-${Date.now().toString(36)}`;
}

function unsetPath(object, dotted) {
  const keys = dotted.split(".");
  const trail = [];
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return;
    trail.push([node, key]);
    node = node[key];
  }
  delete node[keys.at(-1)];
  // Drop objects emptied by the removal so the file only holds real overrides.
  for (const [parent, key] of trail.reverse()) {
    if (Object.keys(parent[key]).length === 0) delete parent[key];
  }
}

/** Projects live as folders under the OpenMontage projects directory (`getRoot()`). */
export function createProjectStore({ getRoot }) {
  const mutex = createMutex();

  async function projectDir(id) {
    if (!isValidProjectId(id)) throw new HttpError(400, "프로젝트 이름이 올바르지 않습니다.");
    const root = await getRoot();
    const dir = await resolveInside(root, id).catch((error) => {
      if (error.code === "ENOENT") throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");
      throw error;
    });
    const info = await stat(dir).catch(() => null);
    if (!info?.isDirectory()) throw new HttpError(404, "프로젝트를 찾을 수 없습니다.");
    return dir;
  }

  async function summarize(dir, id) {
    let title = id;
    try {
      const marker = JSON.parse(await readFile(path.join(dir, "project.json"), "utf8"));
      if (typeof marker.title === "string" && marker.title) title = marker.title;
    } catch {
      // Older projects have no project.json; the folder name is the title.
    }
    const info = await stat(dir);
    const imagesDir = path.join(dir, "assets", "images");
    const images = await readdir(imagesDir).catch(() => []);
    const poster = images.filter((name) => IMAGE_PATTERN.test(name)).sort()[0];
    return {
      id,
      title,
      updatedAt: info.mtimeMs,
      hasFinal: await exists(path.join(dir, "renders", "final.mp4")),
      poster: poster ? `assets/images/${poster}` : null,
    };
  }

  async function listFiles(dir, sub) {
    const names = await readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of names) {
      if (!entry.isFile()) continue;
      const info = await stat(path.join(dir, sub, entry.name));
      files.push({ path: `${sub}/${entry.name}`, size: info.size, mtimeMs: info.mtimeMs });
    }
    return files;
  }

  async function writeChecked(dir, rel, content, expectedMtimeMs) {
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_TEXT_BYTES) {
      throw new HttpError(400, "내용이 올바르지 않거나 너무 큽니다.");
    }
    const segments = rel.split(/[\\/]/);
    if (segments.length < 2 || !WRITE_EXTENSIONS.has(path.extname(rel).toLowerCase()) || !WRITABLE_DIRS.has(segments[0].toLowerCase())) {
      throw new HttpError(400, "이 위치에는 저장할 수 없습니다.");
    }
    const target = await resolveInside(dir, rel);
    return mutex(target, async () => {
      const current = await stat(target).catch(() => null);
      // Compare with what the caller loaded: if the file changed (or appeared/vanished) since, refuse.
      if (current ? current.mtimeMs !== expectedMtimeMs : expectedMtimeMs !== null && expectedMtimeMs !== undefined) {
        throw new HttpError(409, "파일이 다른 곳에서 바뀌었습니다. 다시 불러오세요.", { mtimeMs: current?.mtimeMs ?? null });
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFileAtomic(target, content);
      return { mtimeMs: (await stat(target)).mtimeMs };
    });
  }

  async function readSettingsFile(dir) {
    const target = await resolveInside(dir, PROJECT_SETTINGS_FILE);
    try {
      const raw = JSON.parse(await readFile(target, "utf8"));
      const checked = validateSettings(raw);
      if (!checked.ok) throw new HttpError(500, "studio/settings.json의 값이 올바르지 않습니다.", { errors: checked.errors });
      return { target, stored: checked.value };
    } catch (error) {
      if (error.code === "ENOENT") return { target, stored: {} };
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, "studio/settings.json을 읽을 수 없습니다.");
    }
  }

  return {
    root: getRoot,

    async list() {
      const root = await getRoot();
      const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      const items = [];
      // Dirent.isDirectory() is false for junctions and symlinks, so linked folders are never listed.
      for (const entry of entries) {
        if (entry.isDirectory() && isValidProjectId(entry.name)) items.push(await summarize(path.join(root, entry.name), entry.name));
      }
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async get(id) {
      const dir = await projectDir(id);
      return { ...(await summarize(dir, id)), files: [...(await listFiles(dir, "studio")), ...(await listFiles(dir, "artifacts"))] };
    },

    async create(title) {
      if (typeof title !== "string" || !title.trim() || title.length > 100) throw new HttpError(400, "제목을 입력하세요(100자 이하).");
      return mutex("create", async () => {
        const root = await getRoot();
        await mkdir(root, { recursive: true });
        const base = slugify(title.trim());
        for (let n = 1; n < 100; n += 1) {
          const id = n === 1 ? base : `${base}-${n}`.slice(0, 60);
          try {
            await mkdir(path.join(root, id));
          } catch (error) {
            if (error.code === "EEXIST") continue;
            throw error;
          }
          const dir = path.join(root, id);
          for (const sub of ["studio", "artifacts", "assets/images", "assets/video", "assets/audio", "assets/music", "renders"]) {
            await mkdir(path.join(dir, sub), { recursive: true });
          }
          const marker = { version: "1.0", created_at: new Date().toISOString(), project_id: id, title: title.trim() };
          await writeFileAtomic(path.join(dir, "project.json"), `${JSON.stringify(marker, null, 2)}\n`);
          return summarize(dir, id);
        }
        throw new HttpError(409, "같은 이름의 프로젝트가 너무 많습니다.");
      });
    },

    async readText(id, rel) {
      const dir = await projectDir(id);
      const target = await resolveInside(dir, rel);
      if (!READ_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new HttpError(400, "텍스트 파일만 읽을 수 있습니다.");
      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, "파일을 찾을 수 없습니다.");
      if (info.size > MAX_TEXT_BYTES) throw new HttpError(413, "파일이 너무 큽니다.");
      return { content: await readFile(target, "utf8"), mtimeMs: info.mtimeMs };
    },

    /** Locates a media file for streaming. Only image/video/audio types are served. */
    async statMedia(id, rel) {
      const dir = await projectDir(id);
      const target = await resolveInside(dir, rel);
      const mime = MEDIA_TYPES[path.extname(target).toLowerCase()];
      if (!mime) throw new HttpError(400, "지원하지 않는 파일 형식입니다.");
      const info = await stat(target).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, "파일을 찾을 수 없습니다.");
      return { target, size: info.size, mime, mtimeMs: info.mtimeMs };
    },

    async writeText(id, rel, content, expectedMtimeMs) {
      return writeChecked(await projectDir(id), rel, content, expectedMtimeMs);
    },

    /** Stored project overrides plus the effective view is assembled by the caller. */
    async getSettings(id) {
      return (await readSettingsFile(await projectDir(id))).stored;
    },

    /** `set` is merged in, `unset` lists dotted keys that go back to following the global value. */
    async updateSettings(id, { set = {}, unset = [] } = {}) {
      if (!Array.isArray(unset) || unset.some((key) => typeof key !== "string")) throw new HttpError(400, "unset은 키 목록이어야 합니다.");
      const dir = await projectDir(id);
      const target = await resolveInside(dir, PROJECT_SETTINGS_FILE);
      return mutex(target, async () => {
        const { stored } = await readSettingsFile(dir);
        const merged = deepMerge(stored, set);
        for (const key of unset) unsetPath(merged, key);
        const checked = validateSettings(merged);
        if (!checked.ok) throw new HttpError(400, "설정 값이 올바르지 않습니다.", { errors: checked.errors });
        await mkdir(path.dirname(target), { recursive: true });
        await writeFileAtomic(target, `${JSON.stringify(checked.value, null, 2)}\n`);
        return checked.value;
      });
    },
  };
}
