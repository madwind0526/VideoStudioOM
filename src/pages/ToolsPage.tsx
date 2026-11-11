import { Download, Pause, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, mediaUrl, type MediaFile, type ProjectSettingsView, type ProjectSummary } from "../api";
import { ascending } from "../sortOptions";
import ImageSlot from "../components/ImageSlot";
import JobList from "../components/JobList";
import { useFavorites, type Favorites, type SortOrder } from "../components/LibraryBrowser";
import { startItems, stamp } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";
import { VideoSlot } from "./ClipsPage";

export type ToolKind = "image-convert" | "video-convert" | "image-compare" | "video-compare";

const TITLES: Record<ToolKind, { title: string; sub: string }> = {
  "image-convert": { title: "이미지 type 변경", sub: "그림 파일의 형식을 바꿉니다 (PNG, JPG, WebP)." },
  "video-convert": { title: "동영상 type 변경", sub: "영상 파일의 형식을 바꿉니다 (MP4, WebM, MOV)." },
  "image-compare": { title: "이미지 비교", sub: "그림 두 장을 나란히 놓거나, 절반씩 맞붙여서 비교합니다." },
  "video-compare": { title: "동영상 비교", sub: "영상 두 편을 같이 재생하며 나란히, 또는 절반씩 맞붙여서 비교합니다." },
};

/** Tools work on the files of the image library (the hidden project), where PC files are taken in first. */
const LIBRARY = "_images";

export default function ToolsPage({ tool, jobTick, notify }: { tool: ToolKind; jobTick: number; notify: (text: string) => void }) {
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
  return <Tool tool={tool} project={project} view={view} jobTick={jobTick} notify={notify} />;
}

function Tool({ tool, project, view, jobTick, notify }: { tool: ToolKind; project: ProjectSummary; view: ProjectSettingsView | null; jobTick: number; notify: (text: string) => void }) {
  const { detail, reload } = useProjectDetail(project.id, jobTick);
  const jobs = useJobs(jobTick);
  const favorites = useFavorites(project.id);
  const [order, setOrder] = useState<SortOrder>("time");
  const images = detail?.media.images ?? [];
  const videos = detail?.media.videos ?? [];
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
  const { title, sub } = TITLES[tool];
  return (
    <div className="page">
      <div className="section">
        <h2>{title}</h2>
        <span className="hint">{sub}</span>
        <div style={{ marginTop: 14 }}>
          {tool === "image-convert" && <Convert kind="image" props={props} files={images} images={images} favorites={favorites} order={order} onOrder={setOrder} />}
          {tool === "video-convert" && <Convert kind="video" props={props} files={videos} images={images} favorites={favorites} order={order} onOrder={setOrder} />}
          {tool === "image-compare" && <ImageCompare props={props} images={images} favorites={favorites} order={order} onOrder={setOrder} />}
          {tool === "video-compare" && <VideoCompare props={props} videos={videos} />}
        </div>
        {(tool === "image-convert" || tool === "video-convert") && (
          <JobList projectId={project.id} jobs={jobs.history} outputs={["assets/images/", "assets/video/"]} pending={jobs.pending} paused={jobs.paused} onChanged={props.onJobsChanged} />
        )}
      </div>
    </div>
  );
}

interface CommonProps {
  props: SectionProps;
  images: MediaFile[];
  favorites: Favorites;
  order: SortOrder;
  onOrder: (order: SortOrder) => void;
}

const FORMATS = { image: ["png", "jpg", "webp"], video: ["mp4", "webm", "mov"] } as const;

/** One file in, the same file in another type out (saved next to the others in the library, with a download link). */
function Convert({ kind, props, files, images, favorites, order, onOrder }: CommonProps & { kind: "image" | "video"; files: MediaFile[] }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const formats = FORMATS[kind];
  const [source, setSource] = useState<string[]>([]);
  const [format, setFormat] = useState<string>(formats[0]);
  const [quality, setQuality] = useState("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const converted = files.filter((file) => file.path.includes("/conv-")).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const lossless = kind === "image" && format === "png";

  async function make() {
    setError("");
    if (!source[0]) return setError(kind === "image" ? "그림을 고르세요." : "영상을 고르세요.");
    const number = Number(quality);
    if (!(number >= 1 && number <= 100)) return setError("품질은 1~100 사이로 입력하세요.");
    const output = `assets/${kind === "image" ? "images" : "video"}/conv-${stamp()}.${format}`;
    setBusy(true);
    try {
      await startItems(project.id, [{ tool: "media_convert", label: `${kind === "image" ? "그림" : "영상"} ${format.toUpperCase()} 변환`, record: { kind, prompt: `${format} 변환` } as never, inputs: { kind, format, quality: number, input_path: source[0], output_path: output } }]);
      notify("변환을 시작했습니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      {kind === "image" ? (
        <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="1. 바꿀 그림" value={source} max={1} onChange={setSource} />
      ) : (
        <VideoSlot props={props} sources={files.filter((file) => !file.path.includes("/conv-"))} value={source[0] ?? ""} onChange={(path) => setSource(path ? [path] : [])} label="1. 바꿀 영상" />
      )}
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field">
          <label htmlFor="conv-format">2. 바꿀 형식</label>
          <select id="conv-format" value={format} onChange={(event) => setFormat(event.target.value)}>
            {ascending(formats, (item) => item).map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="conv-quality">품질 (1~100)</label>
          <input id="conv-quality" type="number" min={1} max={100} step={1} value={quality} disabled={lossless} onChange={(event) => setQuality(event.target.value)} />
          {lossless && <span className="hint">이 형식은 품질 설정이 없습니다.</span>}
        </div>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || jobs.current !== null} onClick={() => void make()} title={jobs.current ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {jobs.current ? "다른 작업 진행 중" : "변환하기"}
        </button>
      </div>
      <h3 style={{ margin: "18px 0 8px" }}>
        변환한 파일 <span className="count">{converted.length}</span>
      </h3>
      {converted.length === 0 ? (
        <p className="muted">아직 변환한 파일이 없습니다.</p>
      ) : (
        <div className="pl-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {converted.map((file) => (
            <div key={file.path} className="pl-card">
              {kind === "image" ? <img src={mediaUrl(project.id, file.path, file.mtimeMs)} alt="" style={{ width: "100%", borderRadius: 8 }} /> : <video src={mediaUrl(project.id, file.path, file.mtimeMs)} controls preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000" }} />}
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {file.path.split(".").pop()?.toUpperCase()} · {file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(file.size / 1024))}KB`}
                </span>
                <a className="btn" href={mediaUrl(project.id, file.path, file.mtimeMs)} download={file.path.split("/").pop()} title="내려받기">
                  <Download size={15} /> 내려받기
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Mode = "side" | "split";

/** The two ways of looking at a pair: both whole next to each other, or one half of each joined at a movable line. */
function ModeButtons({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="row" style={{ gap: 8, margin: "14px 0" }} role="group" aria-label="비교 방식">
      <button className={`btn${mode === "side" ? " primary" : ""}`} type="button" aria-pressed={mode === "side"} onClick={() => onChange("side")} title="둘을 나란히 놓고 전체를 비교합니다.">
        나란히 (전체 비교)
      </button>
      <button className={`btn${mode === "split" ? " primary" : ""}`} type="button" aria-pressed={mode === "split"} onClick={() => onChange("split")} title="하나의 절반과 다른 하나의 절반을 한 화면에 이어 붙여 비교합니다.">
        반반 (절반씩 비교)
      </button>
    </div>
  );
}

/** Two stacked pictures of the same box; the second one shows only right of `at` percent, with a line between them. */
function Split({ at, onAt, children }: { at: number; onAt: (value: number) => void; children: [React.ReactNode, React.ReactNode] }) {
  return (
    <div>
      <div style={{ position: "relative", display: "grid", maxWidth: 1100, background: "#000", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ gridArea: "1 / 1" }}>{children[0]}</div>
        <div style={{ gridArea: "1 / 1", clipPath: `inset(0 0 0 ${at}%)` }}>{children[1]}</div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${at}%`, width: 1, background: "rgba(255,255,255,0.9)", boxShadow: "0 0 1px rgba(0,0,0,0.6)", pointerEvents: "none" }} />
        <span style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12 }}>A</span>
        <span style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12 }}>B</span>
      </div>
      <input type="range" min={0} max={100} value={at} aria-label="나누는 위치" onChange={(event) => onAt(Number(event.target.value))} style={{ width: "100%", maxWidth: 1100, marginTop: 8 }} />
      <span className="hint">선 위치를 끌면 A와 B가 나뉘는 곳이 움직입니다 (가운데: 절반씩).</span>
    </div>
  );
}

function ImageCompare({ props, images, favorites, order, onOrder }: CommonProps) {
  const { project } = props;
  const [a, setA] = useState<string[]>([]);
  const [b, setB] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("side");
  const [at, setAt] = useState(50);
  const url = (path: string) => mediaUrl(project.id, path, images.find((file) => file.path === path)?.mtimeMs);
  const img = (path: string) => <img src={url(path)} alt="" style={{ display: "block", width: "100%", height: "auto" }} />;
  const ready = a[0] && b[0];
  return (
    <section className="gen-card">
      <div className="fields">
        <div className="field wide">
          <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="A 그림" value={a} max={1} onChange={setA} />
        </div>
        <div className="field wide">
          <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="B 그림" value={b} max={1} onChange={setB} />
        </div>
      </div>
      <ModeButtons mode={mode} onChange={setMode} />
      {!ready ? (
        <p className="muted">비교할 그림 두 장을 고르세요.</p>
      ) : mode === "side" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[a[0], b[0]].map((path, index) => (
            <figure key={index} style={{ margin: 0 }}>
              <figcaption className="muted" style={{ marginBottom: 4 }}>{index === 0 ? "A" : "B"}</figcaption>
              {img(path)}
            </figure>
          ))}
        </div>
      ) : (
        // Both pictures are shown at the size of A so a line through them compares the same place.
        <Split at={at} onAt={setAt}>
          {[img(a[0]), <img key="b" src={url(b[0])} alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />]}
        </Split>
      )}
    </section>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function VideoCompare({ props, videos }: { props: SectionProps; videos: MediaFile[] }) {
  const { project } = props;
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [mode, setMode] = useState<Mode>("side");
  const [at, setAt] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const refs = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const url = (path: string) => mediaUrl(project.id, path, videos.find((file) => file.path === path)?.mtimeMs);
  const all = () => refs.current.filter((video): video is HTMLVideoElement => Boolean(video));

  // The two videos start and stop together; A leads, B is pulled to its time.
  const toggle = () => {
    if (all().every((video) => video.paused)) {
      all().forEach((video) => void video.play());
      setPlaying(true);
    } else {
      all().forEach((video) => video.pause());
      setPlaying(false);
    }
  };
  const seek = (seconds: number) => {
    all().forEach((video) => (video.currentTime = seconds));
    setTime(seconds);
  };
  useEffect(() => {
    setPlaying(false);
    setTime(0);
  }, [a, b, mode]);

  const video = (path: string, index: number, fill: boolean) => (
    <video
      key={`${path}-${mode}`}
      ref={(element) => {
        refs.current[index] = element;
      }}
      src={url(path)}
      muted={index === 1}
      playsInline
      preload="auto"
      style={{ display: "block", width: "100%", height: fill ? "100%" : "auto", objectFit: fill ? "cover" : "contain", background: "#000" }}
      onLoadedMetadata={(event) => index === 0 && setLength(event.currentTarget.duration)}
      onTimeUpdate={(event) => {
        if (index !== 0) return;
        setTime(event.currentTarget.currentTime);
        const other = refs.current[1];
        // B follows A when it drifts by more than a tenth of a second.
        if (other && Math.abs(other.currentTime - event.currentTarget.currentTime) > 0.1) other.currentTime = event.currentTarget.currentTime;
      }}
      onEnded={() => setPlaying(false)}
    />
  );
  const ready = a && b;
  return (
    <section className="gen-card">
      <VideoSlot props={props} sources={videos} value={a} onChange={setA} label="A 영상" />
      <VideoSlot props={props} sources={videos} value={b} onChange={setB} label="B 영상" />
      <ModeButtons mode={mode} onChange={setMode} />
      {!ready ? (
        <p className="muted">비교할 영상 두 편을 고르세요.</p>
      ) : (
        <>
          {mode === "side" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[a, b].map((path, index) => (
                <figure key={index} style={{ margin: 0 }}>
                  <figcaption className="muted" style={{ marginBottom: 4 }}>{index === 0 ? "A" : "B"} (소리는 A만 나옵니다)</figcaption>
                  {video(path, index, false)}
                </figure>
              ))}
            </div>
          ) : (
            <Split at={at} onAt={setAt}>
              {[video(a, 0, false), video(b, 1, true)]}
            </Split>
          )}
          <div className="row" style={{ gap: 10, marginTop: 10 }}>
            <button className="btn primary" type="button" onClick={toggle} aria-label={playing ? "멈춤" : "재생"}>
              {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "멈춤" : "같이 재생"}
            </button>
            <input type="range" min={0} max={length || 1} step={0.01} value={Math.min(time, length || 1)} aria-label="재생 위치" onChange={(event) => seek(Number(event.target.value))} style={{ flex: 1 }} />
            <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
              {clock(time)} / {clock(length)}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
