import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ComfyError, createComfy, describeNodeErrors } from "../server/engine/comfy.mjs";
import { fakeComfy } from "./helpers/fake-comfy.mjs";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "vsom-comfy-"));

test("generate: queue, wait for the history, download the result", async () => {
  const comfy = await fakeComfy({ outputs: { 10: { images: [{ filename: "a.png", subfolder: "", type: "temp" }] } }, files: { "a.png": Buffer.from("PNGDATA") } });
  const dir = await tmp();
  try {
    const client = createComfy(comfy.url);
    assert.equal(await client.isUp(), true);
    const { paths } = await client.generate({ 1: { class_type: "X", inputs: {} } }, "10", path.join(dir, "out", "a.png"), { pollMs: 10 });
    assert.equal(await readFile(paths[0], "utf8"), "PNGDATA");
    assert.equal(comfy.seen.prompts.length, 1);
    // A temp-type result is fetched as temp (PreviewImage writes there).
    assert.deepEqual(comfy.seen.views, ["a.png"]);
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("several result files get an index; a node without output is named in the error", async () => {
  const comfy = await fakeComfy({ outputs: { 15: { video: [{ filename: "1.mp4" }, { filename: "2.mp4" }] } }, files: { "1.mp4": Buffer.from("A"), "2.mp4": Buffer.from("B") } });
  const dir = await tmp();
  try {
    const client = createComfy(comfy.url);
    const { paths } = await client.generate({}, "15", path.join(dir, "v.mp4"), { pollMs: 10 });
    assert.deepEqual(paths.map((file) => path.basename(file)), ["v_000.mp4", "v_001.mp4"]);
    await assert.rejects(client.generate({}, "99", path.join(dir, "x.mp4"), { pollMs: 10 }), /노드 99의 결과 파일이 없습니다.*15/);
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rejected graph says which node and which value; an execution error says where it failed", async () => {
  const rejecting = await fakeComfy({ reject: { 4: { class_type: "UNETLoader", errors: [{ message: "Value not in list", details: "unet_name: 'gone' not in [...]", extra_info: { input_name: "unet_name", received_value: "gone" } }] } } });
  const failing = await fakeComfy({ failure: { node_id: "8", node_type: "KSampler", exception_message: "CUDA out of memory" } });
  try {
    await assert.rejects(createComfy(rejecting.url).submit({ 4: { class_type: "UNETLoader", inputs: {} } }), /노드 4 UNETLoader: Value not in list \(unet_name=gone\)/);
    await assert.rejects(createComfy(failing.url).generate({}, "1", "x.png", { pollMs: 10 }), /노드 8 KSampler - CUDA out of memory/);
    assert.match(describeNodeErrors({ 1: { errors: [{ message: "bad" }] } }, { 1: { class_type: "Foo" } }), /노드 1 Foo: bad/);
  } finally {
    rejecting.close();
    failing.close();
  }
});

test("cancel interrupts the server run and ends the wait; a timeout does not interrupt", async () => {
  const slow = await fakeComfy({ finishAfter: 10_000 });
  try {
    const client = createComfy(slow.url);
    const controller = new AbortController();
    const waiting = client.wait("p1", { signal: controller.signal, pollMs: 20 });
    setTimeout(() => controller.abort(), 80);
    await assert.rejects(waiting, (error) => error instanceof ComfyError && error.cancelled === true);
    assert.equal(slow.seen.interrupts, 1);
    await assert.rejects(client.wait("p1", { timeoutMs: 100, pollMs: 20 }), /제한 시간/);
    assert.equal(slow.seen.interrupts, 1);
  } finally {
    slow.close();
  }
});

test("upload, node info, model options and busy check", async () => {
  const comfy = await fakeComfy({ nodes: { UNETLoader: { input: { required: { unet_name: [["a.safetensors", "b.safetensors"]] } } } }, running: true });
  const dir = await tmp();
  try {
    const client = createComfy(comfy.url);
    const file = path.join(dir, "pic.png");
    await writeFile(file, "x");
    assert.equal(await client.upload(file), "up_pic.png");
    assert.deepEqual(comfy.seen.uploads, ["pic.png"]);
    assert.deepEqual(await client.options("UNETLoader", "unet_name"), ["a.safetensors", "b.safetensors"]);
    assert.deepEqual(await client.options("Nope", "x"), []);
    assert.equal(await client.nodeInfo("Nope"), null);
    assert.equal(await createComfy("http://127.0.0.1:9").nodeInfo("X"), undefined);
    assert.equal(await client.busy(), true);
    assert.equal(await createComfy("http://127.0.0.1:9").isUp(), false);
  } finally {
    comfy.close();
    await rm(dir, { recursive: true, force: true });
  }
});
