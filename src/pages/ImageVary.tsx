import { PencilLine, ScanSearch, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, ApiError, type MediaFile } from "../api";
import ImageSlot from "../components/ImageSlot";
import type { Favorites, SortOrder } from "../components/LibraryBrowser";
import PromptLog from "../components/PromptLog";
import { samplingInputs, useModelChoice } from "../components/ModelPicker";
import { loraFields } from "../components/LoraPicker";
import { startItems, stamp, withUpscale, type MakeItem, type SceneLora, type UpscaleHow } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

/** Take a picture, let a vision model say what it shows, edit that as a prompt and make several variations of it. */
export default function ImageVary({ props, images, loras, upscale, size, count, options, favorites, order, onOrder }: { props: SectionProps; images: MediaFile[]; loras: SceneLora[]; upscale: UpscaleHow | null; size: [number, number]; count: string; options: ReactNode; favorites: Favorites; order: SortOrder; onOrder: (order: SortOrder) => void }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const [sources, setSources] = useState<string[]>([]);
  const source = sources[0] ?? "";
  const [description, setDescription] = useState("");
  const [base, setBase] = useState("");
  const model = useModelChoice("t2i");
  const [request, setRequest] = useState("");
  const [revised, setRevised] = useState("");
  const [working, setWorking] = useState<"" | "analyze" | "vary" | "make">("");
  const [error, setError] = useState("");
  const running = jobs.current !== null;

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  async function analyze() {
    setError("");
    if (!source) return setError("분석할 그림을 고르세요.");
    setWorking("analyze");
    try {
      const result = await api<{ description: string; prompt: string }>("POST", "/api/images/analyze", { path: source });
      setDescription(result.description);
      setBase(result.prompt);
      setRevised("");
    } catch (e) {
      fail(e, "그림을 분석하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  async function revise() {
    setError("");
    if (!base.trim()) return setError("프롬프트가 비어 있습니다. 먼저 그림을 분석하거나 직접 적으세요.");
    if (!request.trim()) return setError("바꿀 내용을 적어 주세요.");
    setWorking("vary");
    try {
      setRevised((await api<{ prompt: string }>("POST", "/api/images/vary", { prompt: base, request })).prompt);
    } catch (e) {
      fail(e, "프롬프트를 고치지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  async function make() {
    setError("");
    const text = (revised.trim() || base.trim());
    const number = Number(count);
    if (!text) return setError("만들 프롬프트가 없습니다.");
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    if (loras.some((lora) => lora.name.trim()) && model.id !== "krea2-turbo") return setError("이 모델은 LoRA를 적용하지 않습니다. LoRA를 끄거나 Krea 2 Turbo를 고르세요.");
    const [width, height] = size;
    const id = stamp();
    const extra = loraFields(loras);
    // One prompt, several pictures: every job picks its own seed.
    const items: MakeItem[] = Array.from({ length: number }, (_, index) => ({
      tool: model.tool,
      label: text,
      record: { kind: "image", prompt: text, ...extra.recipe, imageModel: model.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
      inputs: { prompt: text, width, height, ...extra.inputs, ...samplingInputs(model, index), output_path: `assets/images/var-${id}-${String(index + 1).padStart(2, "0")}.png` },
    }));
    setWorking("make");
    try {
      await startItems(project.id, withUpscale(items, upscale));
      notify(`${items.length}장을 차례로 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      fail(e, "작업을 시작하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  return (
    <section className="gen-card">
      <h3>그림을 분석해서 변주</h3>
      <span className="hint">그림을 하나 고르면 무엇이 그려져 있는지 읽고(약 1분) Krea용 프롬프트로 바꿉니다. 바꾸고 싶은 내용을 글로 적으면 그에 맞게 프롬프트를 고쳐 주고, 그 프롬프트로 여러 장을 만듭니다.</span>

      {model.picker}
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label="1. 그림 고르기" value={sources} max={1} onChange={setSources} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" type="button" disabled={!source || working !== "" || running} onClick={() => void analyze()} title={running ? "다른 작업이 끝난 뒤에 분석할 수 있습니다." : undefined}>
          <ScanSearch size={15} /> {working === "analyze" ? "분석하는 중..." : "분석하기"}
        </button>
      </div>

      {description && (
        <details style={{ marginTop: 12 }}>
          <summary>그림에서 읽은 내용 (영어)</summary>
          <p className="hint" style={{ whiteSpace: "pre-wrap" }}>{description}</p>
        </details>
      )}

      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="vary-base">2. 기본 프롬프트 (고칠 수 있습니다)</label>
          <textarea id="vary-base" rows={5} value={base} maxLength={7000} onChange={(event) => setBase(event.target.value)} placeholder="그림을 분석하면 여기에 프롬프트가 들어옵니다. 직접 적어도 됩니다." />
          <PromptLog projectId={project.id} stages={["image-analyze", "image-vary"]} refreshKey={working === "analyze" || working === "vary" ? 1 : 0} />
        </div>
        <div className="field wide">
          <label htmlFor="vary-request">3. 바꿀 내용</label>
          <textarea id="vary-request" rows={3} value={request} maxLength={2000} onChange={(event) => setRequest(event.target.value)} placeholder="예: 원피스를 연한 파란색 트렌치코트로, 머리는 짧은 단발로, 배경은 비 오는 저녁 거리로" />
          <div>
            <button className="btn" type="button" disabled={working !== ""} onClick={() => void revise()} title="적은 내용만 바꾸고 나머지는 그대로 둔 프롬프트를 새로 씁니다.">
              <PencilLine size={15} /> {working === "vary" ? "프롬프트를 고치는 중..." : "프롬프트 고치기"}
            </button>
          </div>
        </div>
        {revised && (
          <div className="field wide">
            <label htmlFor="vary-revised">4. 고친 프롬프트 (직접 더 고칠 수 있습니다)</label>
            <textarea id="vary-revised" rows={5} value={revised} maxLength={7000} onChange={(event) => setRevised(event.target.value)} />
          </div>
        )}
      </div>
      {options}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" type="button" disabled={working !== "" || running || !(revised.trim() || base.trim())} onClick={() => void make()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : revised.trim() ? "고친 프롬프트로 만듭니다." : "고친 프롬프트가 없어서 기본 프롬프트로 만듭니다 (시드만 다른 그림)."}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : "만들기"}
        </button>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

    </section>
  );
}
