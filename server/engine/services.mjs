import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const portOf = (url) => new URL(url).port || "80";

/**
 * The local services the tools depend on and how to start them when they are not running:
 *   songyue - SongYUE2 backend (music, sound effects, speech engine files)
 *   comfy   - SongYUE2's ComfyUI (Krea 2 Turbo, MiniMax H3), the main generator
 *   ref     - the Rev0 portable ComfyUI: two-stage reference video (H3 latent upscaler, Deno nodes) and the RTX 2-pass upscale
 * `connections` is settings.connections.
 */
export function serviceSpecs(connections) {
  const songyue = connections.songyueDir;
  const venvPython = (root) => path.join(root, ".venv", "Scripts", "python.exe");
  return {
    songyue: {
      url: `${connections.songyueUrl}/api/health`,
      command: process.execPath,
      args: ["backend/server.mjs"],
      cwd: songyue,
      log: path.join(songyue, "videostudio-start.log"),
      waitSeconds: 60,
    },
    comfy: {
      url: `${connections.comfyUrl}/system_stats`,
      command: venvPython(path.join(songyue, "engine", "ComfyUI")),
      args: ["main.py", "--listen", "127.0.0.1", "--port", portOf(connections.comfyUrl), "--disable-auto-launch", "--use-ck-attention"],
      cwd: path.join(songyue, "engine", "ComfyUI"),
      log: path.join(songyue, "engine", "ComfyUI", "comfy_videostudio.log"),
      waitSeconds: 120,
    },
    ref: {
      url: `${connections.refUrl}/system_stats`,
      command: path.join(connections.refDir, "python_embeded", "python.exe"),
      args: ["-I", "-W", "ignore::FutureWarning", "ComfyUI/main.py", "--windows-standalone-build", "--listen", "127.0.0.1", "--port", portOf(connections.refUrl), "--disable-auto-launch"],
      cwd: connections.refDir,
      log: path.join(connections.refDir, "comfy_videostudio.log"),
      waitSeconds: 180,
    },
  };
}

const isUp = async (url, fetchImpl) => {
  try {
    return (await fetchImpl(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};

/**
 * Starts the service when it does not answer and waits until it does (it keeps running after this app stops).
 * Throws an Error with a sentence that says what is missing. `signal` stops the waiting.
 */
export async function ensureService(name, connections, { signal, fetchImpl = fetch, startProcess = spawn } = {}) {
  const spec = serviceSpecs(connections)[name];
  if (!spec) throw new Error(`알 수 없는 서비스입니다: ${name}`);
  if (await isUp(spec.url, fetchImpl)) return;
  if (!(await access(spec.command).then(() => true, () => false))) throw new Error(`${name}을(를) 켤 수 없습니다. 실행 파일이 없습니다: ${spec.command}`);
  mkdirSync(path.dirname(spec.log), { recursive: true });
  const log = openSync(spec.log, "a");
  try {
    startProcess(spec.command, spec.args, { cwd: spec.cwd, detached: true, stdio: ["ignore", log, log], windowsHide: true }).unref();
  } finally {
    closeSync(log);
  }
  const deadline = Date.now() + spec.waitSeconds * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("사용자가 취소했습니다.");
    if (await isUp(spec.url, fetchImpl)) return;
    await sleep(2000);
  }
  throw new Error(`${name}이(가) ${spec.waitSeconds}초 안에 켜지지 않았습니다. 기록: ${spec.log}`);
}
