import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import { resolveSettings } from "../shared/settings.mjs";
import { HttpError, parseRange, readJsonBody, sendJson } from "./http.mjs";
import { concatMedia, mixAudio } from "./concat.mjs";
import { applyEngine, checkWorkflow, comfyModels, listDir } from "./engine.mjs";
import { askWith, makePrompt } from "./prompt-maker.mjs";
import { ALLOWED_TOOLS, prepareInputs } from "./job-inputs.mjs";
import { folderStatus } from "./folders.mjs";
import { llmStatus } from "./llm-status.mjs";
import { resolveInside } from "./paths.mjs";

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

// Projects whose files are being joined right now (one join per project at a time).
const joining = new Set();

/** Handles /api/* requests. Returns false when no route matches. */
export async function handleApi(req, res, url, { settings, projects, events, jobs, systemStats, appRoot }) {
  const { pathname } = url;
  const method = req.method;
  const methodNotAllowed = () => {
    throw new HttpError(405, "허용되지 않은 메서드입니다.");
  };

  /** Joins audio pieces into assets/audio/narration.wav, or video clips into renders/final.mp4. */
  async function joinMedia(id, body) {
    const kinds = {
      audio: { extensions: /\.(wav|mp3|flac|ogg)$/i, output: "assets/audio/narration.wav" },
      video: { extensions: /\.(mp4|webm)$/i, output: "renders/final.mp4" },
    };
    const kind = kinds[body.kind === "mix" ? "audio" : body.kind];
    if (!kind) throw new HttpError(400, "종류는 audio, mix, video 중 하나여야 합니다.");
    // "mix": the pieces are [{ path, start }] placed at their start second instead of one after another.
    const list = Array.isArray(body.inputs) ? body.inputs : [];
    const starts = body.kind === "mix" ? list.map((item) => Number(item?.start) || 0) : [];
    const names = body.kind === "mix" ? list.map((item) => item?.path) : list;
    if (!Array.isArray(names) || names.length === 0 || names.length > 60 || names.some((name) => typeof name !== "string")) {
      throw new HttpError(400, "이어 붙일 파일 목록이 올바르지 않습니다.");
    }
    const dir = await projects.dir(id);
    const inputs = [];
    for (const name of names) {
      if (!/^assets[\\/]/i.test(name) || !kind.extensions.test(name) || name.replace(/\\/g, "/") === kind.output) throw new HttpError(400, `이어 붙일 수 없는 파일입니다: ${name}`);
      const { target } = await projects.statMedia(id, name);
      inputs.push(target);
    }
    if (joining.has(id)) throw new HttpError(409, "이미 이어 붙이는 중입니다.");
    joining.add(id);
    try {
      const ffmpegPath = (await settings.get()).connections.ffmpegPath;
      const output = await resolveInside(dir, kind.output);
      if (body.kind === "mix") await mixAudio({ ffmpegPath, pieces: inputs.map((file, i) => ({ file, startSeconds: starts[i] })), output });
      else await concatMedia({ ffmpegPath, kind: body.kind, inputs, output });
    } finally {
      joining.delete(id);
    }
    if (body.kind !== "video") await projects.setAssetRecord(id, kind.output, { kind: body.kind === "mix" ? "mix" : "concat", inputs: names });
    return { output: kind.output, count: inputs.length };
  }

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
      const dir = await projects.dir(body.project);
      const items = Array.isArray(body.items) ? body.items : [body];
      const { value: effective } = resolveSettings(await settings.get(), await projects.getSettings(body.project));
      if (items.length === 0 || items.length > 60) throw new HttpError(400, "한 번에 1~60개까지 만들 수 있습니다.");
      const prepared = [];
      for (const raw of items) {
        const item = requireObject(raw);
        if (!ALLOWED_TOOLS.has(item.tool)) throw new HttpError(400, "지원하지 않는 도구입니다.");
        const prepared_ = applyEngine(effective, { tool: item.tool, inputs: await prepareInputs(dir, item.inputs) });
        // `record` is how the file was made (prompt, scene, ...); it is saved so the file can be made again.
        // `output` (project-relative) lets the screen find the result; `label` is only for the job list.
        const record = item.record === undefined ? undefined : requireObject(item.record);
        const meta = { project: body.project, output: item.inputs.output_path, label: typeof item.label === "string" ? item.label.slice(0, 40) : undefined, record };
        prepared.push({ tool: prepared_.tool, inputs: prepared_.inputs, allowRoot: [dir, ...prepared_.allowRoots], meta });
      }
      if (Array.isArray(body.items)) sendJson(res, 202, await jobs.startBatch(prepared));
      else sendJson(res, 202, { job: await jobs.start(prepared[0]) });
    } else methodNotAllowed();
    return true;
  }

  const cancel = /^\/api\/jobs\/([a-z0-9-]+)\/cancel$/.exec(pathname);
  if (cancel) {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, { job: await jobs.cancel(cancel[1]) });
    return true;
  }

  if (pathname === "/api/prompt") {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    const detail = await projects.get(body.project);
    const recipeOf = (rel) => detail.media.images.find((file) => file.path === rel)?.record?.prompt;
    const prompt = await makePrompt(
      { target: body.target, mode: body.mode, text: body.text, duration: body.duration, title: detail.title, firstPrompt: typeof body.first === "string" ? recipeOf(body.first) : undefined, lastPrompt: typeof body.last === "string" ? recipeOf(body.last) : undefined },
      askWith((await settings.get()).llm),
    );
    sendJson(res, 200, { prompt });
    return true;
  }
  if (pathname === "/api/fs") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, await listDir(url.searchParams.get("dir") ?? "", { projectsDir: folderPaths(await settings.get(), appRoot).projects }));
    return true;
  }
  if (pathname === "/api/comfy/models") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, await comfyModels((await settings.get()).connections.comfyUrl));
    return true;
  }
  if (pathname === "/api/workflows/check") {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, await checkWorkflow(requireObject(await readJsonBody(req)).path, (await settings.get()).connections.comfyUrl));
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

  const match = /^\/api\/projects\/([^/]+)(?:\/(file|settings|media|meta|concat))?$/.exec(pathname);
  if (!match) return false;
  const id = decodeId(match[1]);

  if (!match[2]) {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, { project: await projects.get(id) });
  } else if (match[2] === "meta") {
    if (method !== "PUT") methodNotAllowed();
    sendJson(res, 200, { meta: await projects.updateMeta(id, await readJsonBody(req)) });
  } else if (match[2] === "media") {
    if (method === "DELETE") {
      await projects.deleteMedia(id, url.searchParams.get("path"));
      sendJson(res, 200, { ok: true });
    } else if (method === "GET") {
      await streamMedia(req, res, await projects.statMedia(id, url.searchParams.get("path")));
    } else methodNotAllowed();
  } else if (match[2] === "concat") {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, await joinMedia(id, requireObject(await readJsonBody(req))));
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
