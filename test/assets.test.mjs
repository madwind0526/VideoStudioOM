import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { concatMedia, mixAudio } from "../server/concat.mjs";
import { createProjectStore } from "../server/projects.mjs";

test("records how a file was made, lists it, and deletes file with record", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-assets-"));
  try {
    const store = createProjectStore({ getRoot: async () => root });
    await store.create("demo");
    const dir = await store.dir("demo");
    await mkdir(path.join(dir, "assets", "images"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "assets", "images", "a.png"), "x");
    await store.setAssetRecord("demo", "assets/images/a.png", { prompt: "bee" });
    const detail = await store.get("demo");
    assert.equal(detail.media.images.find((m) => m.path.endsWith("a.png")).record.prompt, "bee");
    await assert.rejects(store.setAssetRecord("demo", "../x.png", {}));
    await store.deleteMedia("demo", "assets/images/a.png");
    await assert.rejects(stat(path.join(dir, "assets", "images", "a.png")));
    assert.equal((await store.get("demo")).media.images.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concat joins two tiny clips into one longer clip", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-concat-"));
  try {
    const clips = [path.join(root, "a.mp4"), path.join(root, "b.mp4")];
    for (const clip of clips) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x48:d=1:r=24", "-pix_fmt", "yuv420p", clip]);
    const output = path.join(root, "out", "final.mp4");
    await concatMedia({ ffmpegPath: "", kind: "video", inputs: clips, output });
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output]).toString());
    assert.ok(seconds > 1.8 && seconds < 2.3, `duration ${seconds}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mix places every piece at its own start second", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-mix-"));
  try {
    const tone = path.join(root, "t.wav");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", tone]);
    const output = path.join(root, "out", "mix.wav");
    await mixAudio({ ffmpegPath: "", pieces: [{ file: tone, startSeconds: 0 }, { file: tone, startSeconds: 2 }], output });
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output]).toString());
    assert.ok(seconds > 2.9 && seconds < 3.2, `duration ${seconds}`);
    await assert.rejects(mixAudio({ ffmpegPath: "", pieces: [], output }), { status: 400 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import copies a picture into assets/images and refuses other files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-import-"));
  try {
    const store = createProjectStore({ getRoot: async () => path.join(root, "projects") });
    await store.create("demo");
    const { writeFile } = await import("node:fs/promises");
    const photo = path.join(root, "my photo.JPG");
    await writeFile(photo, "x");
    const rel = await store.importImage("demo", photo);
    assert.match(rel, /^assets\/images\/photo-[a-z0-9]+-my-photo\.jpg$/i);
    assert.equal((await store.get("demo")).media.images.length, 1);
    await writeFile(path.join(root, "a.exe"), "x");
    await assert.rejects(store.importImage("demo", path.join(root, "a.exe")), { status: 400 });
    await assert.rejects(store.importImage("demo", "relative.png"), { status: 400 });
    await assert.rejects(store.importImage("demo", path.join(root, "missing.png")), { status: 404 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
