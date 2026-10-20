import { spawn } from "node:child_process";

/** Kills a process and everything it started; killing only the parent leaves GPU work running. */
export function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGKILL");
}
