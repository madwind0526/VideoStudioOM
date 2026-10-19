// Runs the API (auto-restart on change) and the Vite dev server together.
// Both are started with node directly, not through npm/cmd wrappers, so killing this process
// leaves no orphan listening on the ports.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [path.join("node_modules", "vite", "bin", "vite.js")], { cwd: root, stdio: "inherit" }),
];

function shutdown(code) {
  for (const child of children) child.kill();
  process.exit(code);
}

for (const child of children) child.on("exit", (code) => shutdown(code ?? 1));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
