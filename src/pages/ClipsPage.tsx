import { FolderOpen, Images, RefreshCw, Sparkles, Star, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, mediaUrl, type MediaFile, type ProjectSettingsView, type ProjectSummary } from "../api";
import { ascending } from "../sortOptions";
import FileNavigator from "../components/FileNavigator";
import VideoLibraryDialog from "../components/VideoLibraryDialog";
import ImageSlot from "../components/ImageSlot";
import JobList from "../components/JobList";
import { useFavorites, type SortOrder } from "../components/LibraryBrowser";
import PromptLog from "../components/PromptLog";
import ClipSize, { useClipSize } from "../components/ClipSize";
import VideoMethodPicker from "../components/VideoMethodPicker";
import type { VideoMethod } from "../sections/mediaJobs";
import { clearHandoff, peekHandoff } from "../handoff";
import { deleteMedia, importVideo, makeItem, makePrompt, recipeOf, startItems, stamp } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";

/** Short clips are kept in the hidden project of the image library, so the pictures of the library are the inputs. */
const LIBRARY = "_images";

export type ClipKind = "t2v" | "fl2v" | "animate" | "swap";

const TITLES: Record<ClipKind, { title: string; sub: string }> = {
  t2v: { title: "글로 만들기 (T2V)", sub: "그림 없이 간단한 설명만으로 짧은 영상을 만듭니다 (MiniMax H3 T2V). 시나리오는 쓰지 않습니다." },
  fl2v: { title: "첫·끝 프레임 영상 (FL2V)", sub: "첫 이미지와 마지막 이미지, 짧은 설명만으로 영상을 만듭니다 (MiniMax H3 FL2V)." },
  animate: { title: "동작 따라하기 (Wan Animate)", sub: "그림 속 인물이 참고 영상의 동작을 그대로 따라 합니다 (Wan Animate 2)." },
  swap: { title: "얼굴 바꾸기", sub: "영상 속 인물의 얼굴만 고른 얼굴 그림으로 바꿉니다 (MiniMax H3 R2V)." },
};

/** The short-clip menu: one small maker per kind, the clips made so far below. */
export default function ClipsPage({ kind, jobTick, notify }: { kind: ClipKind; jobTick: number; notify: (text: string) => void }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [view, setView] = useState<ProjectSettingsView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ project: ProjectSummary }>("POST", "/api/images/ensure", {})
      .then(async (made) => {
        const settings = await api<ProjectSettingsView>("GET", `/api/projects/${LIBRARY}/settings`);
        if (alive) {
          setProject(made.project);
          setView(settings);
        }
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "보관함을 열지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="error" style={{ padding: 24 }}>{error}</p>;
  if (!project) return <p className="muted" style={{ padding: 24 }}>보관함을 여는 중입니다...</p>;
  return <Clips kind={kind} project={project} view={view} jobTick={jobTick} notify={notify} />;
}

function Clips({ kind, project, view, jobTick, notify }: { kind: ClipKind; project: ProjectSummary; view: ProjectSettingsView | null; jobTick: number; notify: (text: string) => void }) {
  const { detail, reload } = useProjectDetail(project.id, jobTick);
  const jobs = useJobs(jobTick);
  const favorites = useFavorites(project.id);
  const [order, setOrder] = useState<SortOrder>("time");
  const images = detail?.media.images ?? [];
  const sources = (detail?.media.videos ?? []).filter((file) => file.path.includes("/source-"));
  const clips = (detail?.media.videos ?? []).filter((file) => !file.path.includes("/source-")).sort((a, b) => b.mtimeMs - a.mtimeMs);

  const props: SectionProps = {
    project,
    detail,
    view,
    jobs: { current: jobs.current, history: jobs.history, pending: jobs.pending, paused: jobs.paused },
    onJobsChanged: () => {
      void jobs.reload();
      void reload();
    },
    onChanged: () => undefined,
    notify,
  };
  const { title, sub } = TITLES[kind];

  /** The same recipe again as a new clip (a motion-copy clip has no recipe of the picture form and is made again in its form). */
  async function again(file: MediaFile) {
    const recipe = recipeOf(file.record);
    if (!recipe || !view) return;
    if (recipe.kind === "fl2v" && recipe.refVideo) return notify("동작 따라하기 영상은 그 화면에서 다시 만드세요.");
    const item = makeItem(view.effective, recipe, `assets/video/clip-${stamp()}.mp4`);
    if (typeof item === "string") return notify(item);
    try {
      await startItems(project.id, [item]);
      notify("다시 만들기를 시작했습니다.");
      props.onJobsChanged();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    }
  }

  return (
    <div className="page">
      <div className="section">
        <h2>{title}</h2>
        <span className="hint">{sub}</span>
        <div style={{ marginTop: 14 }}>
          {kind === "t2v" && <Text2Video props={props} />}
          {kind === "fl2v" && <First2Last props={props} images={images} favorites={favorites} order={order} onOrder={setOrder} />}
          {kind === "swap" && <FaceSwap props={props} images={images} sources={sources} favorites={favorites} order={order} onOrder={setOrder} />}
          {kind === "animate" && <Animate props={props} images={images} sources={sources} favorites={favorites} order={order} onOrder={setOrder} />}
        </div>
        <JobList projectId={project.id} jobs={jobs.history} outputs={["assets/video/"]} pending={jobs.pending} paused={jobs.paused} onChanged={props.onJobsChanged} />
        <h3 style={{ margin: "14px 0 8px" }}>
          만든 영상 <span className="count">{clips.length}</span>
        </h3>
        {clips.length === 0 ? (
          <p className="muted">아직 만든 영상이 없습니다.</p>
        ) : (
          <div className="pl-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {clips.map((file) => (
              <div key={file.path} className="pl-card">
                <video src={mediaUrl(project.id, file.path, file.mtimeMs)} controls preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000" }} />
                <div className="pl-tools left">
                  <button type="button" className={favorites.has(file.path) ? "on" : undefined} title={favorites.has(file.path) ? "즐겨찾기 빼기" : "즐겨찾기"} aria-label={favorites.has(file.path) ? "즐겨찾기 빼기" : "즐겨찾기"} aria-pressed={favorites.has(file.path)} onClick={() => favorites.toggle(file.path)}>
                    <Star size={14} fill={favorites.has(file.path) ? "currentColor" : "none"} />
                  </button>
                </div>
                <div className="pl-tools">
                  <button type="button" disabled={!recipeOf(file.record)} title={recipeOf(file.record) ? "같은 설정으로 새 영상을 만듭니다 (새 영상이 추가됩니다)." : "만든 기록이 없어 다시 만들 수 없습니다."} aria-label="다시 만들기" onClick={() => again(file)}>
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    title="삭제"
                    aria-label="삭제"
                    onClick={() => {
                      if (window.confirm("이 영상을 지울까요?")) deleteMedia(project.id, file.path).then(() => reload()).catch((e) => notify(e instanceof ApiError ? e.message : "지우지 못했습니다."));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <span className="muted" style={{ display: "block", marginTop: 6, fontSize: 12 }}>{new Date(file.mtimeMs).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MakerProps {
  props: SectionProps;
  images: MediaFile[];
  favorites: ReturnType<typeof useFavorites>;
  order: SortOrder;
  onOrder: (order: SortOrder) => void;
}

/** The common part: duration, error line, make button. */
function Footer({ error, running, busy, label, onMake, children }: { error: string; running: boolean; busy: boolean; label: string; onMake: () => void; children?: ReactNode }) {
  return (
    <>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row" style={{ marginTop: 14, gap: 10 }}>
        {children}
        <button className="btn primary" type="button" disabled={busy || running} onClick={onMake} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : label}
        </button>
      </div>
    </>
  );
}

/** Text to video: a short idea (or a full prompt sent from the prompt library) in, a clip out. */
function Text2Video({ props }: { props: SectionProps }) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [sent] = useState(() => peekHandoff("clip"));
  useEffect(clearHandoff, []);
  const [prompt, setPrompt] = useState(sent?.prompt ?? "");
  const [duration, setDuration] = useState("5");
  const [method, setMethod] = useState<VideoMethod>({});
  const clipSize = useClipSize(view?.effective);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setError("");
    if (!prompt.trim()) return setError("만들고 싶은 장면을 간단히 적은 뒤 눌러 주세요.");
    setDrafting(true);
    try {
      setPrompt(await makePrompt(project.id, { target: "video", mode: "t2v", text: prompt, duration: Number(duration) }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  async function make() {
    setError("");
    if (!view) return setError("설정을 불러오는 중입니다.");
    const item = makeItem(clipSize.apply(view.effective), { kind: "t2v", prompt, duration: Number(duration), video: method }, `assets/video/clip-${stamp()}.mp4`);
    if (typeof item === "string") return setError(item);
    setBusy(true);
    try {
      await startItems(project.id, [item]);
      notify("영상 만들기를 시작했습니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      <div className="fields">
        <div className="field wide">
          <label htmlFor="t2v-prompt">1. 설명 또는 프롬프트</label>
          <textarea id="t2v-prompt" rows={6} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 비 오는 밤거리에서 우산을 든 소녀가 천천히 걸어온다" />
          <div>
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 MiniMax H3 형식의 프롬프트로 바꿔 줍니다. 이미 완성된 프롬프트는 바꾸지 말고 바로 만드세요.">
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["prompt-video"]} refreshKey={drafting ? 1 : 0} />
        </div>
        <ClipSize size={clipSize.size} onChange={clipSize.setSize}>
          <div className="field">
            <label htmlFor="t2v-seconds">길이(초)</label>
            <input id="t2v-seconds" type="number" min={2} max={15} step={1} value={duration} onChange={(event) => setDuration(event.target.value)} />
          </div>
        </ClipSize>
      </div>
      <VideoMethodPicker value={method} fallback={view?.effective.video.tiled ?? false} onChange={setMethod} />
      <Footer error={error} running={jobs.current !== null} busy={busy} label="영상 만들기" onMake={() => void make()} />
    </section>
  );
}

function First2Last({ props, images, favorites, order, onOrder }: MakerProps) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [first, setFirst] = useState<string[]>([]);
  const [last, setLast] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("5");
  const [method, setMethod] = useState<VideoMethod>({});
  const clipSize = useClipSize(view?.effective);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setError("");
    if (!first[0] || !last[0]) return setError("첫 이미지와 마지막 이미지를 먼저 고르세요.");
    if (!prompt.trim()) return setError("만들고 싶은 장면을 간단히 적은 뒤 눌러 주세요.");
    setDrafting(true);
    try {
      setPrompt(await makePrompt(project.id, { target: "video", mode: "fl2v", text: prompt, duration: Number(duration), first: first[0], last: last[0] }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  async function make() {
    setError("");
    if (!view) return setError("설정을 불러오는 중입니다.");
    const item = makeItem(clipSize.apply(view.effective), { kind: "fl2v", prompt, first: first[0], last: last[0], duration: Number(duration), video: method }, `assets/video/clip-${stamp()}.mp4`);
    if (typeof item === "string") return setError(item);
    setBusy(true);
    try {
      await startItems(project.id, [item]);
      notify("영상 만들기를 시작했습니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="1. 첫 이미지" value={first} max={1} onChange={setFirst} />
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="2. 마지막 이미지" value={last} max={1} onChange={setLast} />
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="clip-prompt">3. 간단한 설명</label>
          <textarea id="clip-prompt" rows={4} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 소녀가 천천히 뒤돌아 웃는다" />
          <div>
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 MiniMax H3 형식의 프롬프트로 바꿔 줍니다.">
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["prompt-video"]} refreshKey={drafting ? 1 : 0} />
        </div>
        <ClipSize size={clipSize.size} onChange={clipSize.setSize}>
          <div className="field">
            <label htmlFor="clip-seconds">길이(초)</label>
            <input id="clip-seconds" type="number" min={2} max={15} step={1} value={duration} onChange={(event) => setDuration(event.target.value)} />
          </div>
        </ClipSize>
      </div>
      <VideoMethodPicker value={method} fallback={view?.effective.video.tiled ?? false} onChange={setMethod} />
      <Footer error={error} running={jobs.current !== null} busy={busy} label="영상 만들기" onMake={() => void make()} />
    </section>
  );
}

const formatBytes = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The picked video with its basic facts (name, size in pixels, length, file size) on its right. */
function VideoInfo({ projectId, path, size }: { projectId: string; path: string; size?: number }) {
  const [meta, setMeta] = useState<{ width: number; height: number; seconds: number } | null>(null);
  const [bytes, setBytes] = useState<number | undefined>(size);
  useEffect(() => {
    setMeta(null);
    setBytes(size);
    if (size !== undefined) return;
    // A file that is not in the list yet: ask the server how big it is.
    fetch(mediaUrl(projectId, path), { method: "HEAD" })
      .then((response) => setBytes(Number(response.headers.get("content-length")) || undefined))
      .catch(() => undefined);
  }, [projectId, path, size]);
  const rows: [string, string][] = [
    ["파일 이름", path.split("/").pop() ?? path],
    ["영상 크기", meta ? `${meta.width}×${meta.height}` : "확인 중..."],
    ["길이", meta ? `${meta.seconds.toFixed(1)}초` : "확인 중..."],
    ["파일 크기", bytes !== undefined ? formatBytes(bytes) : "확인 중..."],
  ];
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginTop: 8 }}>
      <video
        src={mediaUrl(projectId, path)}
        controls
        preload="metadata"
        style={{ maxWidth: 360, borderRadius: 8, background: "#000" }}
        onLoadedMetadata={(event) => setMeta({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight, seconds: event.currentTarget.duration })}
      />
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 13 }}>
        {rows.map(([name, text]) => (
          <div key={name} style={{ display: "contents" }}>
            <dt className="muted">{name}</dt>
            <dd style={{ margin: 0, wordBreak: "break-all" }}>{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A source clip: one of the videos taken into the library, or a new one from a file on this PC. */
export function VideoSlot({ props, sources, value, onChange, label = "1. 바꿀 영상" }: { props: SectionProps; sources: MediaFile[]; value: string; onChange: (path: string) => void; label?: string }) {
  const { project, notify, onJobsChanged } = props;
  const [files, setFiles] = useState(false);
  const [library, setLibrary] = useState(false);
  return (
    <div className="field wide" style={{ marginTop: 14 }}>
      <label>{label}</label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => setFiles(true)}>
          <FolderOpen size={15} /> 파일에서 가져오기
        </button>
        <button className="btn" type="button" onClick={() => setLibrary(true)}>
          <Images size={15} /> Lib에서 가져오기
        </button>
      </div>
      {value && <VideoInfo projectId={project.id} path={value} size={sources.find((file) => file.path === value)?.size} />}
      {library && (
        <VideoLibraryDialog
          ownId={project.id}
          own={sources}
          onClose={() => setLibrary(false)}
          onPick={(path) => {
            setLibrary(false);
            onChange(path);
            onJobsChanged();
          }}
        />
      )}
      {files && (
        <FileNavigator
          title="영상 가져오기"
          accept={[".mp4", ".mov", ".webm", ".mkv"]}
          projectId={project.id}
          onClose={() => setFiles(false)}
          onPick={(from) => {
            setFiles(false);
            importVideo(project.id, from)
              .then((path) => {
                onChange(path);
                onJobsChanged();
                notify("영상을 가져왔습니다.");
              })
              .catch((e) => notify(e instanceof ApiError ? e.message : "영상을 가져오지 못했습니다."));
          }}
        />
      )}
    </div>
  );
}

/** What the R2V prompt maker is told: the face changes, everything else of the source clip stays. */
const SWAP_IDEA = "Replace the face of the person in <Video 1> with the face of <Picture 1>. Keep the body, outfit, hair, motion, camera, background, lighting and sound of <Video 1> exactly as they are; only the face identity changes.";

function FaceSwap({ props, images, sources, favorites, order, onOrder }: MakerProps & { sources: MediaFile[] }) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [video, setVideo] = useState("");
  const [face, setFace] = useState<string[]>([]);
  const [extra, setExtra] = useState("");
  const [method, setMethod] = useState<VideoMethod>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function make() {
    setError("");
    if (!view) return setError("설정을 불러오는 중입니다.");
    if (!video) return setError("바꿀 영상을 고르세요.");
    if (!face[0]) return setError("얼굴 그림을 고르세요.");
    setBusy(true);
    try {
      const idea = `${SWAP_IDEA}${extra.trim() ? ` ${extra.trim()}` : ""}`;
      const prompt = await makePrompt(project.id, { target: "video", mode: "r2v", text: idea, refPaths: face, refVideo: video });
      // No length of its own: the clip is as long as the source video and has its shape.
      const item = makeItem(view.effective, { kind: "r2v", prompt, idea, refs: face, refVideo: video, video: method },`assets/video/clip-${stamp()}.mp4`);
      if (typeof item === "string") return setError(item);
      await startItems(project.id, [item]);
      notify("얼굴 바꾸기를 시작했습니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      <VideoSlot props={props} sources={sources} value={video} onChange={setVideo} />
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="2. 얼굴 그림 (이 얼굴로 바뀝니다)" value={face} max={1} onChange={setFace} />
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="swap-extra">3. 덧붙일 말 (선택)</label>
          <textarea id="swap-extra" rows={2} value={extra} maxLength={1000} onChange={(event) => setExtra(event.target.value)} placeholder="예: 안경은 그대로 둔다" />
          <span className="hint">비워 두면 "얼굴만 바꾸고 나머지는 그대로 둔다"로 프롬프트를 만듭니다.</span>
        </div>
      </div>
      <VideoMethodPicker value={method} fallback={view?.effective.video.tiled ?? false} onChange={setMethod} />
      <span className="hint" style={{ display: "block", marginTop: 8 }}>결과 영상은 원본 영상과 같은 길이(최대 15초)와 같은 화면 비율입니다.</span>
      <Footer error={error} running={jobs.current !== null} busy={busy} label="얼굴 바꾸기" onMake={() => void make()} />
    </section>
  );
}

/** Wan Animate 2: the person of a picture moves like the person of a source clip. */
function Animate({ props, images, sources, favorites, order, onOrder }: MakerProps & { sources: MediaFile[] }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const [video, setVideo] = useState("");
  const [image, setImage] = useState<string[]>([]);
  const [appearance, setAppearance] = useState("");
  const [motion, setMotion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function make() {
    setError("");
    if (!video) return setError("동작을 따라 할 영상을 고르세요.");
    if (!image[0]) return setError("움직일 인물 그림을 고르세요.");
    const output = `assets/video/clip-${stamp()}.mp4`;
    setBusy(true);
    try {
      await startItems(project.id, [
        {
          tool: "wan_animate",
          label: motion.trim() || "동작 따라하기",
          record: { kind: "fl2v", prompt: motion.trim() || "동작 따라하기", first: image[0], refVideo: video } as never,
          inputs: { reference_image_path: image[0], video_path: video, appearance, motion, output_path: output },
        },
      ]);
      notify("동작 따라하기를 시작했습니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      <VideoSlot props={props} sources={sources} value={video} onChange={setVideo} label="1. 동작을 따라 할 영상" />
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="2. 움직일 인물 그림" value={image} max={1} onChange={setImage} />
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="an-appearance">3. 그림 설명 (선택, 영어 권장)</label>
          <textarea id="an-appearance" rows={3} value={appearance} maxLength={2000} onChange={(event) => setAppearance(event.target.value)} placeholder="예: A young woman with long black hair in a red coat, standing in a snowy street, soft daylight." />
          <span className="hint">인물의 생김새, 옷, 배경, 빛을 적습니다. 동작은 적지 않습니다. 비워 두면 Ollama(로컬 비전 모델)가 그림을 보고 설명을 만들어 넣습니다.</span>
        </div>
        <div className="field wide">
          <label htmlFor="an-motion">4. 동작 설명 (선택, 영어 권장)</label>
          <textarea id="an-motion" rows={3} value={motion} maxLength={2000} onChange={(event) => setMotion(event.target.value)} placeholder="예: She faces the camera, raises her right hand, waves, then turns to the left." />
          <span className="hint">영상에서 실제로 일어나는 동작의 순서를 적습니다. 인물의 생김새는 적지 않습니다.</span>
        </div>
      </div>
      <Footer error={error} running={jobs.current !== null} busy={busy} label="동작 따라하기" onMake={() => void make()} />
      <span className="hint" style={{ display: "block", marginTop: 8 }}>결과 영상은 참고 영상과 같은 길이와 소리, 같은 화면 비율(그림 기준)입니다. 크기는 참고 영상의 크기를 따릅니다(0.2~1.5백만 화소). 큰 영상과 긴 영상은 시간이 오래 걸리고 12GB에서는 메모리가 모자랄 수 있습니다.</span>
    </section>
  );
}
