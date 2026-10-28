import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createProjectStore } from "../server/projects.mjs";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-versions-"));
  const store = createProjectStore({ getRoot: async () => root });
  return { root, store, cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

test("a re-made file is a second version; choosing swaps the files and nothing is deleted", async () => {
  const { root, store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");
    const dir = path.join(root, id);
    await writeFile(path.join(dir, "assets", "images", "a.png"), "old");
    await store.setAssetRecord(id, "assets/images/a.png", { kind: "image", prompt: "old prompt" });
    await writeFile(path.join(dir, "assets", "images", "a-new.png"), "new");
    await store.setAssetRecord(id, "assets/images/a-new.png", { kind: "image", prompt: "new prompt" });
    await mkdirVersions(dir);
    await writeFile(path.join(dir, "assets", "versions", "a-2.png"), "new");

    let entry = await store.addVersion(id, "assets/images/a.png", { file: "assets/versions/a-2.png", record: { kind: "image", prompt: "new prompt" } });
    assert.deepEqual(entry.versions.map((item) => [item.id, item.file]), [["v1", "assets/images/a.png"], ["v2", "assets/versions/a-2.png"]]);
    assert.equal(entry.selected, "v1");
    assert.equal(await readFile(path.join(dir, "assets", "images", "a.png"), "utf8"), "old");

    await store.saveDraft(id, "assets/images/a.png", { prompt: "edited" });
    entry = await store.selectVersion(id, "assets/images/a.png", "v2");
    assert.equal(entry.selected, "v2");
    assert.equal(entry.draft, null);
    assert.equal(await readFile(path.join(dir, "assets", "images", "a.png"), "utf8"), "new");
    const archived = entry.versions.find((item) => item.id === "v1").file;
    assert.match(archived, /^assets\/versions\/a-v1-/);
    assert.equal(await readFile(path.join(dir, archived), "utf8"), "old");
    assert.equal((await store.assetRecords(id))["assets/images/a.png"].prompt, "new prompt");

    entry = await store.selectVersion(id, "assets/images/a.png", "v1");
    assert.equal(await readFile(path.join(dir, "assets", "images", "a.png"), "utf8"), "old");
    assert.equal((await store.assetRecords(id))["assets/images/a.png"].prompt, "old prompt");
    assert.equal((await store.get(id)).media.images.find((file) => file.path === "assets/images/a.png").versions, 2);
    assert.deepEqual(entry.log.map((item) => item.type), ["remade", "saved", "selected", "selected"]);
    await assert.rejects(store.selectVersion(id, "assets/images/a.png", "v9"), { status: 404 });
  } finally {
    await cleanup();
  }
});

test("a saved prompt is kept as a draft and in the history", async () => {
  const { store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");
    const entry = await store.saveDraft(id, "assets/images/a.png", { prompt: "edited" });
    assert.deepEqual(entry.draft, { prompt: "edited" });
    assert.equal((await store.versionsOf(id, "assets/images/a.png")).log[0].prompt, "edited");
    await assert.rejects(store.saveDraft(id, "assets/images/a.png", { prompt: 5 }), { status: 400 });
    assert.deepEqual((await store.versionsOf(id, "assets/images/none.png")).versions, []);
  } finally {
    await cleanup();
  }
});

async function mkdirVersions(dir) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(dir, "assets", "versions"), { recursive: true });
}
