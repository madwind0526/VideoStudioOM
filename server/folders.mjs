import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

// Folders the user can point elsewhere in Settings. Empty value = default, shown as a placeholder.
export const FOLDER_DEFAULTS = {
  projects: { setting: "storage.projectsDir", label: "프로젝트 폴더", hint: "OpenMontage 폴더의 projects" },
  input: { setting: "storage.inputDir", label: "입력 폴더", hint: "input" },
  output: { setting: "storage.outputDir", label: "출력 폴더", hint: "output" },
};

/** Turns a settings value into an absolute path. Relative values are relative to the app folder (like SongYUE2). */
export function resolveFolder(value, fallback, appRoot) {
  const chosen = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(chosen) ? path.normalize(chosen) : path.resolve(appRoot, chosen);
}

/** The absolute folders for the current settings. */
export function folderPaths(settings, appRoot) {
  return {
    projects: resolveFolder(settings.storage.projectsDir, path.join(settings.connections.openmontageDir, "projects"), appRoot),
    input: resolveFolder(settings.storage.inputDir, "input", appRoot),
    output: resolveFolder(settings.storage.outputDir, "output", appRoot),
  };
}

/** Existence of each folder, for the Settings screen. */
export async function folderStatus(settings, appRoot) {
  const folders = folderPaths(settings, appRoot);
  const result = {};
  for (const [key, resolved] of Object.entries(folders)) {
    const info = await stat(resolved).catch(() => null);
    result[key] = { path: resolved, exists: Boolean(info?.isDirectory()), isFile: Boolean(info && !info.isDirectory()) };
  }
  return result;
}

/** Creates the input and output folders after a settings change (existing files are never moved). */
export async function ensureWorkFolders(settings, appRoot) {
  const { input, output } = folderPaths(settings, appRoot);
  for (const folder of [input, output]) await mkdir(folder, { recursive: true }).catch(() => {});
}
