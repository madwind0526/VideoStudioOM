import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePromptFile } from "../shared/promptFile.mjs";

test("prompt file: dash lines separate the prompts, blank lines inside a prompt stay", () => {
  const text = "first line\n\nsecond paragraph\n\n-----\n\nsecond prompt\r\n\r\n----------\r\nthird prompt\n";
  assert.deepEqual(parsePromptFile(text, "a.txt"), ["first line\n\nsecond paragraph", "second prompt", "third prompt"]);
});

test("prompt file: without separators blank lines, then single lines separate the prompts", () => {
  assert.deepEqual(parsePromptFile("one\ntwo\n\nthree", "a.txt"), ["one\ntwo", "three"]);
  assert.deepEqual(parsePromptFile("one\ntwo\nthree", "a.md"), ["one", "two", "three"]);
});

test("prompt file: JSON lists of strings or objects, anything else gives nothing", () => {
  assert.deepEqual(parsePromptFile('["a", {"text": "b"}, {"prompt": "c"}, 5, " "]', "a.json"), ["a", "b", "c"]);
  assert.deepEqual(parsePromptFile('{"prompts": ["x", "y"]}', "a.json"), ["x", "y"]);
  assert.deepEqual(parsePromptFile('{"categories": []}', "pool.json"), []);
  assert.deepEqual(parsePromptFile("not json", "a.json"), []);
  assert.deepEqual(parsePromptFile("", "a.txt"), []);
});
