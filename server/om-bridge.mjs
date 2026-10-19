import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** OpenMontage's own venv python (its tools import packages installed only there). */
export const pythonFor = (omDir) => path.join(omDir, ".venv", "Scripts", "python.exe");

/** Kills a process and everything it started; killing only the parent leaves GPU work running. */
export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGKILL");
}

/**
 * Runs bridge/om_tool.py once and resolves with its single JSON line.
 * `onSpawn(child)` lets the caller cancel; `timeoutMs` kills the whole process tree.
 */
export function runBridge({ python, bridgePath, omDir, args, stdin, timeoutMs = 3_600_000, onSpawn }) {
  return new Promise((resolve) => {
    const child = spawn(python, [bridgePath, "--om-dir", omDir, ...args], {
      cwd: omDir,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    onSpawn?.(child);
    let stdout = "";
    let stderrTail = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderrTail = (stderrTail + chunk).slice(-4000)));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: "spawn_failed", error: `Python을 실행하지 못했습니다: ${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).filter((item) => item.trim()).at(-1);
      try {
        resolve({ ...JSON.parse(line), stderrTail });
      } catch {
        resolve({
          ok: false,
          code: timedOut ? "timeout" : "bridge_crash",
          error: timedOut ? "제한 시간을 넘겨 중단했습니다." : `브릿지가 결과 없이 끝났습니다 (종료 코드 ${exitCode ?? signal}).`,
          stderrTail,
        });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
  });
}

/** Reads the GPU lock file written by bridge/om_tool.py. A lock whose process is gone is stale. */
export async function readGpuLock(lockFile) {
  let holder;
  try {
    holder = JSON.parse(await readFile(lockFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { busy: false };
    // Unreadable right now: most likely being written by a starting job.
    return { busy: true, holder: { tool: "unknown" } };
  }
  try {
    process.kill(holder.pid, 0);
    return { busy: true, holder };
  } catch (error) {
    // EPERM means the process exists but belongs to someone else: still busy.
    return error.code === "EPERM" ? { busy: true, holder } : { busy: false, stale: true, holder };
  }
}
