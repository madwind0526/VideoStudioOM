import { Dices, FileText, Images, Sparkles, Trash2, Wand2 } from "lucide-react";
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
import { clearHandoff, peekHandoff } from "../handoff";
import { sizeFromPrompt, useImageSize } from "../imageSizes";
import { ItemTools, useVersionDialog } from "../sections/MediaSections";
import LoraPicker, { loraFields } from "../components/LoraPicker";
import { makePrompt, startItems, stamp, withUpscale, type MakeItem, type SceneLora, type UpscaleHow } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";
import ImageRandom from "./ImageRandom";
import PromptPick from "./PromptPick";
import ImageEdit from "./ImageEdit";
import ImageRef from "./ImageRef";
import ImageSheet from "./ImageSheet";
import ImageVary from "./ImageVary";

/** The id of the image library: a hidden project (see server/projects.mjs ensureHidden), so jobs, versions and records work as in any project. */
const LIBRARY = "_images";


type Tab = "make" | "vary" | "ref" | "sheet";
const TITLES: Record<Tab, string> = { make: "이미지 생성", vary: "이미지 편집", ref: "참조후 재생성", sheet: "캐릭터 시트" };

interface Props {
  tab: Tab;
  jobTick: number;
  notify: (text: string) => void;
}

/** The image menu: pictures that belong to no project, made N at a time (more ways to make them follow, see todo.md). */
export default function ImagesPage({ tab, jobTick, notify }: Props) {
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
  return <Library tab={tab} project={project} view={view} jobTick={jobTick} notify={notify} />;
}

function Library({ tab, project, view, jobTick, notify }: { tab: Tab; project: ProjectSummary; view: ProjectSettingsView | null; jobTick: number; notify: (text: string) => void }) {
  const { detail, reload } = useProjectDetail(project.id, jobTick);
  const jobs = useJobs(jobTick);
  const [open, setOpen] = useState<string | null>(null);
  // A prompt sent from the prompt library opens its tab filled in and sets the size; nothing starts until the make button is pressed.
  const [draft] = useState(() => peekHandoff("image"));
  // R2I has two ways: draw with reference pictures (Qwen) or look at one picture and draw it again from a prompt (Krea).
  const [r2i, setR2i] = useState<"refs" | "analyze">("refs");
  const [loras, setLoras] = useState<SceneLora[]>([]);
  const [upscale, setUpscale] = useState<UpscaleHow | null>(null);
  const [choosingUpscale, setChoosingUpscale] = useState(false);
  const [enlarging, setEnlarging] = useState<string | null>(null);
  const [count, setCount] = useState("4");
  const imageSize = useImageSize();
  useEffect(() => {
    if (draft) imageSize.setValue(sizeFromPrompt(draft.prompt));
    clearHandoff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const favorites = useFavorites(project.id);
  const [order, setOrder] = useState<SortOrder>("time");
  const [browsing, setBrowsing] = useState(false);

  // Size, LoRAs and the upscale: shown just above the make button of every tab. `sizeOff`: the result takes the size of a picture (image edit).
  const optionsFor = (sizeOff: boolean) => (
    <div className="gen-options">
        <SizePicker
        label={sizeOff ? "이미지 크기 (그림1을 따름)" : "이미지 크기"}
        disabled={sizeOff}
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
  const options = optionsFor(false);
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
        {TITLES[tab]}
      </h2>
      <span className="hint">프로젝트와 상관없이 만든 그림입니다. 마음에 드는 그림은 나중에 프로젝트의 장면 그림으로 보낼 수 있습니다.</span>
      <div style={{ height: 14 }} />
      {tab === "make" ? (
        <Maker initial={draft?.prompt} props={props} loras={loras} upscale={upscale} size={imageSize.size} count={count} options={options} />
      ) : tab === "sheet" ? (
        <ImageSheet props={props} images={images} favorites={favorites} order={order} onOrder={setOrder} />
      ) : tab === "vary" ? (
        <ImageEdit initial={draft ? { prompt: draft.prompt, image: draft.image } : undefined} props={props} images={images} loras={loras} upscale={upscale} count={count} options={optionsFor(true)} favorites={favorites} order={order} onOrder={setOrder} />
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
            <ImageRef initial={draft ? { prompt: draft.prompt, image: draft.image } : undefined} props={props} images={images} loras={loras} upscale={upscale} size={imageSize.size} count={count} options={options} favorites={favorites} order={order} onOrder={setOrder} />
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

const MIX_KEY = "imageMixPrompts";
const savedMix = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(MIX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

/** Description, size and count: starts that many jobs (each picks its own seed). With saved random prompts: one picture of each of them. */
function Maker({ initial, props, loras, upscale, size, count, options }: { initial?: string; props: SectionProps; loras: SceneLora[]; upscale: UpscaleHow | null; size: [number, number]; count: string; options: ReactNode }) {
  const { project, view, jobs, notify, onJobsChanged } = props;
  const [prompt, setPrompt] = useState(initial ?? "");
  const [randomOpen, setRandomOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  // The prompts saved from the random pop-up wait here (remembered in this browser) until "만들기".
  const [mix, setMixState] = useState<string[]>(savedMix);
  const setMix = (next: string[]) => {
    setMixState(next);
    try {
      localStorage.setItem(MIX_KEY, JSON.stringify(next));
    } catch {
      // Only remembered when the browser lets it.
    }
  };
  const model = useModelChoice("t2i");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setError("");
    if (!prompt.trim()) return setError("만들고 싶은 그림을 간단히 적은 뒤 눌러 주세요.");
    setDrafting(true);
    try {
      setPrompt(await makePrompt(project.id, { target: "image", imageModel: model.id, text: prompt }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  async function submit() {
    setError("");
    const mixed = mix.map((item) => item.trim()).filter(Boolean);
    const text = prompt.trim();
    const number = Number(count);
    if (mixed.length === 0 && !text) return setError("그림 설명을 적어 주세요.");
    if (!view) return setError("설정을 불러오는 중입니다.");
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    if (loras.some((lora) => lora.name.trim()) && model.id !== "krea2-turbo") return setError("이 모델은 LoRA를 적용하지 않습니다. LoRA를 끄거나 Krea 2 Turbo를 고르세요.");
    const [width, height] = size;
    const id = stamp();
    const extra = loraFields(loras);
    const items: MakeItem[] = Array.from({ length: number }, (_, index) => {
      // Saved prompts are used in turn: more pictures than prompts start over from the first one (every picture has its own seed).
      const own = mixed.length > 0 ? mixed[index % mixed.length] : text;
      return {
        tool: model.tool,
        label: own,
        record: { kind: "image", prompt: own, ...extra.recipe, imageModel: model.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
        inputs: { prompt: own, width, height, ...extra.inputs, ...samplingInputs(model, index), output_path: `assets/images/${mixed.length > 0 ? "mix" : "img"}-${id}-${String(index + 1).padStart(2, "0")}.png` },
      };
    });
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
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title={`간단한 설명을 고른 모델(${model.label})에 맞는 영어 프롬프트로 바꿔 줍니다.`}>
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
            </button>{" "}
            <button className="btn" type="button" onClick={() => setRandomOpen(true)} title="인물, 의상, 배경, 구도, 조명 등을 항목별로 골라 무작위로 섞어 만듭니다.">
              <Dices size={15} /> 랜덤으로 만들기
            </button>{" "}
            <button className="btn" type="button" onClick={() => setPickOpen(true)} title="프롬프트가 들어 있는 파일에서 하나를 골라(임의로 또는 직접) 그 프롬프트로 정해진 장수만큼 만듭니다.">
              <FileText size={15} /> 프롬프트에서 임의로 골라서 만들기
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["prompt-image"]} refreshKey={drafting ? 1 : 0} />
        </div>
        {mix.length > 0 && (
          <div className="field wide">
            <label>랜덤으로 저장한 프롬프트 ({mix.length}개, 각각 고칠 수 있습니다)</label>
            {mix.map((text, index) => (
              <textarea key={index} rows={3} value={text} maxLength={7000} aria-label={`랜덤 프롬프트 ${index + 1}`} onChange={(event) => setMix(mix.map((item, at) => (at === index ? event.target.value : item)))} />
            ))}
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <button className="btn" type="button" style={{ whiteSpace: "nowrap", flexShrink: 0 }} onClick={() => setMix([])}>
                <Trash2 size={15} /> 저장한 프롬프트 지우기
              </button>
              <span className="hint">아래 "만들기"를 누르면 위의 그림 설명 대신 이 프롬프트들로 장수만큼 만듭니다. 장수가 프롬프트 수보다 많으면 처음 프롬프트부터 다시 돌려 쓰고, 적으면 앞의 프롬프트만 씁니다.</span>
            </div>
          </div>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      {options}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || running} onClick={() => void submit()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : mix.length > 0 ? `랜덤 프롬프트 ${mix.length}개로 ${count}장 만들기` : "만들기"}
        </button>
      </div>
      {pickOpen && (
        <PromptPick
          onSave={(prompts) => {
            setMix(prompts);
            setPickOpen(false);
            notify("고른 프롬프트를 저장했습니다. LoRA나 업스케일을 고른 뒤 만들기를 누르세요.");
          }}
          onClose={() => setPickOpen(false)}
        />
      )}
      {randomOpen && (
        <ImageRandom
          props={props}
          count={count}
          onSave={(prompts) => {
            setMix(prompts);
            setRandomOpen(false);
            notify(`랜덤 프롬프트 ${prompts.length}개를 저장했습니다. LoRA나 업스케일을 고른 뒤 만들기를 누르세요.`);
          }}
          onClose={() => setRandomOpen(false)}
        />
      )}
    </section>
  );
}
