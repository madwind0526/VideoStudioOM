import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import { resolveSettings } from "../shared/settings.mjs";
import { HttpError, parseRange, readJsonBody, sendJson } from "./http.mjs";
import { ALLOWED_TOOLS, prepareInputs } from "./job-inputs.mjs";
import { folderStatus } from "./folders.mjs";
import { llmStatus } from "./llm-status.mjs";

function decodeId(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "프로젝트 이름이 올바르지 않습니다.");
  }
}

function requireObject(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "요청 본문이 올바르지 않습니다.");
  return body;
}

async function streamMedia(req, res, file) {
  const range = parseRange(req.headers.range, file.size);
  if (range === "invalid") {
    res.writeHead(416, { "content-range": `bytes */${file.size}` });
    res.end();
    return;
  }
  const headers = { "content-type": file.mime, "accept-ranges": "bytes", "cache-control": "no-cache" };
  const options = range ? { start: range.start, end: range.end } : {};
  if (range) {
    res.writeHead(206, { ...headers, "content-range": `bytes ${range.start}-${range.end}/${file.size}`, "content-length": range.end - range.start + 1 });
  } else {
    res.writeHead(200, { ...headers, "content-length": file.size });
  }
  // pipeline destroys both streams if the browser drops the connection mid-video.
  await pipeline(createReadStream(file.target, options), res).catch(() => {});
}

/** Handles /api/* requests. Returns false when no route matches. */
export async function handleApi(req, res, url, { settings, projects, events, jobs, systemStats, appRoot }) {
  const { pathname } = url;
  const method = req.method;
  const methodNotAllowed = () => {
    throw new HttpError(405, "허용되지 않은 메서드입니다.");
  };

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "VideoStudioOM" });
    return true;
  }

  if (pathname === "/api/events") {
    if (method !== "GET") methodNotAllowed();
    if (!events.attach(req, res)) throw new HttpError(503, "열려 있는 화면이 너무 많습니다.");
    return true;
  }

  if (pathname === "/api/folders") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, { folders: await folderStatus(await settings.get(), appRoot) });
    return true;
  }

  if (pathname === "/api/llm/status") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, await llmStatus({ ollamaEndpoint: (await settings.get()).llm.ollama.endpoint }));
    return true;
  }

  if (pathname === "/api/system/stats") {
    if (method !== "GET") methodNotAllowed();
    const { lock, songyueBusy, current } = await jobs.gpu();
    // "What is the GPU doing": our own job first, then any other holder of the lock, then SongYUE2.
    const tool = current?.tool ?? (lock.busy ? lock.holder?.tool : null) ?? null;
    sendJson(res, 200, { ...(await systemStats()), activity: { tool, songyueBusy } });
    return true;
  }

  if (pathname === "/api/gpu") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, await jobs.gpu());
    return true;
  }

  if (pathname === "/api/jobs") {
    if (method === "GET") {
      sendJson(res, 200, await jobs.list());
    } else if (method === "POST") {
      const body = requireObject(await readJsonBody(req));
      if (!ALLOWED_TOOLS.has(body.tool)) throw new HttpError(400, "지원하지 않는 도구입니다.");
      const dir = await projects.dir(body.project);
      const inputs = await prepareInputs(dir, body.inputs);
      sendJson(res, 202, { job: await jobs.start({ tool: body.tool, inputs, allowRoot: dir, meta: { project: body.project } }) });
    } else methodNotAllowed();
    return true;
  }

  const cancel = /^\/api\/jobs\/([a-z0-9-]+)\/cancel$/.exec(pathname);
  if (cancel) {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, { job: await jobs.cancel(cancel[1]) });
    return true;
  }

  if (pathname === "/api/settings") {
    if (method === "GET") sendJson(res, 200, { settings: await settings.get() });
    else if (method === "PUT") sendJson(res, 200, { settings: await settings.update(requireObject(await readJsonBody(req))) });
    else methodNotAllowed();
    return true;
  }

  if (pathname === "/api/projects") {
    if (method === "GET") sendJson(res, 200, { projects: await projects.list() });
    else if (method === "POST") sendJson(res, 201, { project: await projects.create(requireObject(await readJsonBody(req)).title) });
    else methodNotAllowed();
    return true;
  }

  const match = /^\/api\/projects\/([^/]+)(?:\/(file|settings|media|meta))?$/.exec(pathname);
  if (!match) return false;
  const id = decodeId(match[1]);

  if (!match[2]) {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, { project: await projects.get(id) });
  } else if (match[2] === "meta") {
    if (method !== "PUT") methodNotAllowed();
    sendJson(res, 200, { meta: await projects.updateMeta(id, await readJsonBody(req)) });
  } else if (match[2] === "media") {
    if (method !== "GET") methodNotAllowed();
    await streamMedia(req, res, await projects.statMedia(id, url.searchParams.get("path")));
  } else if (match[2] === "file") {
    if (method === "GET") {
      sendJson(res, 200, await projects.readText(id, url.searchParams.get("path"), { optional: url.searchParams.get("optional") === "1" }));
    } else if (method === "PUT") {
      const body = requireObject(await readJsonBody(req));
      sendJson(res, 200, await projects.writeText(id, body.path, body.content, body.expectedMtimeMs ?? null));
    } else methodNotAllowed();
  } else {
    if (method === "PUT") await projects.updateSettings(id, requireObject(await readJsonBody(req)));
    else if (method !== "GET") methodNotAllowed();
    const stored = await projects.getSettings(id);
    const { value, overridden } = resolveSettings(await settings.get(), stored);
    sendJson(res, 200, { stored, effective: value, overridden });
  }
  return true;
}
