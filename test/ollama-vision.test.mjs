import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { describeWithOllama } from "../server/engine/ollama-vision.mjs";

test("ollama vision: the first installed model describes the picture and is unloaded right after", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ov-"));
  const file = path.join(dir, "a.png");
  await writeFile(file, "x");
  try {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push([url, init?.body ? JSON.parse(init.body) : null]);
      return url.endsWith("/api/tags") ? { json: async () => ({ models: [{ name: "qwen3.5:9b" }] }) } : { ok: true, json: async () => ({ message: { content: " A woman in a red coat. " } }) };
    };
    assert.equal(await describeWithOllama(file, { fetchImpl }), "A woman in a red coat.");
    const chat = calls[1][1];
    assert.equal(chat.model, "qwen3.5:9b");
    assert.equal(chat.keep_alive, 0);
    assert.equal(chat.messages[1].images.length, 1);
    // No vision model installed, or Ollama down: an empty text, never an error.
    assert.equal(await describeWithOllama(file, { fetchImpl: async () => ({ json: async () => ({ models: [] }) }) }), "");
    assert.equal(await describeWithOllama(file, { fetchImpl: async () => { throw new Error("down"); } }), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
