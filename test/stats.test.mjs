import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startServer } from "../server/index.mjs";
import { cpuPercent, createSystemStats, parseGpu } from "../server/system-stats.mjs";

test("parseGpu reads the nvidia-smi line and tolerates missing values", () => {
  assert.deepEqual(parseGpu("NVIDIA GeForce RTX 5070, 23, 5120, 12227\n"), {
    name: "RTX 5070",
    utilization: 23,
    vramUsedMb: 5120,
    vramTotalMb: 12227,
  });
  assert.equal(parseGpu("RTX X, [N/A], [N/A], 8192").utilization, null);
  assert.equal(parseGpu("RTX X, [N/A], [N/A], 8192").vramUsedMb, null);
  for (const bad of ["", null, undefined, "garbage", "name,1,2,notanumber"]) assert.equal(parseGpu(bad), null, String(bad));
});

test("cpuPercent compares two samples", () => {
  assert.equal(cpuPercent({ idle: 0, total: 0 }, { idle: 75, total: 100 }), 25);
  assert.equal(cpuPercent({ idle: 10, total: 100 }, { idle: 10, total: 100 }), null);
});

test("system stats are cached for a second and survive a missing GPU", async () => {
  let reads = 0;
  const stats = createSystemStats({ readGpu: async () => (reads += 1, null) });
  const first = await stats();
  await stats();
  assert.equal(reads, 1);
  assert.equal(first.gpu, null);
  assert.ok(first.ramTotalMb > 0 && first.ramUsedMb > 0);
});

test("API: /api/system/stats includes what the GPU is doing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vsom-stats-"));
  const { port, stop } = await startServer({
    port: 0,
    dataDir: path.join(dir, "data"),
    projectsRoot: path.join(dir, "projects"),
    readGpu: async () => "NVIDIA GeForce RTX 5070, 40, 6000, 12227",
    bridge: { songyueUrl: "http://127.0.0.1:9" },
  });
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/api/system/stats`)).json();
    assert.equal(body.gpu.name, "RTX 5070");
    assert.deepEqual(body.activity, { tool: null, songyueBusy: false });
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
