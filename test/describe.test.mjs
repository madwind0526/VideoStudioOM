import assert from "node:assert/strict";
import { test } from "node:test";

import { describePictures } from "../server/describe.mjs";

test("describe: a picture is described once, a changed one again, a failure is left out", async () => {
  const files = { "a.png": 1, "b.png": 1, "c.png": 1 };
  const store = {};
  let mtime = null;
  const projects = {
    readText: async (_id, rel) => ({ content: store[rel] ?? null, mtimeMs: mtime }),
    // Like the real store: a file that exists is only replaced by a writer that saw its latest time.
    writeText: async (_id, rel, content, expected) => {
      assert.equal(expected, mtime, "the saved time of the file that was read must be passed back");
      store[rel] = content;
      mtime = (mtime ?? 0) + 1;
    },
    statMedia: async (_id, rel) => ({ target: `/p/${rel}`, mtimeMs: files[rel] }),
  };
  const calls = [];
  const run = async (file) => {
    calls.push(file);
    if (file.endsWith("c.png")) throw new Error("Rev0 off");
    return `look of ${file}`;
  };
  const first = await describePictures({ projects, id: "x", rels: ["a.png", "b.png", "c.png", "a.png", ""], run });
  assert.deepEqual(first, { "a.png": "look of /p/a.png", "b.png": "look of /p/b.png" });
  assert.equal(calls.length, 3);
  files["b.png"] = 2;
  const second = await describePictures({ projects, id: "x", rels: ["a.png", "b.png"], run });
  assert.equal(second["b.png"], "look of /p/b.png");
  assert.equal(calls.length, 4);
});
