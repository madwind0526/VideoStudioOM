import assert from "node:assert/strict";
import { test } from "node:test";

import { generateBible, generateScenario, generateScript, generateSynopses, parseJson } from "../server/story.mjs";

const answer = (value) => async () => (typeof value === "string" ? value : `Here you go:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``);

test("parseJson finds the object in prose and fences, and braces inside strings do not confuse it", () => {
  assert.deepEqual(parseJson('text {"a":"x } y","b":[1,{"c":2}]} trailing'), { a: "x } y", b: [1, { c: 2 }] });
  assert.throws(() => parseJson("no json here"));
  assert.throws(() => parseJson('{"a":'));
});

test("synopses: options are cleaned and limited; a bad first answer is retried once", async () => {
  const calls = [];
  const ask = async (_system, user) => {
    calls.push(user);
    return calls.length === 1 ? "sorry, no json" : JSON.stringify({ options: [{ title: "벌", logline: "l", synopsis: "줄거리 하나" }, { title: "", logline: "", synopsis: "" }] });
  };
  const options = await generateSynopses({ idea: "꿀벌 이야기", preset: "cinematic", count: 4, totalSeconds: 30 }, ask);
  assert.equal(options.length, 1);
  assert.equal(options[0].title, "벌");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /DIRECTION STYLE: cinematic drama/);
  assert.match(calls[1], /previous answer was rejected/);
  await assert.rejects(generateSynopses({ idea: "  " }, ask), { status: 400 });
  await assert.rejects(generateSynopses({ idea: "x" }, async () => "never json"), { status: 502 });
});

test("bible: characters get ids, empty ones are dropped, at least one character is required", async () => {
  const bible = await generateBible({ synopsis: "s" }, answer({ style: "film look", characters: [{ name: "미나", description: "a woman" }, { name: "", description: "x" }], places: [{ name: "카페", description: "wooden cafe" }] }));
  assert.deepEqual(bible.characters, [{ id: "c1", name: "미나", description: "a woman" }]);
  assert.equal(bible.places.length, 1);
  await assert.rejects(generateBible({ synopsis: "s" }, answer({ style: "x", characters: [] })), { status: 502 });
  await assert.rejects(generateBible({ synopsis: "" }, answer({})), { status: 400 });
});

test("scenario: scenes are contiguous, snapped to half seconds and clamped to 2-15 s, and rescaled to the target length", async () => {
  const ask = answer({ scenes: [{ description: "a", seconds: 5.3 }, { description: "b", seconds: 40 }, { description: "c" }, { description: "" }] });
  const { scenes } = await generateScenario({ synopsis: "s", totalSeconds: 60 }, ask);
  assert.equal(scenes.length, 3);
  assert.deepEqual(scenes.map((scene) => scene.id), ["scene-1", "scene-2", "scene-3"]);
  assert.equal(scenes[0].start_seconds, 0);
  for (let i = 1; i < scenes.length; i += 1) assert.equal(scenes[i].start_seconds, scenes[i - 1].end_seconds);
  for (const scene of scenes) {
    const length = scene.end_seconds - scene.start_seconds;
    assert.ok(length >= 2 && length <= 15 && length * 2 === Math.round(length * 2), `length ${length}`);
  }
});

test("script: sections follow the scenes, kinds are kept apart from the script, scenes get script_section_id", async () => {
  const scenario = { version: "1.0", scenes: [{ id: "scene-1", type: "generated", description: "a", start_seconds: 0, end_seconds: 6 }, { id: "scene-2", type: "generated", description: "b", start_seconds: 6, end_seconds: 12 }] };
  const ask = answer({
    sections: [
      { scene: 1, kind: "dialogue", text: "안녕" },
      { scene: 2, kind: "sfx", text: "door creaking" },
      { scene: 2, kind: "vocal", text: "라라라", style: "ballad" },
      { scene: 9, kind: "dialogue", text: "ghost" },
      { scene: 1, kind: "dialogue", text: "" },
    ],
  });
  const result = await generateScript({ synopsis: "s", scenario, title: "T" }, ask);
  assert.deepEqual(result.script.sections.map((section) => [section.id, section.start_seconds, section.end_seconds]), [["s1", 0, 6], ["s2", 6, 12], ["s3", 6, 12]]);
  assert.deepEqual(result.kinds, { s1: "dialogue", s2: "sfx", s3: "vocal" });
  assert.equal(result.script.sections[2].speaker_directions, "ballad");
  assert.deepEqual(result.scenes.map((scene) => scene.script_section_id), ["s1", "s2"]);
  assert.equal(result.script.total_duration_seconds, 12);
  await assert.rejects(generateScript({ synopsis: "s", scenario: { scenes: [] } }, ask), { status: 400 });
});

test("script: a sound effect or instrumental described only in \"style\" is kept (models often fill that field instead of text)", async () => {
  const scenario = { version: "1.0", scenes: [{ id: "scene-1", type: "generated", description: "a", start_seconds: 0, end_seconds: 6 }] };
  const ask = answer({
    sections: [
      { scene: 1, kind: "instrumental", text: "", style: "romantic waltz, strings" },
      { scene: 1, kind: "sfx", text: "", style: "canvas rippling" },
      { scene: 1, kind: "dialogue", text: "", style: "ignored: dialogue needs its line" },
      { scene: 1, kind: "vocal", text: "", style: "a vocal without lyrics is dropped" },
    ],
  });
  const result = await generateScript({ synopsis: "s", scenario, title: "T" }, ask);
  assert.deepEqual(result.script.sections.map((section) => [section.text, result.kinds[section.id]]), [["romantic waltz, strings", "instrumental"], ["canvas rippling", "sfx"]]);
});
