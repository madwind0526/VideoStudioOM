import { spawn } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { CODECS } from "./codecs.mjs";
import { HttpError } from "./http.mjs";
import { buildMixFilter } from "./mixfilter.mjs";
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
 *   `trimEnd` (seconds, or one value per clip) cuts that much off the end of every clip, the last one too (the next clip starts from a frame inside that stretch);
 *   `seamGains` (per clip) tint the start of a clip to the colour of the previous clip's end and fade back to normal over seamRamp.
 * The result is written next to the target first and renamed over it, so a failure never damages an old file.
 */
/** Seconds cut off the end of clip `i`: one number for every clip, or one per clip. */
export const trimOf = (trimEnd, i) => Number(Array.isArray(trimEnd) ? trimEnd[i] : trimEnd) || 0;

export async function concatMedia({ ffmpegPath, kind, inputs, output, gains = [], trimEnd = 0, seamGains = [], seamRamp = 3, videoCodec = "h264" }) {
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
    // `gains` (per clip, optional) pull the colours of the clips towards one look before they are joined.
    const tint = (i) => (gains[i] ? `colorchannelmixer=rr=${gains[i][0].toFixed(3)}:gg=${gains[i][1].toFixed(3)}:bb=${gains[i][2].toFixed(3)},` : "");
    // Length each clip keeps: the last clip is whole, the others lose `trimEnd`.
    const keeps = await Promise.all(inputs.map(async (file, i) => {
      const cut = trimOf(trimEnd, i);
      if (!(cut > 0)) return null;
      const keep = Number(await probe(file, "format=duration")) - cut;
      if (!(keep >= 0.5)) throw new HttpError(400, "겹침 시간이 구간 길이보다 깁니다.");
      return keep;
    }));
    const parts = inputs.map((_, i) => {
      const cut = keeps[i] ? `trim=0:${keeps[i].toFixed(3)},setpts=PTS-STARTPTS,` : "";
      const gain = seamGains[i];
      const base = `[${i}:v:0]${cut}${tint(i)}scale=${width}:${height}:flags=lanczos,setsar=1,fps=24`;
      const video = gain
        ? `${base},split[o${i}][p${i}];[p${i}]colorchannelmixer=rr=${gain[0].toFixed(4)}:gg=${gain[1].toFixed(4)}:bb=${gain[2].toFixed(4)}[g${i}];[g${i}][o${i}]blend=all_expr='A*(1-min(T/${seamRamp},1))+B*min(T/${seamRamp},1)'[v${i}]`
        : `${base}[v${i}]`;
      const audio = audible ? `;[${i}:a:0]${keeps[i] ? `atrim=0:${keeps[i].toFixed(3)},asetpts=PTS-STARTPTS,` : ""}aresample=44100[a${i}]` : "";
      return video + audio;
    });
    const joined = inputs.map((_, i) => `[v${i}]${audible ? `[a${i}]` : ""}`).join("");
    filter = `${parts.join(";")};${joined}concat=n=${inputs.length}:v=1:a=${audible ? 1 : 0}[v]${audible ? "[a]" : ""}`;
    maps = ["-map", "[v]", ...(audible ? ["-map", "[a]"] : [])];
    const choice = CODECS[videoCodec];
    if (!choice) throw new HttpError(400, "지원하지 않는 코덱입니다.");
    codec = ["-c:v", choice.encoder, ...choice.args, ...(audible ? ["-c:a", "aac"] : [])];
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

/**
 * Mixes audio pieces onto one timeline: every piece starts at its own second (dialogue, effects and music may overlap).
 * `pieces` is [{ file, startSeconds, role }]; with `duck` the music gets quieter while someone speaks.
 * The result is a stereo wav at 44.1 kHz with a limiter against clipping.
 */
export async function mixAudio({ ffmpegPath, pieces, output, duck = false }) {
  if (!Array.isArray(pieces) || pieces.length === 0) throw new HttpError(400, "합칠 오디오를 고르세요.");
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const piece of pieces) args.push("-i", piece.file);
  const { filter, label } = buildMixFilter(pieces, { duck });
  const ext = path.extname(output);
  const temp = `${output.slice(0, -ext.length)}.part${ext}`;
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await run(ffmpegFor(ffmpegPath), [...args, "-filter_complex", filter, "-map", label, "-c:a", "pcm_s16le", temp]);
    await rename(temp, output);
  } catch (error) {
    await rm(temp, { force: true });
    throw new HttpError(500, `오디오를 합치지 못했습니다: ${error.message}`);
  }
}
