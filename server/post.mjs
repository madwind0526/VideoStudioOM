import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ffmpegFor } from "./concat.mjs";
import { HttpError } from "./http.mjs";
import { killTree } from "./proc.mjs";
import { buildMixFilter, ROLES } from "./mixfilter.mjs";

const clock = (seconds) => {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const part = (value, size) => String(value).padStart(size, "0");
  return `${part(Math.floor(ms / 3600000), 2)}:${part(Math.floor(ms / 60000) % 60, 2)}:${part(Math.floor(ms / 1000) % 60, 2)},${part(ms % 1000, 3)}`;
};

// Korean speech: measured about 6.5 characters per second (Qwen3-TTS).
const CHARS_PER_SECOND = 6.5;

/**
 * SRT for the spoken lines of the script (kind "dialogue"). A line shows from its section start for as long as it is
 * spoken, never past the end of the section. Returns "" when nothing is spoken.
 */
export function srtFromScript(script, kinds = {}) {
  const sections = (script?.sections ?? []).filter((section) => (kinds[section.id] ?? "dialogue") === "dialogue" && typeof section.text === "string" && section.text.trim());
  return sections
    .map((section, index) => {
      const start = Number(section.start_seconds) || 0;
      const spoken = section.text.trim().length / CHARS_PER_SECOND + 0.6;
      const end = Math.min(Number(section.end_seconds) || start + spoken, start + spoken);
      return `${index + 1}\n${clock(start)} --> ${clock(Math.max(end, start + 0.8))}\n${section.text.trim()}\n`;
    })
    .join("\n");
}

export function runCapture(command, args, { cwd, timeoutMs = 900_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("사용자가 취소했습니다."), { cancelled: true }));
    const child = spawn(command, args, { cwd, windowsHide: true });
    const chunks = [];
    let stderr = "";
    let cancelled = false;
    const timer = setTimeout(() => killTree(child), timeoutMs);
    const onAbort = () => {
      cancelled = true;
      killTree(child);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.once("error", (error) => {
      done();
      reject(error);
    });
    child.once("close", (code) => {
      done();
      if (cancelled) reject(Object.assign(new Error("사용자가 취소했습니다."), { cancelled: true }));
      else code === 0 ? resolve({ stdout: Buffer.concat(chunks), stderr }) : reject(new Error(stderr.trim().slice(-600) || `종료 코드 ${code}`));
    });
  });
}

/** Mean colour of a clip (RGB 0-255, one sample every half second), to pull clips of one video towards the same look. */
export async function averageRgb(ffmpegPath, file) {
  const { stdout } = await runCapture(ffmpegFor(ffmpegPath), ["-v", "error", "-i", file, "-vf", "fps=2,scale=1:1:flags=area,format=rgb24", "-f", "rawvideo", "-"]);
  const sum = [0, 0, 0];
  const frames = Math.floor(stdout.length / 3);
  if (frames === 0) return null;
  for (let i = 0; i < frames; i += 1) for (let c = 0; c < 3; c += 1) sum[c] += stdout[i * 3 + c];
  return sum.map((value) => value / frames);
}

/** Per-clip channel gains that move each clip's mean colour to the mean of all clips (limited, so it never changes a look drastically). */
export function colorGains(averages) {
  const valid = averages.filter(Boolean);
  if (valid.length < 2) return averages.map(() => null);
  const target = [0, 1, 2].map((c) => valid.reduce((total, rgb) => total + rgb[c], 0) / valid.length);
  return averages.map((rgb) => (rgb ? rgb.map((value, c) => Math.min(1.2, Math.max(0.83, target[c] / Math.max(value, 1)))) : null));
}

/** What the quality check looks for in a clip: black frames and frozen frames. */
export async function checkClip(ffmpegPath, file) {
  const { stderr } = await runCapture(ffmpegFor(ffmpegPath), ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.3:pix_th=0.1,freezedetect=n=-55dB:d=1", "-an", "-f", "null", "-"]);
  const issues = [];
  for (const match of stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) issues.push({ type: "black", start: Number(match[1]), seconds: Number(match[3]) });
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  const lengths = [...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map((match) => Number(match[1]));
  starts.forEach((start, i) => issues.push({ type: "freeze", start, seconds: lengths[i] ?? 0 }));
  const duration = Number((stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? []).slice(1).reduce((total, part, i) => total + Number(part) * [3600, 60, 1][i], 0).toFixed(2));
  return { durationSeconds: duration, issues };
}

const CODECS = {
  h264: { label: "H.264 (CPU)", encoder: "libx264", args: ["-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"] },
  h265: { label: "H.265 (CPU)", encoder: "libx265", args: ["-crf", "21", "-preset", "medium", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
  nvenc_h264: { label: "H.264 (NVENC)", encoder: "h264_nvenc", args: ["-cq", "19", "-preset", "p5", "-pix_fmt", "yuv420p"] },
  nvenc_h265: { label: "H.265 (NVENC)", encoder: "hevc_nvenc", args: ["-cq", "21", "-preset", "p5", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
  nvenc_av1: { label: "AV1 (NVENC)", encoder: "av1_nvenc", args: ["-cq", "26", "-preset", "p5", "-pix_fmt", "yuv420p"] },
};
export const CODEC_IDS = Object.keys(CODECS);
export const codecLabels = () => Object.fromEntries(Object.entries(CODECS).map(([id, codec]) => [id, codec.label]));

/** Which of the codecs this ffmpeg can encode (a missing NVENC or an old build leaves it out). */
export async function availableCodecs(ffmpegPath) {
  try {
    const { stdout } = await runCapture(ffmpegFor(ffmpegPath), ["-hide_banner", "-encoders"], { timeoutMs: 20_000 });
    const text = stdout.toString();
    return CODEC_IDS.filter((id) => new RegExp(`\\b${CODECS[id].encoder}\\b`).test(text));
  } catch {
    return [];
  }
}

/**
 * The finished video: the joined clips plus (optionally) the mixed sound track and burned-in subtitles, encoded with the
 * chosen codec. Subtitles are burned from a copy next to a temporary working folder, so the path needs no escaping.
 */
export async function exportVideo({ ffmpegPath, video, audio, subtitles, codec = "h264", output }) {
  const choice = CODECS[codec];
  if (!choice) throw new HttpError(400, "지원하지 않는 코덱입니다.");
  if (!(await availableCodecs(ffmpegPath)).includes(codec)) throw new HttpError(400, `이 PC의 ffmpeg에서 ${choice.label}을(를) 쓸 수 없습니다.`);
  const work = await mkdtemp(path.join(os.tmpdir(), "vsom-export-"));
  const ext = path.extname(output);
  const temp = `${output.slice(0, -ext.length)}.part${ext}`;
  try {
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", video];
    if (audio) args.push("-i", audio);
    const filters = [];
    if (subtitles) {
      await writeFile(path.join(work, "sub.srt"), subtitles, "utf8");
      filters.push("subtitles=sub.srt:force_style='FontName=Malgun Gothic,FontSize=20,Outline=2,Shadow=0,MarginV=36'");
    }
    if (filters.length) args.push("-vf", filters.join(","));
    args.push("-map", "0:v:0");
    if (audio) args.push("-map", "1:a:0", "-shortest");
    else args.push("-map", "0:a:0?");
    args.push("-c:v", choice.encoder, ...choice.args, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", temp);
    await mkdir(path.dirname(output), { recursive: true });
    await runCapture(ffmpegFor(ffmpegPath), args, { cwd: work });
    await rename(temp, output);
  } catch (error) {
    await rm(temp, { force: true });
    throw new HttpError(500, `내보내지 못했습니다: ${error.message}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export { buildMixFilter, ROLES };
