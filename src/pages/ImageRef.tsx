import { Sparkles, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApiError, type MediaFile } from "../api";
import ImageSlot from "../components/ImageSlot";
import type { Favorites, SortOrder } from "../components/LibraryBrowser";
import { loraFields } from "../components/LoraPicker";
import PromptLog from "../components/PromptLog";
import { samplingInputs, useModelChoice } from "../components/ModelPicker";
import { makePrompt, startItems, stamp, withUpscale, type MakeItem, type RefMode, type SceneLora, type UpscaleHow, editPrompt } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

/** Most reference pictures (a pose picture goes in addition; the model takes ten pictures with the empty canvas). */
const MAX_REFS = 8;

const MODES: { id: RefMode; label: string; hint: string }[] = [
  { id: "person", label: "인물을 그대로 (얼굴·머리·옷)", hint: "참조 그림 속 인물의 얼굴, 머리, 옷을 그대로 두고 장면만 새로 그립니다." },
  { id: "style", label: "화풍·색·분위기만", hint: "참조 그림의 화풍, 색, 빛, 분위기만 빌리고 피사체와 구도는 전혀 새로 그립니다." },
];

/** R2I: a new picture drawn with reference pictures (and a pose picture); unlike the edit of "분석해서 변주" nothing of the references is copied but what is asked for. */
export default function ImageRef({ initial, props, images, loras, upscale, size, count, options, favorites, order, onOrder }: { initial?: { prompt: string; image?: string }; props: SectionProps; images: MediaFile[]; loras: SceneLora[]; upscale: UpscaleHow | null; size: [number, number]; count: string; options: ReactNode; favorites: Favorites; order: SortOrder; onOrder: (order: SortOrder) => void }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const model = useModelChoice("r2i");
  const [refs, setRefs] = useState<string[]>(initial?.image ? [initial.image] : []);
  const [pose, setPose] = useState<string[]>([]);
  const [mode, setMode] = useState<RefMode>("person");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = jobs.current !== null;

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  async function draft() {
    setError("");
    if (!prompt.trim()) return setError("만들고 싶은 그림을 간단히 적은 뒤 눌러 주세요.");
    setDrafting(true);
    try {
      setPrompt(await makePrompt(project.id, { target: "image", imageModel: model.id, text: prompt }));
    } catch (e) {
      fail(e, "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  async function submit() {
    setError("");
    const text = prompt.trim();
    const number = Number(count);
    // Krea 2 + Pose follows the pose picture, Krea 2 + Depth the first reference picture (nothing of the others is used).
    const control = model.inputs.control;
    const source = control === "pose" ? pose[0] : control ? refs[0] : undefined;
    if (control && !source) return setError(control === "pose" ? "포즈 그림을 고르세요." : "구도를 따라갈 참조 그림을 하나 이상 고르세요.");
    if (!control && refs.length === 0) return setError("참조할 그림을 하나 이상 고르세요.");
    if (!text) return setError("새로 그릴 그림을 설명해 주세요.");
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    // Krea 2 + Identity Edit and Flux.2 klein take the references (and the pose picture) as the pictures of an edit: the first is edited.
    const edits = model.tool === "comfyui_edit_model" ? [...refs, ...(pose[0] ? [pose[0]] : [])] : [];
    if (edits.length > model.maxPictures) return setError(`${model.label}은(는) 그림을 ${model.maxPictures}장까지 받습니다 (참조 그림과 포즈 그림을 합쳐서).`);
    const id = stamp();
    const extra = loraFields(loras);
    // The pose picture follows the references: the prompt names it by its number.
    const items: MakeItem[] = Array.from({ length: number }, (_, index) =>
      model.tool === "comfyui_edit_model"
        ? {
            tool: model.tool,
            label: text,
            record: { kind: "image", prompt: text, editFrom: edits, imageModel: model.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
            inputs: { prompt: text, reference_image_path: edits[0], reference_image_paths: edits.slice(1), width: size[0], height: size[1], ...samplingInputs(model, index), output_path: `assets/images/ref-${id}-${String(index + 1).padStart(2, "0")}.png` },
          }
        : control && source
        ? {
            tool: model.tool,
            label: text,
            record: { kind: "image", prompt: text, imageModel: model.id, controlFrom: source, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
            inputs: { prompt: text, control_image_path: source, ...samplingInputs(model, index), output_path: `assets/images/ref-${id}-${String(index + 1).padStart(2, "0")}.png` },
          }
        : {
      tool: "comfyui_image_edit",
      label: text,
      record: { kind: "image", prompt: text, editRefs: refs, refMode: mode, ...(pose[0] ? { pose: pose[0] } : {}), ...extra.recipe, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
      inputs: {
        prompt: editPrompt(text, refs.length, mode, Boolean(pose[0])),
        blank_canvas: true,
        reference_image_paths: pose[0] ? [...refs, pose[0]] : refs,
        width: size[0],
        height: size[1],
        ...samplingInputs(model, index),
        output_path: `assets/images/ref-${id}-${String(index + 1).padStart(2, "0")}.png`,
      },
    },
    );
    setBusy(true);
    try {
      await startItems(project.id, withUpscale(items, upscale));
      notify(`${number}장을 차례로 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      fail(e, "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card">
      <h3>참조로 만들기 (R2I)</h3>
      <span className="hint">참조 그림을 보고 완전히 새로운 그림을 그립니다. 인물을 그대로 두거나 화풍만 빌릴 수 있고, 포즈 그림을 주면 그 자세를 따라 그립니다. 장수, 크기, LoRA, 확대는 아래 값을 씁니다.</span>

      {model.picker}
      {model.tool === "comfyui_edit_model" && <span className="hint">참조 그림(과 포즈 그림)이 편집 모델의 입력 그림이 됩니다. 첫 그림이 기준이고 설명에서 "첫 번째 그림", "두 번째 그림"처럼 영어로 가리킬 수 있습니다. 결과 크기는 위에서 고른 크기입니다.</span>}
      {model.inputs.control === "pose" && <span className="hint">이 모델은 아래 "포즈 그림"의 자세만 따라 그립니다. 참조 그림은 쓰지 않고, 모습은 설명으로 정합니다.</span>}
      {(model.inputs.control === "depth" || model.inputs.control === "canny") && <span className="hint">이 모델은 첫 번째 참조 그림의 {model.inputs.control === "depth" ? "깊이(구도와 입체감)" : "윤곽선"}을 따라 그립니다. 나머지 그림과 포즈 그림은 쓰지 않습니다.</span>}
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label={`1. 참조 그림 (${refs.length}/${MAX_REFS}장)`} value={refs} max={MAX_REFS} onChange={setRefs} />
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="2. 포즈 그림 (선택 — 이 그림의 자세만 따라 그립니다)" value={pose} max={1} onChange={setPose} />

      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="ref-mode">3. 참조 방식</label>
          <select id="ref-mode" value={mode} onChange={(event) => setMode(event.target.value as RefMode)}>
            {MODES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <span className="hint">{MODES.find((item) => item.id === mode)?.hint}</span>
        </div>
        <div className="field wide">
          <label htmlFor="ref-prompt">4. 새로 그릴 그림 설명</label>
          <textarea id="ref-prompt" rows={4} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder="예: 비 오는 밤 네온 거리에서 우산을 든 모습" />
          <div>
            <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title={`간단한 설명을 고른 모델(${model.label})에 맞는 영어 프롬프트로 바꿔 줍니다.`}>
              <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
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

    </section>
  );
}
