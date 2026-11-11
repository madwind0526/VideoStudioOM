import { Languages, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, ApiError, type MediaFile } from "../api";
import ImageSlot from "../components/ImageSlot";
import { loraFields } from "../components/LoraPicker";
import type { Favorites, SortOrder } from "../components/LibraryBrowser";
import PromptLog from "../components/PromptLog";
import { samplingInputs, useModelChoice } from "../components/ModelPicker";
import { startItems, stamp, withUpscale, type MakeItem, type SceneLora, type UpscaleHow } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

/** Several pictures and a sentence that points at them ("그림1의 사람이 그림2의 옷을 입고 그림3의 포즈를 취한다"): Qwen Image Edit. */
export default function ImageEdit({ initial, props, images, loras, upscale, count, options, favorites, order, onOrder }: { initial?: { prompt: string; image?: string }; props: SectionProps; images: MediaFile[]; loras: SceneLora[]; upscale: UpscaleHow | null; count: string; options: ReactNode; favorites: Favorites; order: SortOrder; onOrder: (order: SortOrder) => void }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const model = useModelChoice("i2i");
  const [sources, setSources] = useState<string[]>(initial?.image ? [initial.image] : []);
  const [request, setRequest] = useState(initial?.prompt ?? "");
  const [english, setEnglish] = useState("");
  // The request the English text was made from: when the request changes, the English is made again.
  const [madeFrom, setMadeFrom] = useState("");
  const [working, setWorking] = useState<"" | "translate" | "make">("");
  const [error, setError] = useState("");
  const running = jobs.current !== null;

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);
  const key = () => `${request}|${sources.length}|${model.naming}`;

  async function translate(): Promise<string | null> {
    setError("");
    if (sources.length === 0) {
      setError("편집할 그림을 하나 이상 고르세요.");
      return null;
    }
    if (!request.trim()) {
      setError("어떻게 바꿀지 적어 주세요.");
      return null;
    }
    setWorking("translate");
    try {
      const result = (await api<{ prompt: string }>("POST", "/api/images/edit-prompt", { text: request, count: sources.length, naming: model.naming })).prompt;
      setEnglish(result);
      setMadeFrom(key());
      return result;
    } catch (e) {
      fail(e, "영어 지시문을 만들지 못했습니다.");
      return null;
    } finally {
      setWorking("");
    }
  }

  async function make() {
    setError("");
    const number = Number(count);
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    if (sources.length > model.maxPictures) return setError(`${model.label}은(는) 그림을 ${model.maxPictures}장까지 받습니다. 그림을 줄이거나 다른 모델을 고르세요.`);
    // The English instruction is made on the way when there is none yet or the request changed since.
    const text = english.trim() && madeFrom === key() ? english.trim() : await translate();
    if (!text) return;
    const id = stamp();
    const items: MakeItem[] = Array.from({ length: number }, (_, index) => ({
      tool: model.tool,
      label: request.trim(),
      record: { kind: "image", prompt: text, idea: request.trim(), editFrom: sources, imageModel: model.id, ...loraFields(loras).recipe, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
      inputs: { prompt: text, reference_image_path: sources[0], reference_image_paths: sources.slice(1), ...(loraFields(loras).recipe.loras ? { loras: loraFields(loras).recipe.loras } : {}), ...samplingInputs(model, index), output_path: `assets/images/edit-${id}-${String(index + 1).padStart(2, "0")}.png` },
    }));
    setWorking("make");
    try {
      await startItems(project.id, withUpscale(items, upscale));
      notify(`${number}장을 차례로 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      fail(e, "작업을 시작하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  return (
    <section className="gen-card">
      <h3>그림 편집 (여러 그림)</h3>
      <span className="hint">그림을 여러 장 고르고 그림1, 그림2처럼 번호로 가리키며 바꿀 내용을 적습니다. 예: "그림1의 사람이 그림2의 옷을 입고 그림3의 포즈를 취하고 있다". 결과는 그림1과 같은 크기가 되어 아래 이미지 크기는 쓰지 않습니다(회색). LoRA는 모델에 더해 적용됩니다. 그림 장수 제한은 모델마다 정해져 있습니다 (Qwen: 10, Flux: 4, Krea: 2).</span>

      {model.picker}
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label={`1. 그림 고르기 (${sources.length}/${model.maxPictures}장, 첫 그림이 편집되고 나머지는 참조)`} value={sources} max={model.maxPictures} numbered onChange={setSources} />

      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="edit-request">2. 바꿀 내용</label>
          <textarea id="edit-request" rows={3} value={request} maxLength={2000} onChange={(event) => setRequest(event.target.value)} placeholder="예: 그림1의 사람이 그림2의 옷을 입고 그림3의 포즈를 취하고 있다" />
          <div>
            <button className="btn" type="button" disabled={working !== ""} onClick={() => void translate()} title="편집 모델은 영어 지시문을 따릅니다. 한글로 적은 내용을 영어로 바꿉니다 (만들 때 자동으로도 바꿉니다).">
              <Languages size={15} /> {working === "translate" ? "바꾸는 중..." : "영어 지시문으로 바꾸기"}
            </button>
          </div>
          <PromptLog projectId={project.id} stages={["image-edit"]} refreshKey={working === "translate" ? 1 : 0} />
        </div>
        {english && (
          <div className="field wide">
            <label htmlFor="edit-english">3. 모델에 보낼 영어 지시문 (직접 고칠 수 있습니다)</label>
            <textarea id="edit-english" rows={3} value={english} maxLength={4000} onChange={(event) => setEnglish(event.target.value)} />
          </div>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      {options}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" type="button" disabled={working !== "" || running || sources.length === 0} onClick={() => void make()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : working === "translate" ? "영어로 바꾸는 중..." : "만들기"}
        </button>
      </div>
    </section>
  );
}
