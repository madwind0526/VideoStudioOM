import assert from "node:assert/strict";
import { test } from "node:test";

import { editInstruction, reviseImagePrompt } from "../server/images.mjs";

test("revise: the free-text change goes to the model with the base prompt, an unusable answer is asked again once", async () => {
  const seen = [];
  const answers = ["not json at all", '{"prompt": " A bee on a daisy at dusk. "}'];
  const ask = async (system, user) => {
    seen.push({ system, user });
    return answers.shift();
  };
  const revised = await reviseImagePrompt({ prompt: "A bee on a daisy.", request: "해 질 녘으로, 머리는 짧게" }, ask);
  assert.equal(revised, "A bee on a daisy at dusk.");
  assert.equal(seen.length, 2);
  assert.equal(seen[0].user, "BASE PROMPT:\nA bee on a daisy.\n\nCHANGE:\n해 질 녘으로, 머리는 짧게");
  assert.match(seen[1].user, /rejected/);
});

test("revise: bad input and a model that keeps failing are refused", async () => {
  await assert.rejects(reviseImagePrompt({ prompt: " ", request: "x" }, async () => ""), /프롬프트/);
  await assert.rejects(reviseImagePrompt({ prompt: "x", request: " " }, async () => ""), /바꿀 내용/);
  await assert.rejects(reviseImagePrompt({ prompt: "x", request: "y" }, async () => '{"prompt": ""}'), /LLM의 답을 쓸 수 없습니다/);
});

test("pool: built in until a file is saved, checked on the way in, saved whole", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { checkPool, defaultPool, readPool, writePool } = await import("../server/image-pool.mjs");
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-pool-"));
  try {
    const file = path.join(dir, "image-pools.json");
    assert.deepEqual(await readPool(file), defaultPool());
    assert.deepEqual(defaultPool().categories.map((item) => item.id), ["person", "outfit", "expression", "action", "place", "time", "camera", "lighting", "palette", "style", "prop"]);
    const saved = await writePool(file, { categories: [{ id: "person", label: "인물", phrases: [" a ", "a", "b"] }, { label: "날씨", phrases: [{ text: "x", weight: 3 }] }, { label: "빈 항목" }] });
    assert.deepEqual(saved.categories[0].phrases, [{ text: "a", weight: 1 }, { text: "b", weight: 1 }]);
    assert.deepEqual(saved.categories.map((item) => item.id), ["person", "c2", "c3"]);
    assert.deepEqual(await readPool(file), saved);
    // The old shape (one list per known category) is still read.
    assert.deepEqual(checkPool({ person: ["p"], place: ["l"] }).categories.map((item) => item.label), ["인물", "배경"]);
    assert.equal(saved.categories[1].phrases[0].weight, 3);
    assert.throws(() => checkPool({ categories: [{ label: "a", phrases: [{ text: "x", weight: -1 }] }] }), /가중치/);
    assert.throws(() => checkPool({ weather: ["x"] }), /알 수 없는 항목/);
    assert.throws(() => checkPool({ categories: [{ label: "a" }] }), /하나 이상/);
    assert.throws(() => checkPool({ categories: [{ id: "a", label: "a", phrases: ["x"] }, { id: "a", label: "b", phrases: ["y"] }] }), /겹칩니다/);
    assert.throws(() => checkPool({ categories: [{ label: "", phrases: ["x"] }] }), /이름/);
    assert.throws(() => checkPool([]), /목록/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pool: combinations take one phrase per category, differ while the pool allows it, keep what is locked and skip empty categories", async () => {
  const { checkPool, pickCombinations, pickOne } = await import("../server/image-pool.mjs");
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool = checkPool({ person: ["p1", "p2", "p3"], outfit: ["o1", "o2"], style: ["s1"], place: ["l1", "l2", "l3"], action: [], prop: [], });
  const combos = pickCombinations(pool, { count: 3, locked: { style: "S!" }, random });
  assert.equal(combos.length, 3);
  assert.deepEqual(new Set(combos.map((item) => item.person)).size, 3);
  assert.ok(combos.every((item) => item.style === "S!" && !("action" in item) && !("prop" in item)));
  assert.equal(pickCombinations(pool, { count: 99, random }).length, 24);
  assert.notEqual(pickOne(pool, "person", { avoid: "p1", random }), "p1");
  assert.equal(pickOne(pool, "style", { avoid: "s1", random }), "s1");
  assert.throws(() => pickOne(pool, "action"), /문구가 없습니다/);
  // Weights: a phrase of weight 0 is never drawn, a heavy one is drawn far more often.
  const weighted = checkPool({ categories: [{ id: "w", label: "w", phrases: [{ text: "never", weight: 0 }, { text: "rare", weight: 1 }, { text: "often", weight: 9 }] }] });
  const drawn = Array.from({ length: 400 }, () => pickOne(weighted, "w", { random }));
  assert.ok(!drawn.includes("never"));
  assert.ok(drawn.filter((text) => text === "often").length > drawn.filter((text) => text === "rare").length * 3);
});

test("compose: one prompt per combination from one call, an empty combination is refused", async () => {
  const { composePrompts } = await import("../server/images.mjs");
  const seen = [];
  const prompts = await composePrompts({ combinations: [{ person: "여성", place: "골목" }, { person: "남성", prop: "우산" }] }, async (system, user) => {
    seen.push(user);
    return '{"prompts": ["one", "two"]}';
  });
  await composePrompts({ combinations: [{ weather: "비" }], labels: { weather: "날씨" } }, async (system, user) => {
    seen.push(user);
    return '{"prompts": ["x"]}';
  });
  assert.match(seen[1], /1\. 날씨: 비/);
  assert.deepEqual(prompts, ["one", "two"]);
  assert.match(seen[0], /1\. person: 여성 \| place: 골목\n2\. person: 남성 \| prop: 우산/);
  await assert.rejects(composePrompts({ combinations: [{}] }, async () => ""), /비어 있습니다/);
});

test("edit instruction: the English instruction keeps the picture names, a picture outside the chosen ones is refused", async () => {
  const seen = [];
  const ask = async (system, user) => {
    seen.push(user);
    return '{"prompt": "The person in <image1> wears the outfit of <image2>."}';
  };
  assert.equal(await editInstruction({ text: "그림1의 사람이 그림2의 옷을 입고 있다", count: 2 }, ask), "The person in <image1> wears the outfit of <image2>.");
  assert.equal(seen[0], "PICTURES: 2\nREQUEST:\n그림1의 사람이 그림2의 옷을 입고 있다");
  await assert.rejects(editInstruction({ text: "그림3의 포즈로", count: 2 }, ask), /고른 그림/);
  await assert.rejects(editInstruction({ text: "x", count: 0 }, ask), /1~10/);
  // An answer without any <imageN> is asked again once, then refused.
  await assert.rejects(editInstruction({ text: "그림1을 바꿔", count: 1 }, async () => '{"prompt": "make it nicer"}'), /LLM의 답을 쓸 수 없습니다/);
});

test("edit instruction, plain naming: no <imageN> is needed and the plain variant of the instructions is used", async () => {
  const seen = [];
  const ask = async (system, user) => {
    seen.push(system);
    return '{"prompt": "The person in the first picture wears the outfit of the second picture."}';
  };
  assert.equal(await editInstruction({ text: "그림1의 사람이 그림2의 옷을 입는다", count: 2, naming: "plain" }, ask), "The person in the first picture wears the outfit of the second picture.");
  assert.match(seen[0], /the first picture/);
  await assert.rejects(editInstruction({ text: "그림1을 바꿔", count: 1 }, ask), /LLM의 답을 쓸 수 없습니다/);
});
