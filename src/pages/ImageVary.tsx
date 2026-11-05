import { FolderOpen, ScanSearch, Shuffle, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, ApiError, mediaUrl, type MediaFile } from "../api";
import FileNavigator from "../components/FileNavigator";
import PromptLog from "../components/PromptLog";
import { IMAGE_SIZES, type ImageSizeId } from "../imageSizes";
import { importImage, startItems, stamp, type MakeItem } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

/** What changes between the pictures ("seed" keeps the prompt and only the seed differs). */
const AXES = [
  { id: "seed", label: "시드만 (같은 프롬프트)" },
  { id: "outfit", label: "의상" },
  { id: "background", label: "배경" },
  { id: "time", label: "시간대·날씨" },
  { id: "pose", label: "자세·동작" },
  { id: "mood", label: "분위기" },
  { id: "style", label: "화풍" },
] as const;

/** Take a picture, let a vision model say what it shows, edit that as a prompt and make several variations of it. */
export default function ImageVary({ props, images }: { props: SectionProps; images: MediaFile[] }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const [source, setSource] = useState("");
  const [picking, setPicking] = useState(false);
  const [description, setDescription] = useState("");
  const [base, setBase] = useState("");
  const [axis, setAxis] = useState<(typeof AXES)[number]["id"]>("outfit");
  const [count, setCount] = useState("4");
  const [sizeId, setSizeId] = useState<ImageSizeId>("wide");
  const [prompts, setPrompts] = useState<string[]>([]);
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
      setPrompts([]);
    } catch (e) {
      fail(e, "그림을 분석하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  async function vary() {
    setError("");
    const number = Number(count);
    if (!base.trim()) return setError("프롬프트가 비어 있습니다. 먼저 그림을 분석하거나 직접 적으세요.");
    if (!Number.isInteger(number) || number < 1 || number > 12) return setError("장수는 1~12 사이로 입력하세요.");
    if (axis === "seed") return setPrompts(Array.from({ length: number }, () => base.trim()));
    setWorking("vary");
    try {
      setPrompts((await api<{ prompts: string[] }>("POST", "/api/images/vary", { prompt: base, axis, count: number })).prompts);
    } catch (e) {
      fail(e, "변주 프롬프트를 만들지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  async function make() {
    setError("");
    const list = prompts.map((text) => text.trim()).filter(Boolean);
    if (list.length === 0) return setError("만들 프롬프트가 없습니다.");
    const [width, height] = IMAGE_SIZES.find((item) => item.id === sizeId)!.size;
    const id = stamp();
    const items: MakeItem[] = list.map((text, index) => ({
      tool: "comfyui_krea_image",
      label: text,
      record: { kind: "image", prompt: text },
      inputs: { prompt: text, width, height, output_path: `assets/images/var-${id}-${String(index + 1).padStart(2, "0")}.png` },
    }));
    setWorking("make");
    try {
      await startItems(project.id, items);
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
      <span className="hint">그림을 하나 고르면 무엇이 그려져 있는지 읽고(약 1분) Krea용 프롬프트로 바꿉니다. 프롬프트를 고친 뒤, 한 가지만 바꾼 변주를 여러 장 만들 수 있습니다.</span>

      <div className="field wide" style={{ marginTop: 14 }}>
        <label>1. 그림 고르기</label>
        <div className="thumbs">
          {images.map((file) => (
            <button key={file.path} type="button" aria-pressed={source === file.path} title={file.path} className={source === file.path ? "picked" : undefined} onClick={() => setSource(file.path)}>
              <img src={mediaUrl(project.id, file.path, file.mtimeMs)} alt={file.path} loading="lazy" />
            </button>
          ))}
        </div>
        {images.length === 0 && <span className="muted">보관함에 그림이 없습니다. 파일에서 가져오거나 "만들기"에서 먼저 만드세요.</span>}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => setPicking(true)}>
            <FolderOpen size={15} /> 파일에서 가져오기
          </button>
          <button className="btn primary" type="button" disabled={!source || working !== "" || running} onClick={() => void analyze()} title={running ? "다른 작업이 끝난 뒤에 분석할 수 있습니다." : undefined}>
            <ScanSearch size={15} /> {working === "analyze" ? "분석하는 중..." : "분석하기"}
          </button>
        </div>
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
        <div className="field">
          <label htmlFor="vary-axis">3. 바꿀 것</label>
          <select id="vary-axis" value={axis} onChange={(event) => setAxis(event.target.value as typeof axis)}>
            {AXES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="vary-count">장수</label>
          <input id="vary-count" type="number" min={1} max={12} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="vary-size">크기</label>
          <select id="vary-size" value={sizeId} onChange={(event) => setSizeId(event.target.value as ImageSizeId)}>
            {IMAGE_SIZES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" type="button" disabled={working !== ""} onClick={() => void vary()}>
          <Shuffle size={15} /> {working === "vary" ? "변주를 쓰는 중..." : "변주 프롬프트 만들기"}
        </button>
      </div>

      {prompts.length > 0 && (
        <div className="field wide" style={{ marginTop: 14 }}>
          <label>4. 만들 프롬프트 ({prompts.length}개, 각각 고칠 수 있습니다)</label>
          {prompts.map((text, index) => (
            <textarea key={index} rows={3} value={text} maxLength={7000} aria-label={`변주 ${index + 1}`} onChange={(event) => setPrompts((list) => list.map((item, at) => (at === index ? event.target.value : item)))} />
          ))}
          <div>
            <button className="btn primary" type="button" disabled={working !== "" || running} onClick={() => void make()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
              <Sparkles size={16} /> {running ? "다른 작업 진행 중" : `${prompts.length}장 만들기`}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      {picking && (
        <FileNavigator
          title="이미지 가져오기"
          accept={[".png", ".jpg", ".jpeg", ".webp"]}
          projectId={project.id}
          onClose={() => setPicking(false)}
          onPick={(from) => {
            setPicking(false);
            importImage(project.id, from)
              .then((path) => {
                setSource(path);
                onJobsChanged();
                notify("그림을 보관함에 가져왔습니다.");
              })
              .catch((e) => fail(e, "그림을 가져오지 못했습니다."));
          }}
        />
      )}
    </section>
  );
}
