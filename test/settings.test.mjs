import assert from "node:assert/strict";
import { test } from "node:test";

import { CODEC_IDS } from "../server/codecs.mjs";
import {
  CUSTOM_SIZE_ID,
  DEFAULTS,
  ASPECTS,
  ORIENTATIONS,
  SIZE_MEGAPIXELS,
  VIDEO_CODECS,
  imageSizeFor,
  resolveSize,
  shapeGap,
  START_PAGE_FIELDS,
  leafPaths,
  resolveSettings,
  ruleFor,
  sanitizeSettings,
  snapFrames,
  validateSettings,
} from "../shared/settings.mjs";

test("defaults pass their own validation and every leaf has a rule", () => {
  assert.equal(validateSettings(DEFAULTS).ok, true);
  for (const path of leafPaths(DEFAULTS)) assert.equal(typeof ruleFor(path), "function", path);
});

test("partial settings are accepted, unknown keys and bad values are not", () => {
  assert.equal(validateSettings({ video: { finalFps: 30 } }).ok, true);
  const unknown = validateSettings({ video: { fps: 30 } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errors[0].path, "video.fps");
  assert.equal(validateSettings({ defaults: { aspect: "no-such-ratio" } }).ok, false);
  assert.equal(validateSettings({ defaults: { sizeMegapixels: 7 } }).ok, false);
  assert.equal(validateSettings({ defaults: "x" }).ok, false);
  assert.equal(validateSettings([]).ok, false);
  assert.equal(validateSettings(JSON.parse('{"__proto__": {"x": 1}}')).ok, false);
});

test("sizes must be multiples of 32", () => {
  assert.equal(validateSettings({ defaults: { customSize: { generate: [736, 416] } } }).ok, true);
  assert.equal(validateSettings({ defaults: { customSize: { generate: [740, 416] } } }).ok, false);
  assert.equal(validateSettings({ defaults: { customSize: { generate: [736] } } }).ok, false);
});

test("connections must stay on this PC, chain must be unique", () => {
  assert.equal(validateSettings({ connections: { songyueUrl: "http://evil.example:4311" } }).ok, false);
  assert.equal(validateSettings({ llm: { ollama: { endpoint: "http://localhost:11434" } } }).ok, true);
  assert.equal(validateSettings({ llm: { chain: ["claude-cli", "claude-cli"] } }).ok, false);
  assert.equal(validateSettings({ llm: { chain: [] } }).ok, false);
});

test("project values override global values and are reported", () => {
  const { value, overridden } = resolveSettings(
    { video: { finalFps: 30 }, defaults: { aspect: "4x3" } },
    { defaults: { aspect: "1x1" }, llm: { provider: "codex-cli" } },
  );
  assert.equal(value.defaults.aspect, "1x1");
  assert.equal(value.video.finalFps, 30);
  assert.equal(value.video.upscale, "rtx-2pass");
  assert.equal(value.llm.provider, "codex-cli");
  assert.deepEqual(overridden, ["defaults.aspect", "llm.provider"]);
  // Inputs are not mutated.
  assert.equal(DEFAULTS.defaults.aspect, "16x9");
});

test("start page stays small and points at real settings", () => {
  assert.ok(START_PAGE_FIELDS.length <= 7);
  const known = new Set(leafPaths(DEFAULTS));
  for (const field of START_PAGE_FIELDS) assert.ok(known.has(field), field);
});

test("snapFrames lands on the 17k + 5 grid", () => {
  for (const seconds of [2, 5, 10, 59.3, 60]) {
    const { frames, seconds: snapped } = snapFrames(seconds);
    assert.equal((frames - 5) % 17, 0);
    assert.ok(Math.abs(snapped - seconds) < 17 / 24, `${seconds} -> ${snapped}`);
  }
  assert.equal(snapFrames(0).frames, 22);
});

test("sizes: every budget at every ratio is on the 32 grid, about the asked pixel count, tall is wide turned around", () => {
  for (const aspect of ASPECTS) {
    for (const orientation of ORIENTATIONS) {
      for (const sizeMegapixels of SIZE_MEGAPIXELS) {
        const { generate, final, id } = resolveSize({ defaults: { sizeMegapixels, aspect: aspect.id, orientation, customSize: {} } });
        for (const n of generate) assert.equal(n % 32, 0, id);
        // About the asked pixel count and the asked shape (rounding to 32 moves each a little).
        assert.ok(Math.abs((generate[0] * generate[1]) / (sizeMegapixels * 1_000_000) - 1) < 0.12, id);
        assert.deepEqual(final, generate, id);
        // Tall is wide turned around.
        const wide = resolveSize({ defaults: { sizeMegapixels, aspect: aspect.id, orientation: "landscape", customSize: {} } }).generate;
        assert.deepEqual(generate, orientation === "portrait" ? [wide[1], wide[0]] : wide, id);
      }
    }
  }
  assert.equal(ASPECTS.some((aspect) => aspect.id === CUSTOM_SIZE_ID), false);
});

test("resolveSize: budget x ratio, custom size, and the still-image size", () => {
  const wide = resolveSize(DEFAULTS);
  assert.deepEqual([wide.generate, wide.final, wide.image], [[1344, 736], [1344, 736], [1344, 736]]);
  const tall = resolveSize({ defaults: { sizeMegapixels: 1, aspect: "16x9", orientation: "portrait", customSize: {} } });
  assert.deepEqual([tall.generate, tall.final], [[736, 1344], [736, 1344]]);
  const custom = resolveSize({ defaults: { sizeMegapixels: 1, aspect: CUSTOM_SIZE_ID, orientation: "landscape", customSize: { generate: [800, 480] } } });
  assert.equal(custom.id, CUSTOM_SIZE_ID);
  assert.deepEqual(custom.generate, [800, 480]);
  // A 3200-wide final gets a still no wider than 1920 on its long edge, same shape, on the 32 grid.
  assert.deepEqual(imageSizeFor([3200, 1920]), [1920, 1152]);
  assert.deepEqual(imageSizeFor([704, 1280]), [704, 1280]);
  assert.ok(shapeGap([736, 416], [1920, 1088]) < 0.01);
  assert.ok(shapeGap([736, 416], [1088, 1920]) > 0.5);
});

test("sanitizeSettings keeps valid values and drops stale or invalid keys", () => {
  const { value, dropped } = sanitizeSettings({ defaults: { aspect: "16:9", sizeId: "s916-1080", durationSeconds: "long" }, video: { finalFps: 30 }, old: { x: 1 } });
  assert.deepEqual(value, { defaults: {}, video: { finalFps: 30 } });
  assert.deepEqual(dropped.sort(), ["defaults.aspect", "defaults.durationSeconds", "defaults.sizeId", "old"]);
  assert.deepEqual(sanitizeSettings("nope"), { value: {}, dropped: [""] });
});

test("the settings' video codecs are the ones the server can encode with", () => {
  assert.deepEqual(VIDEO_CODECS, CODEC_IDS);
  assert.equal(DEFAULTS.video.codec, "h264");
});
