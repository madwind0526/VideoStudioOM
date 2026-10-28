import { realpath } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "./http.mjs";

const ID_PATTERN = /^[a-z0-9가-힣_-]{1,60}$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

export const isValidProjectId = (id) => typeof id === "string" && ID_PATTERN.test(id);

const outside = () => new HttpError(400, "프로젝트 폴더 밖의 경로입니다.");

/** Rejects relative paths that Windows or the API should never treat as plain project files. */
export function checkRelativePath(rel) {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 300) throw new HttpError(400, "경로가 올바르지 않습니다.");
  // ":" blocks drive-relative paths (C:foo) and alternate data streams (file.json::$DATA).
  if (/[\0:*?"<>|]/.test(rel) || /^[\\/]/.test(rel)) throw new HttpError(400, "경로에 쓸 수 없는 문자가 있습니다.");
  for (const segment of rel.split(/[\\/]/)) {
    // Windows drops trailing dots and spaces, so "a. " would silently name "a".
    if (!segment || segment === "." || segment === ".." || /[. ]$/.test(segment) || RESERVED_NAME.test(segment)) {
      throw new HttpError(400, "경로가 올바르지 않습니다.");
    }
  }
}

// Case-insensitive on purpose: Windows paths are, and a stricter match on other systems is harmless.
function assertInside(root, target) {
  const base = root.toLowerCase();
  const candidate = target.toLowerCase();
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (candidate !== base && !candidate.startsWith(prefix)) throw outside();
}

/**
 * Resolves `rel` under `root` and guarantees the result stays inside it, including through
 * junctions and symlinks (the deepest existing ancestor is resolved to its real location).
 */
export async function resolveInside(root, rel) {
  checkRelativePath(rel);
  const rootReal = await realpath(root);
  const target = path.resolve(rootReal, rel);
  assertInside(rootReal, target);

  let probe = target;
  for (;;) {
    try {
      const real = await realpath(probe);
      const resolved = path.join(real, path.relative(probe, target));
      assertInside(rootReal, resolved);
      return resolved;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(probe);
      if (parent === probe) throw outside();
      probe = parent;
    }
  }
}
