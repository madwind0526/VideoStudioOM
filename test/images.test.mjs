import assert from "node:assert/strict";
import { test } from "node:test";

import { AXES, makeVariations } from "../server/images.mjs";

test("variations: one call, exactly the asked number, an invalid or short answer is asked again once", async () => {
  const seen = [];
  const answers = ['not json at all', '{"prompts": ["a", "b", "c"]}'];
  const ask = async (system, user) => {
    seen.push({ system, user });
    return answers.shift();
  };
  const prompts = await makeVariations({ prompt: "A bee on a daisy.", axis: "time", count: 3 }, ask);
  assert.deepEqual(prompts, ["a", "b", "c"]);
  assert.equal(seen.length, 2);
  assert.match(seen[0].user, /BASE PROMPT:\nA bee on a daisy\./);
  assert.ok(seen[0].user.includes(`AXIS: ${AXES.time}`));
  assert.match(seen[1].user, /rejected/);
  // More than asked is cut to the number asked.
  assert.deepEqual(await makeVariations({ prompt: "x", axis: "pose", count: 2 }, async () => '{"prompts": ["1", "2", "3"]}'), ["1", "2"]);
});

test("variations: bad input and a model that keeps failing are refused", async () => {
  await assert.rejects(makeVariations({ prompt: " ", axis: "time", count: 2 }, async () => ""), /프롬프트/);
  await assert.rejects(makeVariations({ prompt: "x", axis: "weather", count: 2 }, async () => ""), /바꿀 항목/);
  await assert.rejects(makeVariations({ prompt: "x", axis: "mood", count: 3 }, async () => '{"prompts": ["only one"]}'), /LLM의 답을 쓸 수 없습니다/);
});
