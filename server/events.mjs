import { watch } from "node:fs";
import path from "node:path";

import { isValidProjectId } from "./paths.mjs";

const MAX_CLIENTS = 20;
const HEARTBEAT_MS = 25_000;

/** Server-sent events: one stream per open browser tab. */
export function createEventHub() {
  const clients = new Set();
  return {
    get size() {
      return clients.size;
    },
    broadcast(type, data) {
      const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) res.write(payload);
    },
    /** Handles GET /api/events. Returns false when the connection limit is hit. */
    attach(req, res) {
      if (clients.size >= MAX_CLIENTS) return false;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(`retry: 3000\nevent: hello\ndata: {}\n\n`);
      clients.add(res);
      // Comment lines keep proxies and the browser from closing an idle stream.
      const beat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
      req.on("close", () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return true;
    },
    close() {
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

/**
 * Watches the projects folder and reports `{ project, path }` once per burst of changes.
 * shortcut: the folder is resolved once at start, so changing the projects folder in Settings
 * needs a server restart to be watched; fine until that setting is used day to day.
 */
export function watchProjects({ root, onChange, delayMs = 150 }) {
  const pending = new Map();
  const watcher = watch(root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.toString().split(path.sep).join("/");
    const [project, ...rest] = rel.split("/");
    // Temp files from our atomic saves are noise; the rename onto the real name is reported.
    if (!isValidProjectId(project) || rest.length === 0 || /\.tmp$/i.test(rest.at(-1))) return;
    clearTimeout(pending.get(rel));
    pending.set(
      rel,
      setTimeout(() => {
        pending.delete(rel);
        onChange({ project, path: rest.join("/") });
      }, delayMs),
    );
  });
  // A watcher error (folder deleted while running) must not take the server down.
  watcher.on("error", () => {});
  return {
    close() {
      watcher.close();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
