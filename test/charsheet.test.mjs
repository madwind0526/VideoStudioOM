import assert from "node:assert/strict";
import { test } from "node:test";

import { characterSheetPrompt, SHEET_SHOT_LIST, sheetFilter, sheetFrameTimes } from "../server/engine/charsheet.mjs";
import { referenceVideoPrompt } from "../server/prompt-maker.mjs";

test("sheet prompt: the Ref2VA format with every shot, the style and no camera motion", () => {
  const prompt = characterSheetPrompt({ style: "flat anime cel shading" });
  assert.doesNotThrow(() => referenceVideoPrompt(prompt));
  assert.equal(prompt.match(/\[Shot \d+\] /g).length, SHEET_SHOT_LIST.length);
  assert.match(prompt, /Visual style: flat anime cel shading/);
  assert.match(prompt, /\[Shot 2\] At 00:00\.625,/);
  assert.equal(prompt.match(/zero camera motion/g).length, SHEET_SHOT_LIST.length);
});

test("sheet frames are taken in the middle of each shot and laid out in 3 columns with the reference first", () => {
  const times = sheetFrameTimes();
  assert.equal(times.length, 8);
  assert.equal(times[0], 0.3125);
  const filter = sheetFilter(9, [576, 768]);
  assert.match(filter, /xstack=inputs=9:layout=0_0\|576_0\|1152_0\|0_768/);
  assert.match(filter, /\[v0\]\[v1\]/);
  // 8 cells leave one empty cell that is filled with a plain colour.
  assert.match(sheetFilter(8, [576, 768]), /\[e0\].*xstack=inputs=9/);
});
