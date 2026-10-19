import { Combine, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, mediaUrl, type MediaFile } from "../api";
import GenerateForm from "../components/GenerateForm";
import JobList from "../components/JobList";
import Lightbox from "../components/Lightbox";
import { useJsonFile } from "../useFile";
import { AUDIO_KINDS_FILE, audioKindOf, baseName, deleteMedia, joinMedia, makeItem, mixMedia, recipeOf, refineItem, startItems, type MakeItem, type MakeKind, type Recipe } from "./mediaJobs";
import type { SectionProps } from "./types";

const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);
// File names come from scene and section ids, which can hold anything the user typed.
const safeName = (id: string) => id.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "item";
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

interface Scene {
  id: string;
  description?: string;
  start_seconds?: number;
  end_seconds?: number;
}
interface Part {
  id: string;
  text?: string;
  start_seconds?: number;
  end_seconds?: number;
  speaker_directions?: string;
}

/** Re-make and delete icons for one generated file (top right of its tile or row). */
function ItemTools({ props, file, kind }: { props: SectionProps; file: MediaFile; kind: MakeKind | null }) {
  const { project, view, jobs, onJobsChanged, notify } = props;
  const recipe = recipeOf(file.record);
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [text, setText] = useState("");
  const [lyrics, setLyrics] = useState("");
  const running = jobs.current !== null;
  // Files made elsewhere have no recipe; images and speech can still be made again from a new description.
  const base: Recipe | null = recipe ?? (kind === "image" || kind === "voice" ? { kind, prompt: "" } : null);

  async function again() {
    if (!view || !base) return;
    const item = makeItem(view.effective, { ...base, prompt: text, lyrics: base.kind === "vocal" ? lyrics : base.lyrics }, file.path);
    if (typeof item === "string") return notify(item);
    try {
      await startItems(project.id, [item]);
      notify("다시 만들기를 시작했습니다.");
      setMode(null);
      onJobsChanged();
    } catch (e) {
      notify(message(e, "다시 만들지 못했습니다."));
    }
  }

  async function remove() {
    try {
      await deleteMedia(project.id, file.path);
      notify("지웠습니다.");
      onJobsChanged();
    } catch (e) {
      notify(message(e, "지우지 못했습니다."));
    }
  }

  return (
    <>
      <div className="item-tools">
      <button
        className="icon-btn"
        type="button"
        aria-label="다시 만들기"
        title={base ? (running ? "다른 작업이 끝난 뒤에 할 수 있습니다." : "다시 만들기") : "만든 방법이 기록되지 않아 다시 만들 수 없습니다."}
        disabled={!base || running}
        onClick={() => {
          setText(recipe?.prompt ?? "");
          setLyrics(recipe?.lyrics ?? "");
          setMode(mode === "edit" ? null : "edit");
        }}
      >
        <RefreshCw size={15} />
      </button>
      <button className="icon-btn" type="button" aria-label="지우기" title="지우기" onClick={() => setMode(mode === "delete" ? null : "delete")}>
        <Trash2 size={15} />
      </button>
      </div>
      {mode === "delete" && (
        <div className="item-pop">
          <p>이 파일을 지울까요?</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="button" onClick={() => setMode(null)}>
              아니요
            </button>
            <button className="btn primary" type="button" onClick={() => void remove()}>
              지우기
            </button>
          </div>
        </div>
      )}
      {mode === "edit" && base && (
        <div className="item-pop">
          <label>{{ voice: "대사", image: "이미지 설명", sfx: "소리 설명 (영어)", instrumental: "음악 스타일", vocal: "음악 스타일" }[base.kind as string] ?? "움직임 설명"}</label>
          <textarea rows={4} value={text} maxLength={7000} onChange={(event) => setText(event.target.value)} />
          {base.kind === "vocal" && (
            <>
              <label>가사</label>
              <textarea rows={3} value={lyrics} maxLength={4000} onChange={(event) => setLyrics(event.target.value)} />
            </>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="button" onClick={() => setMode(null)}>
              취소
            </button>
            <button className="btn primary" type="button" onClick={() => void again()}>
              <RefreshCw size={14} /> 다시 만들기
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface HeaderProps {
  props: SectionProps;
  title: string;
  count: number;
  creating: boolean;
  onCreating: (value: boolean) => void;
  /** Items for "전체 만들기" (only what is still missing) and how that is described. */
  all: { items: MakeItem[]; note: string } | null;
  /** Items the prompt maker should rewrite first (images, clips); sections that do not need it leave this off. */
  refine?: boolean;
  join?: { count: number; busy: boolean; label: string; name?: string; onJoin: () => void };
}

function Header({ props, title, count, creating, onCreating, all, refine, join }: HeaderProps) {
  const { jobs, onJobsChanged, notify, project, view } = props;
  const [preparing, setPreparing] = useState<string | null>(null);
  const running = jobs.current !== null || preparing !== null;
  async function makeAll() {
    if (!all || all.items.length === 0 || !view) return;
    try {
      // The prompt maker (LLM) writes each prompt first; one that fails keeps the original description.
      const items: MakeItem[] = [];
      let failed = 0;
      for (const [index, item] of all.items.entries()) {
        setPreparing(`${index + 1}/${all.items.length}`);
        try {
          items.push(refine === false ? item : await refineItem(project.id, view.effective, item));
        } catch {
          failed += 1;
          items.push(item);
        }
      }
      setPreparing(null);
      await startItems(project.id, items);
      notify(`${items.length}개를 차례로 만듭니다.${failed ? ` (프롬프트를 못 만든 ${failed}개는 입력한 설명 그대로 만듭니다.)` : ""}`);
      onJobsChanged();
    } catch (e) {
      notify(message(e, "작업을 시작하지 못했습니다."));
    } finally {
      setPreparing(null);
    }
  }
  return (
    <div className="section-head">
      <h2>
        {title}
        <span className="count">{count}</span>
      </h2>
      <div className="row" style={{ gap: 8 }}>
        {all && (
          <button className="btn" type="button" disabled={running || all.items.length === 0} title={all.note} onClick={() => void makeAll()}>
            <Layers size={15} /> {preparing ? `프롬프트 만드는 중 ${preparing}` : `전체 만들기${all.items.length > 0 ? ` (${all.items.length})` : ""}`}
          </button>
        )}
        {join && (
          <button className="btn" type="button" disabled={join.busy || join.count < 1} title={join.label} onClick={join.onJoin}>
            <Combine size={15} /> {join.busy ? "합치는 중..." : `${join.name ?? "이어 붙이기"} (${join.count})`}
          </button>
        )}
        <button className="btn primary" type="button" aria-pressed={creating} onClick={() => onCreating(!creating)}>
          <Plus size={15} /> 새로 만들기
        </button>
      </div>
    </div>
  );
}

function Top({ props, kinds, outputs, creating }: { props: SectionProps; kinds: Parameters<typeof GenerateForm>[0]["kinds"]; outputs: string[]; creating: boolean }) {
  const { project, detail, view, jobs, onJobsChanged, notify } = props;
  return (
    <>
      {creating && <GenerateForm projectId={project.id} kinds={kinds} view={view} media={{ images: detail?.media.images ?? [], audio: detail?.media.audio ?? [] }} running={jobs.current !== null} notify={notify} onStarted={onJobsChanged} />}
      <JobList projectId={project.id} jobs={jobs.history} outputs={outputs} pending={jobs.pending} onChanged={onJobsChanged} />
    </>
  );
}

/** Checkboxes for what goes into a join; everything is in unless it is switched off. */
function useSelection(paths: string[]) {
  const [off, setOff] = useState<string[]>([]);
  const picked = paths.filter((path) => !off.includes(path));
  const toggle = (path: string) => setOff((list) => (list.includes(path) ? list.filter((item) => item !== path) : [...list, path]));
  return { picked, isOn: (path: string) => !off.includes(path), toggle };
}

/** The project's images: every file of assets/images, plus making new ones (all scenes at once, or one by one). */
export function ImagesSection(props: SectionProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const plan = useJsonFile<{ scenes?: Scene[] }>(props.project.id, "artifacts/scene_plan.json", props.notify);
  const images = props.detail?.media.images ?? [];
  const settings = props.view?.effective;

  const missing = (plan.data?.scenes ?? []).filter((scene) => scene.description?.trim() && !images.some((file) => file.path === `assets/images/${safeName(scene.id)}.png`));
  const items = settings ? missing.flatMap((scene) => {
    const item = makeItem(settings, { kind: "image", prompt: scene.description ?? "", source: scene.id }, `assets/images/${safeName(scene.id)}.png`);
    return typeof item === "string" ? [] : [item];
  }) : [];

  return (
    <div className="section">
      <Header props={props} title="이미지" count={images.length} creating={creating} onCreating={setCreating} all={{ items, note: "시나리오의 장면 중 아직 이미지가 없는 장면의 이미지를 차례로 모두 만듭니다." }} />
      <Top props={props} kinds={["image"]} outputs={["assets/images/"]} creating={creating} />
      {images.length === 0 ? (
        <p className="muted">아직 이미지가 없습니다. 시나리오가 있으면 "전체 만들기"로 장면마다 만들 수 있어요.</p>
      ) : (
        <div className="thumbs big">
          {images.map((file) => (
            <div key={file.path} className="media-item">
              <button type="button" title={file.path} onClick={() => setOpen(file.path)}>
                <img src={mediaUrl(props.project.id, file.path, file.mtimeMs)} alt={file.path} loading="lazy" />
                <span>{file.path.replace("assets/images/", "")}</span>
              </button>
              <ItemTools props={props} file={file} kind="image" />
            </div>
          ))}
        </div>
      )}
      {open && <Lightbox src={mediaUrl(props.project.id, open, images.find((file) => file.path === open)?.mtimeMs)} alt={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The project's audio: one file per script section (dialogue by TTS; effects, music and vocals by SongYUE2), mixed on the script's timeline. */
export function AudioSection(props: SectionProps) {
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const script = useJsonFile<{ sections?: Part[] }>(props.project.id, "artifacts/script.json", props.notify);
  const kinds = useJsonFile<Record<string, string>>(props.project.id, AUDIO_KINDS_FILE, props.notify);
  const audio = props.detail?.media.audio ?? [];
  const settings = props.view?.effective;
  const parts = audio.filter((file) => file.path.startsWith("assets/audio/") && file.path !== "assets/audio/narration.wav");
  const selection = useSelection(parts.map((file) => file.path));
  const sections = script.data?.sections ?? [];
  const fileOf = (part: Part) => `assets/audio/${safeName(part.id)}.wav`;

  // What each missing section needs: dialogue is read, the rest is made by SongYUE2.
  const items = settings ? sections.flatMap((part) => {
    const text = part.text?.trim();
    if (!text || audio.some((file) => file.path === fileOf(part))) return [];
    const kind = audioKindOf(kinds.data, part.id);
    const seconds = (part.end_seconds ?? 0) - (part.start_seconds ?? 0);
    const recipe: Recipe =
      kind === "dialogue" ? { kind: "voice", prompt: text, source: part.id }
      : kind === "sfx" ? { kind: "sfx", prompt: text, duration: seconds > 0 ? Math.round(seconds * 2) / 2 : 5, source: part.id }
      : kind === "instrumental" ? { kind: "instrumental", prompt: text, source: part.id }
      : { kind: "vocal", prompt: part.speaker_directions?.trim() || "pop vocal song", lyrics: text, source: part.id };
    const item = makeItem(settings, recipe, fileOf(part));
    return typeof item === "string" ? [] : [item];
  }) : [];

  async function join() {
    setJoining(true);
    try {
      const startOf = (path: string) => sections.find((part) => fileOf(part) === path)?.start_seconds ?? 0;
      await mixMedia(props.project.id, selection.picked.map((path) => ({ path, start: startOf(path) })));
      props.notify("대본 시간에 맞춰 오디오를 합쳤습니다. (narration.wav)");
      props.onJobsChanged();
    } catch (e) {
      props.notify(message(e, "합치지 못했습니다."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="section">
      <Header
        props={props}
        title="오디오"
        count={audio.length}
        creating={creating}
        onCreating={setCreating}
        all={{ items, note: "대본의 구간 중 아직 소리가 없는 구간을 종류에 맞게 차례로 모두 만듭니다. 대화는 TTS, 효과음·연주곡·보컬은 SongYUE2가 만들어요." }}
        join={{ count: selection.picked.length, busy: joining, label: "체크한 소리를 대본의 시작 시간에 맞춰 겹쳐서 narration.wav를 만듭니다.", name: "시간에 맞춰 합치기", onJoin: () => void join() }}
      />
      <Top props={props} kinds={["voice", "sfx", "instrumental", "vocal"]} outputs={["assets/audio/", "assets/music/"]} creating={creating} />
      {audio.length === 0 ? (
        <p className="muted">아직 오디오가 없습니다. 대본에서 구간마다 소리 종류를 고른 뒤 "전체 만들기"를 눌러 보세요.</p>
      ) : (
        <div className="audio-list">
          {audio.map((file) => {
            const joinable = parts.includes(file);
            const section = sections.find((part) => fileOf(part) === file.path);
            return (
              <div key={file.path} className="audio-row media-item">
                {joinable && <input type="checkbox" aria-label="합칠 파일" checked={selection.isOn(file.path)} onChange={() => selection.toggle(file.path)} />}
                <span className="audio-name" title={file.path}>
                  {file.path.replace(/^assets\//, "")} <span className="muted">· {sizeLabel(file.size)}{section && ` · ${section.start_seconds ?? 0}초부터`}</span>
                </span>
                <audio controls preload="metadata" src={mediaUrl(props.project.id, file.path, file.mtimeMs)} />
                <ItemTools props={props} file={file} kind={file.path.startsWith("assets/audio/") ? "voice" : null} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The project's videos: clips made from consecutive image pairs, joined into the finished video. */
export function VideosSection(props: SectionProps) {
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const plan = useJsonFile<{ scenes?: Scene[] }>(props.project.id, "artifacts/scene_plan.json", props.notify);
  const videos = props.detail?.media.videos ?? [];
  const images = props.detail?.media.images ?? [];
  const settings = props.view?.effective;
  const clips = videos.filter((file) => file.path.startsWith("assets/video/"));
  const selection = useSelection(clips.map((file) => file.path));

  // Clip n joins image n and image n+1: 1-2, 2-3, 3-4, ...
  const items: MakeItem[] = [];
  if (settings) {
    for (let i = 0; i + 1 < images.length; i += 1) {
      const [a, b] = [images[i], images[i + 1]];
      const output = `assets/video/clip-${safeName(baseName(a.path))}-${safeName(baseName(b.path))}.mp4`;
      if (videos.some((file) => file.path === output)) continue;
      const scene = plan.data?.scenes?.find((item) => safeName(item.id) === baseName(a.path));
      const seconds = scene?.start_seconds != null && scene.end_seconds != null ? scene.end_seconds - scene.start_seconds : 5;
      const prompt = scene?.description?.trim() || "부드러운 카메라 이동으로 다음 장면으로 이어진다.";
      const item = makeItem(settings, { kind: "fl2v", prompt, first: a.path, last: b.path, duration: Math.min(15, Math.max(2, Math.round(seconds * 2) / 2)), source: scene?.id }, output);
      if (typeof item !== "string") items.push(item);
    }
  }

  async function join() {
    setJoining(true);
    try {
      await joinMedia(props.project.id, "video", selection.picked);
      props.notify("영상을 이어 붙였습니다. (renders/final.mp4)");
      props.onJobsChanged();
    } catch (e) {
      props.notify(message(e, "이어 붙이지 못했습니다."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="section">
      <Header
        props={props}
        title="동영상"
        count={videos.length}
        creating={creating}
        onCreating={setCreating}
        all={{ items, note: "이미지를 1-2, 2-3, 3-4 ... 두 장씩 짝지어 아직 없는 구간의 영상을 차례로 만듭니다. 한 구간에 약 1분 걸립니다." }}
        join={{ count: selection.picked.length, busy: joining, label: "체크한 구간 영상을 순서대로 이어 붙여 renders/final.mp4를 만듭니다.", onJoin: () => void join() }}
      />
      <Top props={props} kinds={["i2v", "fl2v", "s2v"]} outputs={["assets/video/"]} creating={creating} />
      {videos.length === 0 ? (
        <p className="muted">아직 동영상이 없습니다. 이미지가 2장 이상이면 "전체 만들기"로 구간 영상을 만들 수 있어요.</p>
      ) : (
        <div className="videos">
          {videos.map((file) => (
            <div key={file.path} className="media-item">
              <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
                {clips.includes(file) && <input type="checkbox" aria-label="이어 붙일 파일" checked={selection.isOn(file.path)} onChange={() => selection.toggle(file.path)} style={{ marginRight: 8 }} />}
                {file.path} · {sizeLabel(file.size)}
              </div>
              <video controls preload="metadata" src={mediaUrl(props.project.id, file.path, file.mtimeMs)} />
              <ItemTools props={props} file={file} kind={null} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
