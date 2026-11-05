import { Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, mediaUrl, type ProjectSettingsView, type ProjectSummary } from "../api";
import JobList from "../components/JobList";
import Lightbox from "../components/Lightbox";
import PromptLog from "../components/PromptLog";
import { IMAGE_SIZES, type ImageSizeId } from "../imageSizes";
import { ItemTools, useVersionDialog } from "../sections/MediaSections";
import { makePrompt, startItems, stamp, type MakeItem } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";
import ImageVary from "./ImageVary";

/** The id of the image library: a hidden project (see server/projects.mjs ensureHidden), so jobs, versions and records work as in any project. */
const LIBRARY = "_images";


interface Props {
  jobTick: number;
  notify: (text: string) => void;
}

/** The image menu: pictures that belong to no project, made N at a time (more ways to make them follow, see todo.md). */
export default function ImagesPage({ jobTick, notify }: Props) {
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
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "이미지 보관함을 열지 못했습니다."));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="error" style={{ padding: 24 }}>{error}</p>;
  if (!project) return <p className="muted" style={{ padding: 24 }}>이미지 보관함을 여는 중입니다...</p>;
  return <Library project={project} view={view} jobTick={jobTick} notify={notify} />;
}

function Library({ project, view, jobTick, notify }: { project: ProjectSummary; view: ProjectSettingsView | null; jobTick: number; notify: (text: string) => void }) {
  const { detail, reload } = useProjectDetail(project.id, jobTick);
  const jobs = useJobs(jobTick);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"make" | "vary">("make");
  const images = detail?.media.images ?? [];

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
  const versionDialog = useVersionDialog(props, "image", images);

  return (
    <div className="page">
      <div className="section">
      <h2>
        이미지 보관함 <span className="count">{images.length}</span>
      </h2>
      <span className="hint">프로젝트와 상관없이 만든 그림입니다. 마음에 드는 그림은 나중에 프로젝트의 장면 그림으로 보낼 수 있습니다.</span>
      <div className="tabs" role="tablist" aria-label="이미지 만들기 방식" style={{ margin: "14px 0" }}>
        <button className="tab" role="tab" aria-selected={tab === "make"} onClick={() => setTab("make")}>
          만들기
        </button>
        <button className="tab" role="tab" aria-selected={tab === "vary"} onClick={() => setTab("vary")}>
          분석해서 변주
        </button>
      </div>
      {tab === "make" ? <Maker props={props} /> : <ImageVary props={props} images={images} />}
      <JobList projectId={project.id} jobs={jobs.history} outputs={["assets/images/"]} pending={jobs.pending} paused={jobs.paused} onChanged={props.onJobsChanged} />
      {images.length === 0 ? (
        <p className="muted">아직 그림이 없습니다. 위에서 설명을 적고 만들어 보세요.</p>
      ) : (
        <div className="thumbs big">
          {images.map((file) => (
            <div key={file.path} className="media-item">
              <button type="button" title={file.path} onClick={() => ((file.versions ?? 0) > 1 ? versionDialog.open(file.path, "versions") : setOpen(file.path))}>
                <img src={mediaUrl(project.id, file.path, file.mtimeMs)} alt={file.path} loading="lazy" />
              </button>
              <ItemTools props={props} file={file} kind="image" onPrompt={(tab) => versionDialog.open(file.path, tab)} />
            </div>
          ))}
        </div>
      )}
      {open && <Lightbox src={mediaUrl(project.id, open, images.find((file) => file.path === open)?.mtimeMs)} alt={open} onClose={() => setOpen(null)} />}
      {versionDialog.dialog}
      </div>
    </div>
  );
}

/** Description, size and count: starts that many jobs (each picks its own seed). */
function Maker({ props }: { props: SectionProps }) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [prompt, setPrompt] = useState("");
  const [sizeId, setSizeId] = useState<ImageSizeId>("wide");
  const [count, setCount] = useState("4");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setError("");
    if (!prompt.trim()) return setError("만들고 싶은 그림을 간단히 적은 뒤 눌러 주세요.");
    setDrafting(true);
    try {
      setPrompt(await makePrompt(project.id, { target: "image", text: prompt }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  async function submit() {
    setError("");
    const text = prompt.trim();
    const number = Number(count);
    if (!text) return setError("그림 설명을 적어 주세요.");
    if (!view) return setError("설정을 불러오는 중입니다.");
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    const [width, height] = IMAGE_SIZES.find((item) => item.id === sizeId)!.size;
    const id = stamp();
    const items: MakeItem[] = Array.from({ length: number }, (_, index) => ({
      tool: "comfyui_krea_image",
      label: text,
      record: { kind: "image", prompt: text },
      inputs: { prompt: text, width, height, output_path: `assets/images/img-${id}-${String(index + 1).padStart(2, "0")}.png` },
    }));
    setBusy(true);
    try {
      await startItems(project.id, items);
      notify(`${number}장을 차례로 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const running = jobs.current !== null;
  return (
    <section className="gen-card">
      <h3>새로 만들기</h3>
      <span className="hint">같은 설명으로 여러 장을 만듭니다. 장마다 시드가 달라서 서로 다른 그림이 나옵니다.</span>
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="img-prompt">그림 설명</label>
          <textarea id="img-prompt" rows={5} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 아침 햇살 속 데이지 꽃에 앉은 꿀벌" />
          <div>
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 Krea 2 Turbo에 맞는 영어 프롬프트로 바꿔 줍니다.">
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["prompt-image"]} refreshKey={drafting ? 1 : 0} />
        </div>
        <div className="field">
          <label htmlFor="img-size">크기</label>
          <select id="img-size" value={sizeId} onChange={(event) => setSizeId(event.target.value as ImageSizeId)}>
            {IMAGE_SIZES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="img-count">장수</label>
          <input id="img-count" type="number" min={1} max={24} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
        </div>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || running} onClick={() => void submit()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : "만들기"}
        </button>
      </div>
    </section>
  );
}
