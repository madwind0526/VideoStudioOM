import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { resolveSettings } from "../shared/settings.mjs";
import { HttpError, parseRange, readJsonBody, sendJson } from "./http.mjs";
import { concatMedia, ffmpegFor, mixAudio } from "./concat.mjs";
import { availableCodecs, averageRgb, checkClip, CODEC_IDS, codecLabels, autoTrims, colorGains, exportVideo, ROLES, runCapture, seamGainsOf, srtFromScript } from "./post.mjs";
import { createComfy } from "./engine/comfy.mjs";
import { applyEngine, checkWorkflow, comfyModels, listDir } from "./engine.mjs";
import { bibleContext, readBible } from "./bible.mjs";
import { askWith, defaultSheetPrompt, makePrompt } from "./prompt-maker.mjs";
import { describePictures } from "./describe.mjs";
import { composePrompts, editInstruction, reviseImagePrompt } from "./images.mjs";
import { defaultPool, pickCombinations, pickOne, readPool, writePool } from "./image-pool.mjs";
import { runTool } from "./engine/tools.mjs";
import { generateBible, generateScenario, generateScript, generateSynopses } from "./story.mjs";
import { ALLOWED_TOOLS, prepareInputs } from "./job-inputs.mjs";
import { folderPaths, folderStatus } from "./folders.mjs";
import { llmStatus } from "./llm-status.mjs";
import { writeFileAtomic } from "./fs-util.mjs";
import { resolveInside } from "./paths.mjs";
import { PROMPT_GROUPS, addItems, deleteItem, importFolder, readLibrary, updateItem } from "./prompt-library.mjs";

const PROMPT_LOG = "studio/llm_prompts.json";

/**
 * Runs `run(ask)` and keeps every LLM call it made (system prompt, user prompt, answer) in studio/llm_prompts.json under
 * `stage`, so the screen can show what was sent. A failed run is kept too: the rejected answer is what explains the error.
 */
async function withPromptLog(projects, id, stage, ask, run) {
  const calls = [];
  const logged = async (system, user) => {
    const answer = await ask(system, user);
    calls.push({ system, user, answer });
    return answer;
  };
  try {
    return await run(logged);
  } finally {
    if (calls.length) {
      try {
        const { content, mtimeMs } = await projects.readText(id, PROMPT_LOG, { optional: true });
        const all = { ...JSON.parse(content || "{}"), [stage]: { at: new Date().toISOString(), calls } };
        await projects.writeText(id, PROMPT_LOG, `${JSON.stringify(all, null, 2)}
`, mtimeMs);
      } catch (error) {
        // The log is a convenience; it must never fail the generation itself, but the reason is kept in the server console.
        console.error(`프롬프트 기록을 저장하지 못했습니다 (${id}/${stage}): ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

const TEXT_ENDINGS = new Set([".txt", ".md", ".json"]);
const VIDEO_ENDINGS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
// First pictures of videos for the file browser: kept by file (name, date, size) and made three at a time.
const videoThumbs = new Map();
let thumbWorkers = 0;
const thumbWaiting = [];
async function videoThumb(ffmpegPath, target, info) {
  const key = `${target}|${info.mtimeMs}|${info.size}`;
  if (videoThumbs.has(key)) return videoThumbs.get(key);
  if (thumbWorkers >= 3) await new Promise((resolve) => thumbWaiting.push(resolve));
  thumbWorkers += 1;
  try {
    // A little into the clip (the very first frame is often black); a clip shorter than that gives its first frame.
    let picture = Buffer.alloc(0);
    for (const at of ["0.5", "0"]) {
      const args = ["-v", "error", "-ss", at, "-i", target, "-frames:v", "1", "-vf", "scale=320:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"];
      picture = (await runCapture(ffmpegFor(ffmpegPath), args, { timeoutMs: 20_000 })).stdout;
      if (picture.length > 0) break;
    }
    if (picture.length === 0) throw new HttpError(404, "영상에서 장면을 꺼내지 못했습니다.");
    if (videoThumbs.size >= 300) videoThumbs.delete(videoThumbs.keys().next().value);
    videoThumbs.set(key, picture);
    return picture;
  } finally {
    thumbWorkers -= 1;
    thumbWaiting.shift()?.();
  }
}

const PICTURE_MIMES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** The hidden project that holds the pictures of the image menu (see projects.ensureHidden). */
const IMAGE_LIBRARY = "_images";

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
const exporting = new Set();

/** Handles /api/* requests. Returns false when no route matches. */
export async function handleApi(req, res, url, { settings, projects, events, jobs, systemStats, appRoot, dataDir }) {
  const { pathname } = url;
  const method = req.method;
  const methodNotAllowed = () => {
    throw new HttpError(405, "허용되지 않은 메서드입니다.");
  };

  /** Subtitles, the finished export and the clip check of one project. */
  async function postProduce(id, what, method, body) {
    if (method !== "POST") methodNotAllowed();
    const dir = await projects.dir(id);
    const ffmpegPath = (await settings.get()).connections.ffmpegPath;
    const readJson = async (rel) => {
      try {
        return JSON.parse((await projects.readText(id, rel, { optional: true })).content ?? "null");
      } catch {
        return null;
      }
    };
    const subtitles = async () => srtFromScript(await readJson("artifacts/script.json"), (await readJson("studio/audio_kinds.json")) ?? {});
    if (what === "subtitles") {
      const srt = await subtitles();
      if (!srt) throw new HttpError(400, "자막으로 만들 대화가 대본에 없습니다.");
      const target = await resolveInside(dir, "renders/subtitles.srt");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFileAtomic(target, srt);
      return { output: "renders/subtitles.srt" };
    }
    if (what === "qa") {
      const names = (await projects.get(id)).media.videos.map((file) => file.path);
      const results = [];
      for (const name of names) results.push({ path: name, ...(await checkClip(ffmpegPath, (await projects.statMedia(id, name)).target)) });
      return { results };
    }
    // export
    if (exporting.has(id)) throw new HttpError(409, "이미 내보내는 중입니다.");
    const codec = CODEC_IDS.includes(body.codec) ? body.codec : resolveSettings(await settings.get(), await projects.getSettings(id)).value.video.codec;
    const video = await projects.statMedia(id, "renders/final.mp4").catch(() => {
      throw new HttpError(400, "먼저 동영상 화면에서 구간 영상을 이어 붙여 완성본을 만드세요.");
    });
    const sound = body.sound !== false ? await projects.statMedia(id, "assets/audio/narration.wav").catch(() => null) : null;
    const srt = body.burnSubtitles === true ? await subtitles() : "";
    if (body.burnSubtitles === true && !srt) throw new HttpError(400, "자막으로 만들 대화가 대본에 없습니다.");
    exporting.add(id);
    try {
      await exportVideo({ ffmpegPath, video: video.target, audio: sound?.target, subtitles: srt, codec, output: await resolveInside(dir, "renders/export.mp4") });
    } finally {
      exporting.delete(id);
    }
    return { output: "renders/export.mp4", codec, sound: Boolean(sound), subtitles: Boolean(srt) };
  }

  /**
   * Puts a picture from anywhere on this PC at a fixed place of the project (`as`, e.g. assets/images/1-1.png) as a PNG, cut to
   * `fit` ([width, height]) without stretching. A picture already there is not lost: the new one becomes its next version and is chosen.
   */
  async function importPicture(id, { from, as, fit }) {
    if (typeof as !== "string" || !/^assets\/images\/[\p{L}\p{N}._-]+\.png$/u.test(as)) throw new HttpError(400, "그림은 assets/images 아래의 .png 이름으로만 가져올 수 있습니다.");
    if (typeof from !== "string" || !path.isAbsolute(from) || ![".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(from).toLowerCase())) throw new HttpError(400, "png, jpg, webp 그림의 전체 경로가 필요합니다.");
    if (!Array.isArray(fit) || fit.length !== 2 || !fit.every((n) => Number.isInteger(n) && n >= 64 && n <= 4096)) throw new HttpError(400, "fit은 [가로, 세로] 크기여야 합니다.");
    const info = await stat(from).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, "파일을 찾을 수 없습니다.");
    if (info.size > 30_000_000) throw new HttpError(413, "이미지가 너무 큽니다(30MB 이하).");
    const dir = await projects.dir(id);
    const exists = await stat(await resolveInside(dir, as)).then((item) => item.isFile(), () => false);
    const rel = exists ? `assets/versions/${path.basename(as, ".png")}-${Date.now().toString(36)}.png` : as;
    const target = await resolveInside(dir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    const [width, height] = fit;
    const ffmpegPath = (await settings.get()).connections.ffmpegPath;
    await runCapture(ffmpegFor(ffmpegPath), ["-hide_banner", "-loglevel", "error", "-y", "-i", from, "-frames:v", "1", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`, target]);
    const record = { kind: "image", prompt: "", imported: path.basename(from) };
    if (!exists) await projects.setAssetRecord(id, as, record);
    else {
      const entry = await projects.addVersion(id, as, { file: rel, record });
      await projects.selectVersion(id, as, entry.versions.at(-1).id);
    }
    return as;
  }

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
    const roles = body.kind === "mix" ? list.map((item) => (ROLES.includes(item?.role) ? item.role : "dialogue")) : [];
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
    let resized = 0;
    joining.add(id);
    try {
      const ffmpegPath = (await settings.get()).connections.ffmpegPath;
      const output = await resolveInside(dir, kind.output);
      if (body.kind === "mix") await mixAudio({ ffmpegPath, pieces: inputs.map((file, i) => ({ file, startSeconds: starts[i], role: roles[i] })), duck: body.duck === true, output });
      else {
        // colorMatch: every clip is moved towards the average colour of all clips, so a long video does not flicker in tone.
        const gains = body.kind === "video" && body.colorMatch === true ? colorGains(await Promise.all(inputs.map((file) => averageRgb(ffmpegPath, file)))) : [];
        // The length a clip was made for (its record), when the project remembers it.
        const records = await projects.assetRecords(id);
        const keeps = names.map((name) => {
          const record = records[String(name).replace(/\\/g, "/")];
          return Number(record?.keep ?? record?.duration) || null;
        });
        // overlapSeconds: "auto" lets the system decide where each clip ends; a number is the seconds cut off every clip's end.
        const trimEnd = body.kind === "video" && body.overlapSeconds === "auto" ? await autoTrims(ffmpegPath, inputs, keeps) : Number(body.overlapSeconds ?? 0);
        if (!(Array.isArray(trimEnd) || (trimEnd >= 0 && trimEnd <= 5))) throw new HttpError(400, "겹침 시간은 0~5초여야 합니다.");
        const seams = body.kind === "video" && body.seamColor === true ? await seamGainsOf(ffmpegPath, inputs, trimEnd) : [];
        const { seamRampSeconds: seamRamp, codec: videoCodec } = resolveSettings(await settings.get(), await projects.getSettings(id)).value.video;
        if (body.kind === "video" && !(await availableCodecs(ffmpegPath)).includes(videoCodec)) throw new HttpError(400, `이 PC의 ffmpeg에서 ${codecLabels()[videoCodec]}을(를) 쓸 수 없습니다. 영상 저장 방식을 바꾸세요.`);
        resized = (await concatMedia({ ffmpegPath, kind: body.kind, inputs, output, gains, trimEnd, seamGains: seams, seamRamp, videoCodec })).resized;
      }
    } finally {
      joining.delete(id);
    }
    if (body.kind !== "video") await projects.setAssetRecord(id, kind.output, { kind: body.kind === "mix" ? "mix" : "concat", inputs: names });
    return { output: kind.output, count: inputs.length, resized };
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
        // `candidateOf`: the file is a new version of that file instead of a file of its own.
        const candidateOf = typeof item.candidateOf === "string" ? item.candidateOf : undefined;
        const meta = { project: body.project, output: item.inputs.output_path, label: typeof item.label === "string" ? item.label.slice(0, 40) : undefined, record, candidateOf };
        prepared.push({ tool: prepared_.tool, inputs: prepared_.inputs, allowRoot: [dir, ...prepared_.allowRoots], meta });
      }
      if (Array.isArray(body.items)) sendJson(res, 202, await jobs.startBatch(prepared));
      else sendJson(res, 202, { job: await jobs.start(prepared[0]) });
    } else methodNotAllowed();
    return true;
  }

  if (pathname === "/api/jobs/resume" || pathname === "/api/jobs/discard") {
    if (method !== "POST") methodNotAllowed();
    if (pathname === "/api/jobs/resume") sendJson(res, 202, await jobs.resume());
    else {
      await jobs.discardPaused();
      sendJson(res, 200, { ok: true });
    }
    return true;
  }

  const forget = /^\/api\/jobs\/([a-z0-9-]+)$/.exec(pathname);
  if (forget) {
    if (method !== "DELETE") methodNotAllowed();
    await jobs.forget(forget[1]);
    sendJson(res, 200, { ok: true });
    return true;
  }

  const cancel = /^\/api\/jobs\/([a-z0-9-]+)\/cancel$/.exec(pathname);
  if (cancel) {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, { job: await jobs.cancel(cancel[1]) });
    return true;
  }

  const story = /^\/api\/story\/(synopsis|bible|scenario|script)$/.exec(pathname);
  if (story) {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    const id = body.project;
    const detail = await projects.get(id);
    const baseAsk = askWith((await settings.get()).llm);
    const readFileText = async (rel) => (await projects.readText(id, rel, { optional: true })).content ?? "";
    const synopsis = await readFileText("studio/synopsis.md");
    const bible = await readBible(projects, id);
    const preset = typeof body.preset === "string" ? body.preset : bible.preset;
    const { value: effective } = resolveSettings(await settings.get(), await projects.getSettings(id));
    const totalSeconds = Number(body.totalSeconds) > 0 ? Number(body.totalSeconds) : effective.defaults.durationSeconds;
    const hasBible = bible.characters.length > 0;
    await withPromptLog(projects, id, story[1], baseAsk, async (ask) => {
      if (story[1] === "synopsis") sendJson(res, 200, { options: await generateSynopses({ idea: body.idea, preset, count: body.count, totalSeconds }, ask) });
      else if (story[1] === "bible") sendJson(res, 200, { bible: { ...(await generateBible({ synopsis, preset }, ask)), preset: preset ?? "" } });
      else if (story[1] === "scenario") sendJson(res, 200, { scenario: await generateScenario({ synopsis, bible: hasBible ? bible : null, preset, totalSeconds }, ask) });
      else {
        let scenario = null;
        try {
          scenario = JSON.parse(await readFileText("artifacts/scene_plan.json"));
        } catch {
          scenario = null;
        }
        sendJson(res, 200, await generateScript({ synopsis, scenario, bible: hasBible ? bible : null, title: detail.title }, ask));
      }
    });
    return true;
  }
  if (pathname === "/api/prompt") {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    const detail = await projects.get(body.project);
    const recipeOf = (rel) => detail.media.images.find((file) => file.path === rel)?.record?.prompt;
    const bible = await readBible(projects, body.project);
    // A sheet is about one character: only the style is shared. Other prompts take every bible entry the idea names.
    const bibleText = body.target === "sheet" ? (bible.style.trim() ? `Visual style: ${bible.style.trim()}` : "") : typeof body.text === "string" ? bibleContext(bible, body.text) : "";
    const refs = Array.isArray(body.refs) ? body.refs.filter((ref) => typeof ref === "string").slice(0, 9).map((ref) => ref.slice(0, 600)) : [];
    const sheetSystem = (await settings.get()).llm.sheetPrompt;
    // A video prompt starts from what the pictures really show: the first/last picture (or the clip before, whose last picture the clip continues from) and the references.
    // Skipped while a job holds the GPU: describing loads a model on the same card.
    const refPaths = Array.isArray(body.refPaths) ? body.refPaths.filter((ref) => typeof ref === "string").slice(0, 9) : [];
    const wanted = body.target === "video" ? [typeof body.first === "string" ? body.first : "", typeof body.last === "string" ? body.last : "", ...refPaths] : [];
    const refVideo = typeof body.refVideo === "string" ? body.refVideo : "";
    let seen = {};
    if ((wanted.some(Boolean) || refVideo) && body.target === "video" && body.describe !== false && !(await jobs.list()).current) {
      const config = (await settings.get()).connections;
      const describe = (tool, inputs) => runTool({ tool, inputs, connections: config, ffmpegPath: config.ffmpegPath }).then((result) => (result.ok ? result.data.text : Promise.reject(new Error(result.error))));
      const looked = await describePictures({ projects, id: body.project, rels: wanted, run: (file) => describe("describe_image", { image_path: file }) });
      const clip = refVideo ? await describePictures({ projects, id: body.project, rels: [refVideo], kind: "video:", run: (file) => describe("describe_video", { video_path: file }) }) : {};
      seen = { first: looked[wanted[0]], last: looked[wanted[1]], refs: refPaths.map((rel) => looked[rel]), video: clip[refVideo] };
    }
    const prompt = await withPromptLog(projects, body.project, `prompt-${body.target}`, askWith((await settings.get()).llm), (ask) =>
      makePrompt({ target: body.target, mode: body.mode, imageModel: typeof body.imageModel === "string" ? body.imageModel.slice(0, 60) : undefined, text: body.text, duration: body.duration, title: detail.title, refs, bible: bibleText, sheetSystem, firstPrompt: typeof body.first === "string" ? recipeOf(body.first) : undefined, lastPrompt: typeof body.last === "string" ? recipeOf(body.last) : undefined, seen }, ask),
    );
    sendJson(res, 200, { prompt });
    return true;
  }
  if (pathname === "/api/images/ensure") {
    // The image library is a hidden project (see projects.ensureHidden): jobs, versions, records and descriptions work on it as on any project.
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, { project: await projects.ensureHidden(IMAGE_LIBRARY, "이미지 보관함") });
    return true;
  }
  if (pathname === "/api/images/pool" || pathname === "/api/images/random" || pathname === "/api/images/compose") {
    // The mixing pool of the image menu (data/image-pools.json, or the built-in one until it is saved).
    const poolFile = path.join(dataDir, "image-pools.json");
    if (pathname === "/api/images/pool") {
      if (method === "GET") sendJson(res, 200, { pool: await readPool(poolFile), defaults: defaultPool() });
      else if (method === "PUT") sendJson(res, 200, { pool: await writePool(poolFile, requireObject(await readJsonBody(req)).pool) });
      else methodNotAllowed();
      return true;
    }
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    if (pathname === "/api/images/random") {
      const pool = await readPool(poolFile);
      const locked = body.locked && typeof body.locked === "object" && !Array.isArray(body.locked) ? Object.fromEntries(Object.entries(body.locked).filter(([key, value]) => pool.categories.some((category) => category.id === key) && typeof value === "string" && value.trim()).map(([key, value]) => [key, value.trim().slice(0, 200)])) : {};
      // `redo` = { category, avoid }: one category of one combination again (the dice button of the screen).
      if (body.redo && typeof body.redo.category === "string") sendJson(res, 200, { phrase: pickOne(pool, body.redo.category, { avoid: typeof body.redo.avoid === "string" ? body.redo.avoid : "", gender: typeof body.redo.gender === "string" ? body.redo.gender : "" }) });
      else sendJson(res, 200, { combinations: pickCombinations(pool, { count: body.count, locked }) });
      return true;
    }
    const prompts = await withPromptLog(projects, IMAGE_LIBRARY, "image-compose", askWith((await settings.get()).llm), (logged) => readPool(poolFile).then((pool) => composePrompts({ combinations: body.combinations, labels: Object.fromEntries(pool.categories.map(({ id, label }) => [id, label])) }, logged)));
    sendJson(res, 200, { prompts });
    return true;
  }
  if (pathname === "/api/images/edit-prompt") {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    const prompt = await withPromptLog(projects, IMAGE_LIBRARY, "image-edit", askWith((await settings.get()).llm), (logged) => editInstruction({ text: body.text, count: body.count, naming: body.naming === "plain" ? "plain" : "tokens" }, logged));
    sendJson(res, 200, { prompt });
    return true;
  }
  if (pathname === "/api/images/analyze" || pathname === "/api/images/vary") {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    const config = await settings.get();
    const ask = askWith(config.llm);
    if (pathname === "/api/images/vary") {
      const prompt = await withPromptLog(projects, IMAGE_LIBRARY, "image-vary", ask, (logged) => reviseImagePrompt({ prompt: body.prompt, request: body.request }, logged));
      sendJson(res, 200, { prompt });
      return true;
    }
    // A picture of the library: what it shows (QwenVL, kept per picture), then that as a Krea prompt the user can edit.
    if (typeof body.path !== "string") throw new HttpError(400, "분석할 그림을 고르세요.");
    if ((await jobs.list()).current) throw new HttpError(409, "다른 작업이 끝난 뒤에 분석할 수 있습니다 (같은 GPU를 씁니다).");
    let failure = "";
    const looked = await describePictures({
      projects,
      id: IMAGE_LIBRARY,
      rels: [body.path],
      run: (file) => runTool({ tool: "describe_image", inputs: { image_path: file }, connections: config.connections, ffmpegPath: config.connections.ffmpegPath }).then((result) => (result.ok ? result.data.text : Promise.reject(new Error((failure = result.error))))),
    });
    const description = looked[body.path];
    if (!description) throw new HttpError(502, `그림을 분석하지 못했습니다${failure ? `: ${failure}` : ""}`);
    const prompt = await withPromptLog(projects, IMAGE_LIBRARY, "image-analyze", ask, (logged) => makePrompt({ target: "image", text: description.slice(0, 3500) }, logged));
    sendJson(res, 200, { description, prompt });
    return true;
  }
  if (pathname === "/api/prompt-library" || pathname.startsWith("/api/prompt-library/")) {
    // The prompt library (data/prompt-library.json): prompts sorted into image/video x Local/API, each with an optional thumbnail.
    const file = path.join(dataDir, "prompt-library.json");
    const rest = pathname.slice("/api/prompt-library".length).replace(/^\//, "");
    if (rest === "import") {
      if (method !== "POST") methodNotAllowed();
      const body = requireObject(await readJsonBody(req));
      sendJson(res, 200, await importFolder({ dir: body.dir, file, ask: askWith((await settings.get()).llm) }));
    } else if (rest === "") {
      if (method === "GET") sendJson(res, 200, { groups: PROMPT_GROUPS, items: (await readLibrary(file)).items, defaultDir: path.join(os.homedir(), "Documents", "ComfyUI", "user", "default", "Prompt", "Default") });
      else if (method === "POST") sendJson(res, 200, await addItems(file, [requireObject(await readJsonBody(req))]));
      else methodNotAllowed();
    } else if (method === "PUT") {
      sendJson(res, 200, { item: await updateItem(file, rest, requireObject(await readJsonBody(req))) });
    } else if (method === "DELETE") {
      await deleteItem(file, rest);
      sendJson(res, 200, { ok: true });
    } else {
      methodNotAllowed();
    }
    return true;
  }
  if (pathname === "/api/prompts/default") {
    if (method !== "GET") methodNotAllowed();
    sendJson(res, 200, { sheet: await defaultSheetPrompt() });
    return true;
  }
  if (pathname === "/api/gpu/free") {
    if (method !== "POST") methodNotAllowed();
    if ((await jobs.list()).current) throw new HttpError(409, "작업이 진행 중일 때는 VRAM을 비울 수 없습니다.");
    const { connections } = await settings.get();
    // Both ComfyUI servers (the generator and Rev0, which upscales) keep models loaded after a run.
    const freed = [];
    for (const [name, url] of [["comfy", connections.comfyUrl], ["ref", connections.refUrl]]) if (await createComfy(url).free()) freed.push(name);
    sendJson(res, 200, { freed });
    return true;
  }
  if (pathname === "/api/export/codecs") {
    if (method !== "GET") methodNotAllowed();
    const usable = await availableCodecs((await settings.get()).connections.ffmpegPath);
    sendJson(res, 200, { codecs: usable.map((id) => ({ id, label: codecLabels()[id] })) });
    return true;
  }
  if (pathname === "/api/fs/image") {
    // A picture from any folder, for the thumbnails of the file browser (pictures only; the listing already shows every folder).
    if (method !== "GET") methodNotAllowed();
    const target = url.searchParams.get("path") ?? "";
    const mime = PICTURE_MIMES[path.extname(target).toLowerCase()];
    if (!mime || target.includes("\0") || !path.isAbsolute(target)) throw new HttpError(400, "그림 파일이 아닙니다.");
    const info = await stat(target).catch(() => null);
    if (!info?.isFile() || info.size > 100 * 1024 * 1024) throw new HttpError(404, "그림 파일을 찾을 수 없습니다.");
    await streamMedia(req, res, { target, size: info.size, mime });
    return true;
  }
  if (pathname === "/api/fs/text") {
    // A text file from any folder (the prompt picker of the image menu reads its prompt file this way).
    if (method !== "GET") methodNotAllowed();
    const target = url.searchParams.get("path") ?? "";
    if (!TEXT_ENDINGS.has(path.extname(target).toLowerCase()) || target.includes("\0") || !path.isAbsolute(target)) throw new HttpError(400, "텍스트 파일(.txt, .md, .json)이 아닙니다.");
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, "파일을 찾을 수 없습니다.");
    if (info.size > 30 * 1024 * 1024) throw new HttpError(400, "파일이 너무 큽니다(30MB까지).");
    sendJson(res, 200, { name: path.basename(target), text: (await readFile(target, "utf8")).replace(/^\uFEFF/, "") });
    return true;
  }
  if (pathname === "/api/fs/thumb") {
    // The first picture of a video from any folder (a small JPEG), for the thumbnails of the file browser.
    if (method !== "GET") methodNotAllowed();
    const target = url.searchParams.get("path") ?? "";
    if (!VIDEO_ENDINGS.has(path.extname(target).toLowerCase()) || target.includes("\0") || !path.isAbsolute(target)) throw new HttpError(400, "동영상 파일이 아닙니다.");
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) throw new HttpError(404, "동영상 파일을 찾을 수 없습니다.");
    const picture = await videoThumb((await settings.get()).connections.ffmpegPath, target, info).catch((e) => {
      throw e instanceof HttpError ? e : new HttpError(404, "영상에서 장면을 꺼내지 못했습니다.");
    });
    res.writeHead(200, { "content-type": "image/jpeg", "content-length": picture.length, "cache-control": "private, max-age=300" });
    res.end(picture);
    return true;
  }
  if (pathname === "/api/fs") {
    if (method !== "GET") methodNotAllowed();
    // `project` (an id) adds the open project's folder to the shortcuts.
    const open = url.searchParams.get("project");
    sendJson(res, 200, await listDir(url.searchParams.get("dir") ?? "", { projectsDir: folderPaths(await settings.get(), appRoot).projects, projectDir: open ? await projects.dir(open) : undefined }));
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

  const match = /^\/api\/projects\/([^/]+)(?:\/(file|settings|media|meta|concat|export|subtitles|qa|import|versions|arrange))?$/.exec(pathname);
  if (!match) return false;
  const id = decodeId(match[1]);

  if (!match[2]) {
    if (method === "DELETE") {
      if ((await jobs.list()).current?.meta?.project === id) throw new HttpError(409, "이 프로젝트의 작업이 진행 중입니다. 끝난 뒤에 지우세요.");
      await projects.remove(id);
      sendJson(res, 200, { removed: id });
      return true;
    }
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
  } else if (match[2] === "subtitles" || match[2] === "export" || match[2] === "qa") {
    sendJson(res, 200, await postProduce(id, match[2], method, requireObject(method === "POST" ? await readJsonBody(req) : {})));
  } else if (match[2] === "versions") {
    // GET: the versions and prompt history of one file; PUT: keep an edited prompt; POST: choose a version.
    if (method === "GET") sendJson(res, 200, { entry: await projects.versionsOf(id, url.searchParams.get("path")) });
    else if (method === "PUT") {
      const body = requireObject(await readJsonBody(req));
      sendJson(res, 200, { entry: await projects.saveDraft(id, body.path, body) });
    } else if (method === "POST") {
      const body = requireObject(await readJsonBody(req));
      sendJson(res, 200, { entry: await projects.selectVersion(id, body.path, body.select) });
    } else methodNotAllowed();
  } else if (match[2] === "arrange") {
    if (method !== "POST") methodNotAllowed();
    sendJson(res, 200, await projects.arrange(id, requireObject(await readJsonBody(req))));
  } else if (match[2] === "import") {
    if (method !== "POST") methodNotAllowed();
    const body = requireObject(await readJsonBody(req));
    // A video of another project: copied by its project id and path (the screen does not know the folders).
    if (body.kind === "video" && typeof body.fromProject === "string") sendJson(res, 200, { path: await projects.importVideo(id, (await projects.statMedia(body.fromProject, String(body.path ?? ""))).target) });
    else if (body.as !== undefined) sendJson(res, 200, { path: await importPicture(id, body) });
    else sendJson(res, 200, { path: await (body.kind === "audio" ? projects.importAudio(id, body.from) : body.kind === "video" ? projects.importVideo(id, body.from) : projects.importImage(id, body.from)) });
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
