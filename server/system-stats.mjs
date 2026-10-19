import { spawn } from "node:child_process";
import os from "node:os";

const GPU_QUERY = ["--query-gpu=name,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"];

/** Parses the first line of `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total`. */
export function parseGpu(output) {
  const parts = String(output ?? "").trim().split(/\r?\n/)[0]?.split(",").map((item) => item.trim()) ?? [];
  const [name, utilization, used, total] = [parts[0], Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!name || !Number.isFinite(total)) return null;
  return {
    name: name.replace(/^NVIDIA\s+GeForce\s+/i, ""),
    utilization: Number.isFinite(utilization) ? utilization : null,
    vramUsedMb: Number.isFinite(used) ? used : null,
    vramTotalMb: total,
  };
}

export function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** CPU busy percent between two cpuTimes() samples, or null when no time passed. */
export function cpuPercent(before, after) {
  const total = after.total - before.total;
  return total > 0 ? Math.round((1 - (after.idle - before.idle) / total) * 100) : null;
}

function runNvidiaSmi() {
  return new Promise((resolve) => {
    let output = "";
    let child;
    try {
      child = spawn("nvidia-smi", GPU_QUERY, { windowsHide: true });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill(), 3000);
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output : null);
    });
  });
}

/**
 * GPU, VRAM, CPU and RAM usage. Cached for one second so several open tabs cost one nvidia-smi call.
 * `readGpu` is injectable for tests.
 */
export function createSystemStats({ readGpu = runNvidiaSmi } = {}) {
  // Seeded at creation so the first reading already has a time span to compare against.
  let snapshot = cpuTimes();
  let cache = null;
  return async function systemStats() {
    if (cache && Date.now() - cache.at < 1000) return cache.value;
    const now = cpuTimes();
    const cpu = cpuPercent(snapshot, now);
    snapshot = now;
    const value = {
      gpu: parseGpu(await readGpu()),
      cpuPercent: cpu,
      ramUsedMb: Math.round((os.totalmem() - os.freemem()) / 1048576),
      ramTotalMb: Math.round(os.totalmem() / 1048576),
    };
    cache = { at: Date.now(), value };
    return value;
  };
}
