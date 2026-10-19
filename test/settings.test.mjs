import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULTS,
  START_PAGE_FIELDS,
  leafPaths,
  resolveSettings,
  ruleFor,
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
  assert.equal(validateSettings({ defaults: { aspect: "4:3" } }).ok, false);
  assert.equal(validateSettings({ defaults: "x" }).ok, false);
  assert.equal(validateSettings([]).ok, false);
  assert.equal(validateSettings(JSON.parse('{"__proto__": {"x": 1}}')).ok, false);
});

test("sizes must be multiples of 32", () => {
  assert.equal(validateSettings({ presets: { "16:9": { generate: [736, 416] } } }).ok, true);
  assert.equal(validateSettings({ presets: { "16:9": { generate: [740, 416] } } }).ok, false);
  assert.equal(validateSettings({ presets: { "16:9": { generate: [736] } } }).ok, false);
});

test("connections must stay on this PC, chain must be unique", () => {
  assert.equal(validateSettings({ connections: { songyueUrl: "http://evil.example:4311" } }).ok, false);
  assert.equal(validateSettings({ llm: { ollama: { endpoint: "http://localhost:11434" } } }).ok, true);
  assert.equal(validateSettings({ llm: { chain: ["claude-cli", "claude-cli"] } }).ok, false);
  assert.equal(validateSettings({ llm: { chain: [] } }).ok, false);
});

test("project values override global values and are reported", () => {
  const { value, overridden } = resolveSettings(
    { video: { finalFps: 30 }, defaults: { aspect: "9:16" } },
    { defaults: { aspect: "1:1" }, llm: { provider: "codex-cli" } },
  );
  assert.equal(value.defaults.aspect, "1:1");
  assert.equal(value.video.finalFps, 30);
  assert.equal(value.video.upscale, "rtx-2pass");
  assert.equal(value.llm.provider, "codex-cli");
  assert.deepEqual(overridden, ["defaults.aspect", "llm.provider"]);
  // Inputs are not mutated.
  assert.equal(DEFAULTS.defaults.aspect, "16:9");
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
