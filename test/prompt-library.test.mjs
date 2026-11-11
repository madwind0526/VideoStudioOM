import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { addItems, classifyBlocks, deleteItem, importFolder, readLibrary, splitBlocks, updateItem } from "../server/prompt-library.mjs";

const LONG = "A cinematic photo of a lighthouse on a cliff at dawn, soft mist, golden light, shot on 35mm film.";

test("split: blocks are apart by two blank lines, headings give context, markdown escapes go, short bits are dropped", () => {
  const text = `###### **Styles with ZImage**\n\n\n${LONG}\n\n\ntoo short\n\n\nA snow\\_covered village, warm windows, evening, wide angle, painterly brush strokes, calm mood.`;
  const blocks = splitBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].heading, "Styles with ZImage");
  assert.equal(blocks[0].text, LONG);
  assert.match(blocks[1].text, /snow_covered/);
});

test("classify: batches go to the model, an unusable answer is asked again, a block that is not a prompt is skipped", async () => {
  const answers = ["nonsense", '{"items": [{"i": 0, "skip": false, "group": "image-api", "title": "등대"}, {"i": 1, "skip": true}]}'];
  const asked = [];
  const sorted = await classifyBlocks([{ heading: "", text: LONG }, { heading: "", text: "https://github.com/x/y and more links to read later on" }], async (system, user) => {
    asked.push(user);
    return answers.shift();
  });
  assert.deepEqual(sorted, [{ skip: false, group: "image-api", title: "등대" }, { skip: true }]);
  assert.match(asked[1], /rejected/);
  await assert.rejects(classifyBlocks([{ heading: "", text: LONG }], async () => '{"items": [{"i": 0, "skip": false, "group": "nope", "title": "x"}]}'), /LLM의 답을 쓸 수 없습니다/);
});

test("library: add (the same text only once), edit, delete, bad input refused", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pl-"));
  const file = path.join(dir, "prompt-library.json");
  try {
    assert.deepEqual((await readLibrary(file)).items, []);
    const first = await addItems(file, [{ group: "image-local", title: " 등대 ", text: LONG }, { group: "video-api", title: "같은 글", text: `  ${LONG}  ` }]);
    assert.equal(first.added, 1);
    assert.equal(first.skipped, 1);
    const [item] = (await readLibrary(file)).items;
    assert.equal(item.title, "등대");
    const edited = await updateItem(file, item.id, { group: "image-api", thumb: "assets/images/a.png" });
    assert.equal(edited.group, "image-api");
    assert.equal(edited.text, LONG);
    await assert.rejects(updateItem(file, item.id, { thumb: "../x.png" }), /썸네일/);
    await assert.rejects(addItems(file, [{ group: "audio", title: "x", text: LONG }]), /분류/);
    await assert.rejects(deleteItem(file, "nope"), /없는 프롬프트/);
    await deleteItem(file, item.id);
    assert.deepEqual((await readLibrary(file)).items, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("import: the text files of a folder are sorted and added, a second import adds nothing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pl-"));
  const file = path.join(dir, "lib.json");
  try {
    await writeFile(path.join(dir, "a.txt"), `${LONG}\n\n\nA drone shot flying over a green valley, slow camera push, birds, soft morning light, 5 seconds.`);
    await writeFile(path.join(dir, "b.png"), "x");
    const ask = async () => '{"items": [{"i": 0, "skip": false, "group": "image-local", "title": "등대"}, {"i": 1, "skip": false, "group": "video-local", "title": "계곡 드론"}]}';
    const first = await importFolder({ dir, file, ask });
    assert.deepEqual([first.files, first.blocks, first.added], [1, 2, 2]);
    assert.deepEqual((await readLibrary(file)).items.map((item) => item.group).sort(), ["image-local", "video-local"]);
    const second = await importFolder({ dir, file, ask: async () => assert.fail("nothing new to sort") });
    assert.equal(second.added, 0);
    await assert.rejects(importFolder({ dir: "relative/dir", file, ask }), /전체 경로/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
