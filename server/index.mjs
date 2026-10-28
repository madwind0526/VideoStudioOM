import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createEventHub, watchProjects } from "./events.mjs";
import { ensureWorkFolders, folderPaths } from "./folders.mjs";
import { createGuard } from "./guard.mjs";
import { HttpError, sendJson } from "./http.mjs";
import { createComfy } from "./engine/comfy.mjs";
import { createJobQueue } from "./jobs.mjs";
import { createDurationProbe, ffprobeFor } from "./probe.mjs";
import { createProjectStore } from "./projects.mjs";
import { handleApi } from "./routes.mjs";
import { createSettingsStore } from "./settings-store.mjs";
import { createSystemStats } from "./system-stats.mjs";

// Ports are allocated in C:\Claude\PORTS.md (backend 4314, Vite dev 5184).
export const API_PORT = 4314;
const WEB_PORT = 5184;
const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(url, res) {
  const requested = decodeURIComponent(url.pathname);
  const target = path.resolve(DIST_DIR, `.${requested === "/" ? "/index.html" : requested}`);
  // Stay inside dist: resolve() collapses "..", so a prefix check is enough here.
  const inside = target === DIST_DIR || target.startsWith(DIST_DIR + path.sep);
  try {
    if (!inside) throw new Error("outside dist");
    const body = await readFile(target);
    res.writeHead(200, { "content-type": MIME[path.extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    // Single-page app: unknown paths fall back to index.html.
    try {
      const body = await readFile(path.join(DIST_DIR, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(body);
    } catch {
      sendJson(res, 404, { error: "빌드된 화면이 없습니다. npm run build를 먼저 실행하세요." });
    }
  }
}

/**
 * Starts the API server. `port: 0` picks a free port (tests); the guard is built after listening
 * because the allowed Host values depend on the real port.
 * `dataDir` holds settings.json; `projectsRoot` overrides the projects folder (tests).
 */
export function startServer({ port = API_PORT, extraHosts = [], dataDir = path.join(ROOT_DIR, "data"), projectsRoot, runTool: runToolOverride, readGpu, appRoot = ROOT_DIR } = {}) {
  // Saving settings creates the input/output folders (SongYUE2 does the same for its folders).
  // Relative folder settings resolve against `appRoot` (tests pass a temp folder).
  const settings = createSettingsStore({ dir: dataDir, onSaved: (effective) => ensureWorkFolders(effective, appRoot) });
  const systemStats = createSystemStats({ readGpu });
  const events = createEventHub();
  const probeDuration = createDurationProbe({ getFfprobe: async () => ffprobeFor((await settings.get()).connections.ffmpegPath) });
  const projects = createProjectStore({
    probeDuration,
    getRoot: async () => {
      if (projectsRoot) return projectsRoot;
      return folderPaths(await settings.get(), appRoot).projects;
    },
  });

  const jobs = createJobQueue({
    dir: path.join(dataDir, "runtime"),
    events,
    // Keep how a generated file was made, so it can be made again from the screen.
    onFinished: async (job, result) => {
      if (!job.meta?.output || !job.meta?.record) return;
      const record = { ...job.meta.record, ...(result?.sentPrompts?.length ? { sent: result.sentPrompts } : {}) };
      await projects.setAssetRecord(job.meta.project, job.meta.output, record);
      // A re-made file is kept next to the shown one as another version.
      if (job.meta.candidateOf) await projects.addVersion(job.meta.project, job.meta.candidateOf, { file: job.meta.output, record });
    },
    // The engines keep their models in VRAM after a run; when the queue is empty they are let go (a setting), so SongYUE2 and others can use the card.
    onIdle: async () => {
      const { connections, video } = await settings.get();
      if (!video.freeVramWhenIdle) return;
      for (const url of [connections.comfyUrl, connections.refUrl]) await createComfy(url).free();
    },
    // `runTool` replaces the tool runner (tests use a fake one that only writes a file).
    run: runToolOverride,
    getConfig: async () => {
      const { connections } = await settings.get();
      return { connections, ffmpegPath: connections.ffmpegPath };
    },
  });
  let guard;
  const server = createServer(async (req, res) => {
    try {
      const verdict = guard.check(req);
      if (!verdict.ok) return sendJson(res, verdict.status, { error: verdict.error });

      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api/session") return sendJson(res, 200, { token: guard.token });
      if (url.pathname.startsWith("/api/")) {
        if (await handleApi(req, res, url, { settings, projects, events, jobs, systemStats, appRoot })) return;
        return sendJson(res, 404, { error: "없는 API입니다." });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "허용되지 않은 메서드입니다." });
      return await serveStatic(url, res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...error.extra });
      console.error(error);
      return sendJson(res, 500, { error: "서버 오류가 발생했습니다." });
    }
  });

  let watcher;
  const stop = () => {
    watcher?.close();
    events.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: the API can start work on this PC and must not be reachable from the LAN.
    server.listen(port, "127.0.0.1", async () => {
      const actual = server.address().port;
      guard = createGuard({ ports: [actual, WEB_PORT], extraHosts });
      try {
        // Never create the folder here: a wrong projects path would otherwise leave stray folders.
        const root = await projects.root();
        if ((await stat(root).catch(() => null))?.isDirectory()) {
          watcher = watchProjects({ root, onChange: (change) => events.broadcast("file", change) });
        }
      } catch (error) {
        // Live updates are a convenience; the API still works without them.
        console.error("프로젝트 폴더를 감시할 수 없습니다:", error.message);
      }
      resolve({ server, port: actual, token: guard.token, stop });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // ALLOWED_HOSTS: extra Host values (e.g. a Tailscale name) separated by commas.
  const extraHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  const { port } = await startServer({ extraHosts });
  console.log(`VideoStudioOM API listening on http://127.0.0.1:${port}`);
}
