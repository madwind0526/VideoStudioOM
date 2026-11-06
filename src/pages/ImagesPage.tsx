import { Dices, Images, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, mediaUrl, type MediaFile, type ProjectSettingsView, type ProjectSummary } from "../api";
import JobList from "../components/JobList";
import LibraryBrowser, { LibraryCard, SortButtons, sortImages, useFavorites, type SortOrder } from "../components/LibraryBrowser";
import Lightbox from "../components/Lightbox";
import PromptLog from "../components/PromptLog";
import SizePicker from "../components/SizePicker";
import UpscaleDialog from "../components/UpscaleDialog";
import { samplingInputs, useModelChoice } from "../components/ModelPicker";
import { UPSCALE_WORKFLOWS } from "../../shared/upscale.mjs";
import { useImageSize } from "../imageSizes";
import { ItemTools, useVersionDialog } from "../sections/MediaSections";
import LoraPicker, { loraFields } from "../components/LoraPicker";
import { makePrompt, startItems, stamp, withUpscale, type MakeItem, type SceneLora, type UpscaleHow } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";
import ImageRandom from "./ImageRandom";
import ImageEdit from "./ImageEdit";
import ImageRef from "./ImageRef";
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
  const [tab, setTab] = useState<"make" | "vary" | "ref">("make");
  // R2I has two ways: draw with reference pictures (Qwen) or look at one picture and draw it again from a prompt (Krea).
  const [r2i, setR2i] = useState<"refs" | "analyze">("refs");
  const [loras, setLoras] = useState<SceneLora[]>([]);
  const [upscale, setUpscale] = useState<UpscaleHow | null>(null);
  const [choosingUpscale, setChoosingUpscale] = useState(false);
  const [enlarging, setEnlarging] = useState<string | null>(null);
  const [count, setCount] = useState("4");
  const imageSize = useImageSize();
  const favorites = useFavorites(project.id);
  const [order, setOrder] = useState<SortOrder>("time");
  const [browsing, setBrowsing] = useState(false);

  // Size, LoRAs and the upscale: shown just above the make button of every tab.
  const options = (
    <div className="gen-options">
        <SizePicker
        label="이미지 크기"
        megapixels={imageSize.value.megapixels}
        aspect={imageSize.value.aspect}
        orientation={imageSize.value.orientation}
        custom={imageSize.value.custom}
        onMegapixels={(megapixels) => imageSize.setValue((current) => ({ ...current, megapixels }))}
        onAspect={(aspect) => imageSize.setValue((current) => ({ ...current, aspect }))}
        onOrientation={(orientation) => imageSize.setValue((current) => ({ ...current, orientation }))}
        onCustom={(custom) => imageSize.setValue((current) => ({ ...current, custom: { generate: custom } }))}
      >
        <div className="field">
          <label htmlFor="img-count">장수</label>
          <input id="img-count" type="number" min={1} max={24} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
        </div>
      </SizePicker>
      <LoraPicker value={loras} onChange={setLoras} />
      <div className="field">
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={upscale !== null || choosingUpscale}
              onChange={(event) => {
                if (event.target.checked) setChoosingUpscale(true);
                else setUpscale(null);
              }}
            />
            업스케일 (만든 뒤 확대)
          </label>
          {upscale && (
            <>
              <span className="hint">
                {UPSCALE_WORKFLOWS.find((item) => item.id === (upscale.workflow ?? "rtx"))?.label.split(" (")[0]}{upscale.model && upscale.workflow !== "rtx" ? ` · ${upscale.model}` : ""} · ×{upscale.scale}
              </span>
              <button className="btn" type="button" onClick={() => setChoosingUpscale(true)}>
                바꾸기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
  const images = detail?.media.images ?? [];
  const sorted = sortImages(images, favorites, order);

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
  const openFile = (file: MediaFile) => ((file.versions ?? 0) > 1 ? versionDialog.open(file.path, "versions") : setOpen(file.path));
  const tools = (file: MediaFile) => (
    <ItemTools props={props} file={file} kind="image" onPrompt={(tab) => versionDialog.open(file.path, tab)} onEnlarge={() => setEnlarging(file.path)} />
  );

  return (
    <div className="page">
      <div className="section">
      <h2>
        이미지 보관함 <span className="count">{images.length}</span>
      </h2>
      <span className="hint">프로젝트와 상관없이 만든 그림입니다. 마음에 드는 그림은 나중에 프로젝트의 장면 그림으로 보낼 수 있습니다.</span>
      <div className="tabs" role="tablist" aria-label="이미지 만들기 방식" style={{ margin: "14px 0" }}>
        <button className="tab" role="tab" aria-selected={tab === "make"} onClick={() => setTab("make")}>
          만들기 (T2I)
        </button>
        <button className="tab" role="tab" aria-selected={tab === "vary"} onClick={() => setTab("vary")}>
          분석해서 변주 (I2I)
        </button>
        <button className="tab" role="tab" aria-selected={tab === "ref"} onClick={() => setTab("ref")}>
          참조로 만들기 (R2I)
        </button>
      </div>
      {tab === "make" ? (
        <Maker props={props} loras={loras} upscale={upscale} size={imageSize.size} count={count} options={options} />
      ) : tab === "vary" ? (
        <ImageEdit props={props} images={images} upscale={upscale} count={count} options={options} favorites={favorites} order={order} onOrder={setOrder} />
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 10 }} role="group" aria-label="R2I 방식">
            <button className={`btn${r2i === "refs" ? " primary" : ""}`} type="button" aria-pressed={r2i === "refs"} onClick={() => setR2i("refs")} title="참조 그림(과 포즈 그림)을 보고 새로 그립니다 (Qwen Image Edit).">
              참조 그림으로 그리기
            </button>
            <button className={`btn${r2i === "analyze" ? " primary" : ""}`} type="button" aria-pressed={r2i === "analyze"} onClick={() => setR2i("analyze")} title="그림 하나를 분석해 프롬프트로 만들고, 바꿀 내용을 반영해 다시 그립니다 (Krea 2 Turbo).">
              분석해서 다시 그리기
            </button>
          </div>
          {r2i === "refs" ? (
            <ImageRef props={props} images={images} loras={loras} upscale={upscale} size={imageSize.size} count={count} options={options} favorites={favorites} order={order} onOrder={setOrder} />
          ) : (
            <ImageVary props={props} images={images} loras={loras} upscale={upscale} size={imageSize.size} count={count} options={options} favorites={favorites} order={order} onOrder={setOrder} />
          )}
        </>
      )}
      <JobList projectId={project.id} jobs={jobs.history} outputs={["assets/images/"]} pending={jobs.pending} paused={jobs.paused} onChanged={props.onJobsChanged} />
      <div className="row" style={{ gap: 10, margin: "8px 0" }}>
        <h3 style={{ margin: 0 }}>
          Lib <span className="count">{images.length}</span>
        </h3>
        <SortButtons order={order} onChange={setOrder} />
        <button className="btn" type="button" onClick={() => setBrowsing(true)} title="보관함의 그림을 카드로 모아 봅니다.">
          <Images size={15} /> Lib 보기
        </button>
      </div>
      {images.length === 0 ? (
        <p className="muted">아직 그림이 없습니다. 위에서 설명을 적고 만들어 보세요.</p>
      ) : (
        <div className="thumbs big square strip">
          {sorted.map((file) => (
            <LibraryCard key={file.path} projectId={project.id} file={file} favorites={favorites} onClick={() => openFile(file)} tools={tools(file)} />
          ))}
        </div>
      )}
      {browsing && <LibraryBrowser projectId={project.id} images={images} favorites={favorites} order={order} onOrder={setOrder} title="Lib 보기" onClose={() => setBrowsing(false)} onOpen={(path) => openFile(images.find((file) => file.path === path)!)} tools={tools} />}
      {open && <Lightbox src={mediaUrl(project.id, open, images.find((file) => file.path === open)?.mtimeMs)} alt={open} onClose={() => setOpen(null)} />}
      {versionDialog.dialog}
      {choosingUpscale && <UpscaleDialog initial={upscale} onChoose={setUpscale} onClose={() => setChoosingUpscale(false)} />}
      {enlarging && images.find((file) => file.path === enlarging) && (
        <UpscaleDialog projectId={project.id} file={images.find((file) => file.path === enlarging)!} jobs={jobs} notify={notify} onJobsChanged={props.onJobsChanged} onClose={() => setEnlarging(null)} />
      )}
      </div>
    </div>
  );
}

/** Description, size and count: starts that many jobs (each picks its own seed). */
function Maker({ props, loras, upscale, size, count, options }: { props: SectionProps; loras: SceneLora[]; upscale: UpscaleHow | null; size: [number, number]; count: string; options: ReactNode }) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [prompt, setPrompt] = useState("");
  const [randomOpen, setRandomOpen] = useState(false);
  const model = useModelChoice("t2i");
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
    if (loras.some((lora) => lora.name.trim()) && model.id !== "krea2-turbo") return setError("이 모델은 LoRA를 적용하지 않습니다. LoRA를 끄거나 Krea 2 Turbo를 고르세요.");
    const [width, height] = size;
    const id = stamp();
    const extra = loraFields(loras);
    const items: MakeItem[] = Array.from({ length: number }, (_, index) => ({
      tool: model.tool,
      label: text,
      record: { kind: "image", prompt: text, ...extra.recipe, imageModel: model.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
      inputs: { prompt: text, width, height, ...extra.inputs, ...samplingInputs(model, index), output_path: `assets/images/img-${id}-${String(index + 1).padStart(2, "0")}.png` },
    }));
    setBusy(true);
    try {
      await startItems(project.id, withUpscale(items, upscale));
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
      {model.picker}
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="img-prompt">그림 설명</label>
          <textarea id="img-prompt" rows={5} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 아침 햇살 속 데이지 꽃에 앉은 꿀벌" />
          <div>
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 Krea 2 Turbo에 맞는 영어 프롬프트로 바꿔 줍니다.">
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
            </button>{" "}
            <button className="btn" type="button" onClick={() => setRandomOpen(true)} title="인물, 의상, 배경, 구도, 조명 등을 항목별로 골라 무작위로 섞어 만듭니다.">
              <Dices size={15} /> 랜덤으로 만들기
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["prompt-image"]} refreshKey={drafting ? 1 : 0} />
        </div>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      {options}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || running} onClick={() => void submit()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : "만들기"}
        </button>
      </div>
      {randomOpen && <ImageRandom props={props} loras={loras} upscale={upscale} size={size} count={count} model={model} onClose={() => setRandomOpen(false)} />}
    </section>
  );
}
