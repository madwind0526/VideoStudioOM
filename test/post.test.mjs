import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { mixAudio } from "../server/concat.mjs";
import { availableCodecs, buildMixFilter, checkClip, colorGains, exportVideo, srtFromScript } from "../server/post.mjs";

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const duration = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

test("mix filter: roles are summed per bus, ducking keys the music with the dialogue", () => {
  const pieces = [{ startSeconds: 0, role: "music" }, { startSeconds: 2.5, role: "dialogue" }, { startSeconds: 4, role: "sfx" }];
  const plain = buildMixFilter(pieces).filter;
  assert.match(plain, /adelay=2500\|2500/);
  assert.ok(!plain.includes("sidechaincompress"));
  const ducked = buildMixFilter(pieces, { duck: true }).filter;
  assert.match(ducked, /\[dialogue\]asplit=2\[dlg\]\[dlgkey\]/);
  assert.match(ducked, /\[music\]\[dlgkey\]sidechaincompress/);
  assert.match(ducked, /\[dlg\]\[musicducked\]\[sfx\]amix=inputs=3/);
  // Without speech there is nothing to duck for.
  assert.ok(!buildMixFilter([{ startSeconds: 0, role: "music" }], { duck: true }).filter.includes("sidechaincompress"));
});

test("subtitles: only dialogue, timed from the section start for as long as it is spoken", () => {
  const script = { sections: [
    { id: "s1", text: "안녕하세요", start_seconds: 1, end_seconds: 6 },
    { id: "s2", text: "door creaking", start_seconds: 2, end_seconds: 4 },
    { id: "s3", text: "아주 긴 대사를 아주 짧은 구간에 넣었습니다 정말로 길어요", start_seconds: 10, end_seconds: 11 },
  ] };
  const srt = srtFromScript(script, { s2: "sfx" });
  assert.match(srt, /^1\n00:00:01,000 --> 00:00:0[12],\d{3}\n안녕하세요\n/);
  assert.ok(!srt.includes("door creaking"));
  assert.match(srt, /2\n00:00:10,000 --> 00:00:11,000\n아주 긴 대사/);
  assert.equal(srtFromScript({ sections: [] }), "");
});

test("colour gains move clips towards the mean, within limits", () => {
  const gains = colorGains([[100, 100, 100], [200, 200, 200], null]);
  assert.ok(gains[0][0] > 1 && gains[1][0] < 1);
  assert.equal(gains[2], null);
  assert.ok(gains[0].every((value) => value <= 1.2) && gains[1].every((value) => value >= 0.83));
  assert.deepEqual(colorGains([[1, 2, 3]]), [null]);
});

test("quality check finds a black stretch and a frozen stretch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-qa-"));
  try {
    const clip = path.join(root, "bad.mp4");
    // 1 s of moving test pattern, 1.5 s of black, 2 s of a still colour.
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=128x96:d=1:r=24", "-f", "lavfi", "-i", "color=c=black:s=128x96:d=1.5:r=24", "-f", "lavfi", "-i", "color=c=red:s=128x96:d=2:r=24",
      "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p", clip);
    const { issues, durationSeconds } = await checkClip("", clip);
    assert.ok(durationSeconds > 4 && durationSeconds < 5);
    assert.ok(issues.some((issue) => issue.type === "black" && issue.seconds > 1), JSON.stringify(issues));
    assert.ok(issues.some((issue) => issue.type === "freeze" && issue.seconds > 1), JSON.stringify(issues));
    const good = path.join(root, "good.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=128x96:d=2:r=24", "-pix_fmt", "yuv420p", good);
    assert.deepEqual((await checkClip("", good)).issues, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export: new sound track, burned subtitles and a codec check", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-export-"));
  try {
    const video = path.join(root, "v.mp4");
    const sound = path.join(root, "a.wav");
    ffmpeg("-f", "lavfi", "-i", "testsrc=s=160x96:d=2:r=24", "-pix_fmt", "yuv420p", video);
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=330:duration=2", sound);
    assert.ok((await availableCodecs("")).includes("h264"));
    const output = path.join(root, "out", "export.mp4");
    await exportVideo({ ffmpegPath: "", video, audio: sound, subtitles: "1\n00:00:00,200 --> 00:00:01,500\n안녕하세요\n", codec: "h264", output });
    assert.ok(duration(output) > 1.8 && duration(output) < 2.3);
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", output]).toString();
    assert.match(streams, /video/);
    assert.match(streams, /audio/);
    await assert.rejects(exportVideo({ ffmpegPath: "", video, codec: "nope", output }), { status: 400 });
    // The mix with ducking really runs.
    const mixed = path.join(root, "mix.wav");
    await mixAudio({ ffmpegPath: "", pieces: [{ file: sound, startSeconds: 0, role: "music" }, { file: sound, startSeconds: 0.5, role: "dialogue" }], duck: true, output: mixed });
    assert.ok(duration(mixed) > 1.9);
    await mkdir(root, { recursive: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
