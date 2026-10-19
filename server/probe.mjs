import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

function runFfprobe(command, args) {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output : null);
    });
  });
}

/** `ffmpegPath` may name ffmpeg itself, its folder, or be empty (use PATH). Returns the ffprobe command. */
export function ffprobeFor(ffmpegPath) {
  if (!ffmpegPath) return "ffprobe";
  const base = path.basename(ffmpegPath).toLowerCase();
  const folder = /^ffmpeg(\.exe)?$/.test(base) ? path.dirname(ffmpegPath) : ffmpegPath;
  return path.join(folder, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

/**
 * Duration of a media file in seconds (one decimal), or null when it cannot be read.
 * Results are cached by file path, size and modified time; failures are not cached, so installing
 * ffprobe later fixes the cards without touching the files.
 */
export function createDurationProbe({ getFfprobe, run = runFfprobe }) {
  const cache = new Map();
  return async function probeDuration(file) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const key = `${file}|${info.size}|${info.mtimeMs}`;
    if (cache.has(key)) return cache.get(key);
    const output = await run(await getFfprobe(), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file]);
    const seconds = Number.parseFloat(output ?? "");
    if (!Number.isFinite(seconds)) return null;
    const rounded = Math.round(seconds * 10) / 10;
    cache.set(key, rounded);
    return rounded;
  };
}
