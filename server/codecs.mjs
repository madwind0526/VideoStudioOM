// Video encoders the app can write with (ffmpeg arguments per choice). Shared by the join and the export.
export const CODECS = {
  h264: { label: "H.264 (CPU)", encoder: "libx264", args: ["-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"] },
  h265: { label: "H.265 (CPU)", encoder: "libx265", args: ["-crf", "21", "-preset", "medium", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
  nvenc_h264: { label: "H.264 (NVENC)", encoder: "h264_nvenc", args: ["-cq", "19", "-preset", "p5", "-pix_fmt", "yuv420p"] },
  nvenc_h265: { label: "H.265 (NVENC)", encoder: "hevc_nvenc", args: ["-cq", "21", "-preset", "p5", "-pix_fmt", "yuv420p", "-tag:v", "hvc1"] },
  nvenc_av1: { label: "AV1 (NVENC)", encoder: "av1_nvenc", args: ["-cq", "26", "-preset", "p5", "-pix_fmt", "yuv420p"] },
};
export const CODEC_IDS = Object.keys(CODECS);
export const codecLabels = () => Object.fromEntries(Object.entries(CODECS).map(([id, codec]) => [id, codec.label]));
