import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CUSTOM_SIZE_ID,
  DEFAULTS,
  SIZE_PRESETS,
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
  assert.equal(validateSettings({ defaults: { sizeId: "no-such-preset" } }).ok, false);
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
    { video: { finalFps: 30 }, defaults: { sizeId: "s916-1080" } },
    { defaults: { sizeId: "s11-1080" }, llm: { provider: "codex-cli" } },
  );
  assert.equal(value.defaults.sizeId, "s11-1080");
  assert.equal(value.video.finalFps, 30);
  assert.equal(value.video.upscale, "rtx-2pass");
  assert.equal(value.llm.provider, "codex-cli");
  assert.deepEqual(overridden, ["defaults.sizeId", "llm.provider"]);
  // Inputs are not mutated.
  assert.equal(DEFAULTS.defaults.sizeId, "s169-1080");
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

test("size presets: unique, on the 32 grid, final at least as big as generate, one tested default", () => {
  const ids = new Set(SIZE_PRESETS.map((preset) => preset.id));
  assert.equal(ids.size, SIZE_PRESETS.length);
  assert.equal(ids.has(CUSTOM_SIZE_ID), false);
  assert.ok(SIZE_PRESETS.length >= 8);
  for (const { id, generate, final } of SIZE_PRESETS) {
    for (const n of [...generate, ...final]) assert.equal(n % 32, 0, id);
    assert.ok(final[0] >= generate[0] && final[1] >= generate[1], id);
    assert.ok(shapeGap(generate, final) < 0.05, id);
  }
  assert.equal(SIZE_PRESETS.find((preset) => preset.id === DEFAULTS.defaults.sizeId)?.tested, true);
});

test("resolveSize: preset, custom size, and the still-image size", () => {
  const preset = resolveSize(DEFAULTS);
  assert.deepEqual([preset.generate, preset.final, preset.image], [[736, 416], [1920, 1088], [1920, 1088]]);
  const custom = resolveSize({ defaults: { sizeId: CUSTOM_SIZE_ID, customSize: { generate: [800, 480], final: [3200, 1920] } } });
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
  assert.deepEqual(value, { defaults: { sizeId: "s916-1080" }, video: { finalFps: 30 } });
  assert.deepEqual(dropped.sort(), ["defaults.aspect", "defaults.durationSeconds", "old"]);
  assert.deepEqual(sanitizeSettings("nope"), { value: {}, dropped: [""] });
});
