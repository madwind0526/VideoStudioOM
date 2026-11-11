import assert from "node:assert/strict";
import { test } from "node:test";

import { convertArgs } from "../server/engine/convert.mjs";

test("convert: jpg and webp quality, png has none, a bad format is refused", () => {
  assert.ok(convertArgs({ kind: "image", format: "jpg", quality: 100, input: "a.png", output: "a.jpg" }).includes("2"));
  assert.ok(convertArgs({ kind: "image", format: "jpg", quality: 1, input: "a.png", output: "a.jpg" }).includes("31"));
  assert.deepEqual(convertArgs({ kind: "image", format: "webp", quality: 80, input: "a.png", output: "a.webp" }).slice(-3), ["-quality", "80", "a.webp"]);
  assert.ok(!convertArgs({ kind: "image", format: "png", input: "a.jpg", output: "a.png" }).includes("-q:v"));
  assert.throws(() => convertArgs({ kind: "image", format: "tiff", input: "a", output: "b" }), /형식/);
});

test("convert: video codecs per format, audio dropped for gif", () => {
  const mp4 = convertArgs({ kind: "video", format: "mp4", quality: 100, input: "a.webm", output: "a.mp4" });
  assert.ok(mp4.includes("libx264") && mp4.includes("18"));
  assert.ok(convertArgs({ kind: "video", format: "webm", input: "a.mp4", output: "a.webm" }).includes("libvpx-vp9"));
  const gif = convertArgs({ kind: "video", format: "gif", input: "a.mp4", output: "a.gif" });
  assert.ok(gif.includes("-an") && gif.some((arg) => arg.includes("palettegen")));
  assert.throws(() => convertArgs({ kind: "video", format: "avi", input: "a", output: "b" }), /형식/);
});
