/** File type changes with ffmpeg: pictures (png, jpg, webp) and videos (mp4, webm, mov, gif). */

export const IMAGE_FORMATS = ["png", "jpg", "webp"];
export const VIDEO_FORMATS = ["mp4", "webm", "mov", "gif"];

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * The ffmpeg arguments of one conversion. `quality` is 1-100 (higher is better); it means the compression of jpg and webp, and for
 * videos it is turned into the CRF of the codec (gif has none). Throws on a format that is not offered.
 */
export function convertArgs({ kind, format, quality = 90, input, output }) {
  const q = clamp(Number(quality) || 90, 1, 100);
  const head = ["-loglevel", "error", "-y", "-i", input];
  if (kind === "image") {
    if (!IMAGE_FORMATS.includes(format)) throw new Error(`지원하지 않는 그림 형식입니다: ${format}`);
    // jpg: ffmpeg's -q:v runs from 2 (best) to 31 (worst).
    const options = format === "jpg" ? ["-q:v", String(clamp(Math.round(31 - q * 0.29), 2, 31))] : format === "webp" ? ["-quality", String(q)] : [];
    // A picture with an alpha channel goes to jpg on white, not black.
    const filter = format === "jpg" ? ["-vf", "format=rgba,premultiply=inplace=1,format=yuv420p"] : [];
    return [...head, "-frames:v", "1", ...filter, ...options, output];
  }
  if (kind !== "video" || !VIDEO_FORMATS.includes(format)) throw new Error(`지원하지 않는 영상 형식입니다: ${format}`);
  // CRF 18 (q 100) to 34 (q 1) for h264, a little higher for vp9.
  const crf = Math.round(34 - (q / 100) * 16);
  if (format === "gif") return [...head, "-an", "-vf", "fps=15,scale='min(iw,720)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse", output];
  if (format === "webm") return [...head, "-c:v", "libvpx-vp9", "-crf", String(crf + 2), "-b:v", "0", "-pix_fmt", "yuv420p", "-c:a", "libopus", output];
  return [...head, "-c:v", "libx264", "-crf", String(crf), "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output];
}
