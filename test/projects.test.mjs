import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createProjectStore } from "../server/projects.mjs";

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vsom-projects-"));
  const store = createProjectStore({ getRoot: async () => root });
  return { root, store, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("lists old and new style projects, skips invalid names, finds poster and final", async () => {
  const { root, store, cleanup } = await setup();
  try {
    await mkdir(path.join(root, "bee-waggle-dance", "assets", "images"), { recursive: true });
    await mkdir(path.join(root, "bee-waggle-dance", "renders"), { recursive: true });
    await writeFile(path.join(root, "bee-waggle-dance", "assets", "images", "scene2.png"), "x");
    await writeFile(path.join(root, "bee-waggle-dance", "assets", "images", "scene1.png"), "x");
    await writeFile(path.join(root, "bee-waggle-dance", "renders", "final.mp4"), "x");
    await mkdir(path.join(root, "Not Valid"));
    await mkdir(path.join(root, "with-marker"));
    await writeFile(path.join(root, "with-marker", "project.json"), JSON.stringify({ title: "Marker Title" }));
    await writeFile(path.join(root, "stray-file.txt"), "x");

    const list = await store.list();
    assert.deepEqual(list.map((p) => p.id).sort(), ["bee-waggle-dance", "with-marker"]);
    const bee = list.find((p) => p.id === "bee-waggle-dance");
    assert.equal(bee.title, "bee-waggle-dance");
    assert.equal(bee.hasFinal, true);
    assert.equal(bee.poster, "assets/images/scene1.png");
    assert.equal(list.find((p) => p.id === "with-marker").title, "Marker Title");
  } finally {
    await cleanup();
  }
});

test("create makes the folder layout and unique ids", async () => {
  const { root, store, cleanup } = await setup();
  try {
    const a = await store.create("벌의 8자 춤!");
    const b = await store.create("벌의 8자 춤!");
    assert.equal(a.id, "벌의-8자-춤");
    assert.equal(b.id, "벌의-8자-춤-2");
    const marker = JSON.parse(await readFile(path.join(root, a.id, "project.json"), "utf8"));
    assert.equal(marker.title, "벌의 8자 춤!");
    await store.writeText(a.id, "studio/topic.md", "hello", null);
    await assert.rejects(store.create("   "), { status: 400 });
    assert.match((await store.create("!!!")).id, /^project-/);
  } finally {
    await cleanup();
  }
});

test("read/write: limits, conflicts and protected files", async () => {
  const { store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");

    const first = await store.writeText(id, "studio/topic.md", "v1", null);
    const loaded = await store.readText(id, "studio/topic.md");
    assert.equal(loaded.content, "v1");
    assert.equal(loaded.mtimeMs, first.mtimeMs);

    // Saving with the mtime we loaded works and returns a new one.
    const second = await store.writeText(id, "studio/topic.md", "v2", loaded.mtimeMs);
    // Somebody else changed it: a save based on the old mtime is refused and nothing is lost.
    await assert.rejects(store.writeText(id, "studio/topic.md", "stale", first.mtimeMs - 1000), { status: 409 });
    assert.equal((await store.readText(id, "studio/topic.md")).content, "v2");
    await store.writeText(id, "studio/topic.md", "v3", second.mtimeMs);

    // Creating a file that already exists, or updating one that vanished, is a conflict too.
    await assert.rejects(store.writeText(id, "studio/topic.md", "x", null), { status: 409 });
    await assert.rejects(store.writeText(id, "studio/ghost.md", "x", 123), { status: 409 });

    // Only studio/artifacts/assets, only text types.
    await assert.rejects(store.writeText(id, "project.json", "{}", null), { status: 400 });
    await assert.rejects(store.writeText(id, "renders/final.json", "{}", null), { status: 400 });
    await assert.rejects(store.writeText(id, "studio/a.exe", "x", null), { status: 400 });
    await assert.rejects(store.writeText(id, "studio/../project.json", "x", null), { status: 400 });
    await assert.rejects(store.writeText(id, "studio/big.txt", "x".repeat(5 * 1024 * 1024 + 1), null), { status: 400 });

    await assert.rejects(store.readText(id, "studio/missing.md"), { status: 404 });
    await assert.rejects(store.readText("no-such-project", "studio/topic.md"), { status: 404 });
    await assert.rejects(store.readText("../x", "studio/topic.md"), { status: 400 });
  } finally {
    await cleanup();
  }
});

test("project settings: validate, merge, unset back to the global value", async () => {
  const { store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");
    assert.deepEqual(await store.getSettings(id), {});

    await store.updateSettings(id, { set: { defaults: { aspect: "9:16" }, video: { finalFps: 30 } } });
    await store.updateSettings(id, { set: { llm: { provider: "codex-cli" } } });
    assert.deepEqual(await store.getSettings(id), {
      defaults: { aspect: "9:16" },
      video: { finalFps: 30 },
      llm: { provider: "codex-cli" },
    });

    await assert.rejects(store.updateSettings(id, { set: { defaults: { aspect: "4:3" } } }), { status: 400 });
    await assert.rejects(store.updateSettings(id, { set: { nope: 1 } }), { status: 400 });
    assert.equal((await store.getSettings(id)).defaults.aspect, "9:16");

    const after = await store.updateSettings(id, { unset: ["video.finalFps", "llm.provider"] });
    assert.deepEqual(after, { defaults: { aspect: "9:16" } });
  } finally {
    await cleanup();
  }
});

test("concurrent saves are serialized: exactly one wins", async () => {
  const { store, cleanup } = await setup();
  try {
    const { id } = await store.create("demo");
    const base = await store.writeText(id, "studio/note.md", "base", null);
    const results = await Promise.allSettled([
      store.writeText(id, "studio/note.md", "A", base.mtimeMs),
      store.writeText(id, "studio/note.md", "B", base.mtimeMs),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected")[0].reason.status, 409);
  } finally {
    await cleanup();
  }
});
