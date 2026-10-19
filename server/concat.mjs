import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "./http.mjs";
import { ffprobeFor } from "./probe.mjs";

/** `ffmpegPath` may name ffmpeg itself, its folder, or be empty (use PATH). */
export function ffmpegFor(ffmpegPath) {
  if (!ffmpegPath) return "ffmpeg";
  const folder = /^ffmpeg(\.exe)?$/i.test(path.basename(ffmpegPath)) ? path.dirname(ffmpegPath) : ffmpegPath;
  return path.join(folder, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

function run(command, args, { timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      return reject(error);
    }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `종료 코드 ${code}`));
    });
  });
}

/**
 * Joins media files one after another into `output`.
 * - audio: wav, whatever the sample rates were.
 * - video: every clip is scaled to the first clip's size and 24 fps; sound is kept only when every clip has it.
 * The result is written next to the target first and renamed over it, so a failure never damages an old file.
 */
export async function concatMedia({ ffmpegPath, kind, inputs, output }) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new HttpError(400, "이어 붙일 파일을 고르세요.");
  const ffmpeg = ffmpegFor(ffmpegPath);
  const ffprobe = ffprobeFor(ffmpegPath);
  const probe = async (file, entries, select) => (await run(ffprobe, ["-v", "error", ...(select ? ["-select_streams", select] : []), "-show_entries", entries, "-of", "csv=p=0", file])).trim();

  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const file of inputs) args.push("-i", file);
  let filter;
  let maps;
  let codec;
  if (kind === "audio") {
    filter = `${inputs.map((_, i) => `[${i}:a:0]`).join("")}concat=n=${inputs.length}:v=0:a=1[a]`;
    maps = ["-map", "[a]"];
    codec = ["-c:a", "pcm_s16le"];
  } else {
    const [width, height] = (await probe(inputs[0], "stream=width,height", "v:0")).split(",").map(Number);
    if (!(width > 0 && height > 0)) throw new HttpError(400, "첫 영상의 크기를 읽을 수 없습니다.");
    const audible = (await Promise.all(inputs.map((file) => probe(file, "stream=codec_type", "a:0")))).every(Boolean);
    const parts = inputs.map((_, i) => `[${i}:v:0]scale=${width}:${height}:flags=lanczos,setsar=1,fps=24[v${i}]${audible ? `;[${i}:a:0]aresample=44100[a${i}]` : ""}`);
    const joined = inputs.map((_, i) => `[v${i}]${audible ? `[a${i}]` : ""}`).join("");
    filter = `${parts.join(";")};${joined}concat=n=${inputs.length}:v=1:a=${audible ? 1 : 0}[v]${audible ? "[a]" : ""}`;
    maps = ["-map", "[v]", ...(audible ? ["-map", "[a]"] : [])];
    codec = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", ...(audible ? ["-c:a", "aac"] : [])];
  }
  const ext = path.extname(output);
  const temp = `${output.slice(0, -ext.length)}.part${ext}`;
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await run(ffmpeg, [...args, "-filter_complex", filter, ...maps, ...codec, temp]);
    await rename(temp, output);
  } catch (error) {
    await rm(temp, { force: true });
    throw new HttpError(500, `이어 붙이지 못했습니다: ${error.message}`);
  }
}
