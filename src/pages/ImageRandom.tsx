import { Dices, Download, Plus, Save, Shuffle, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import PromptLog from "../components/PromptLog";
import { IMAGE_SIZES, type ImageSizeId } from "../imageSizes";
import { loraFields } from "../components/LoraPicker";
import { startItems, stamp, withUpscale, type MakeItem, type SceneLora } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

interface Phrase {
  text: string;
  weight: number;
}
interface Category {
  /** Empty for a category added on the screen: the server gives it one when the pool is saved. */
  id: string;
  label: string;
  phrases: Phrase[];
}
type Combination = Record<string, string>;

/** For each category: random, left out, or always the same phrase. */
const RANDOM = "";
const SKIP = "__skip__";

/** Pictures from random mixes of person, outfit, style, place, action and prop (the pool is a file the user edits). */
export default function ImageRandom({ props, loras, upscale }: { props: SectionProps; loras: SceneLora[]; upscale: number }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaults, setDefaults] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Category[]>([]);
  const [joinOnly, setJoinOnly] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [count, setCount] = useState("4");
  const [sizeId, setSizeId] = useState<ImageSizeId>("wide");
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [working, setWorking] = useState<"" | "roll" | "compose" | "make" | "pool">("");
  const [error, setError] = useState("");
  const running = jobs.current !== null;

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);
  const load = (data: { pool: { categories: Category[] }; defaults?: { categories: Category[] } }) => {
    setCategories(data.pool.categories);
    setDraft(data.pool.categories);
    if (data.defaults) setDefaults(data.defaults.categories);
  };

  useEffect(() => {
    api<{ pool: { categories: Category[] }; defaults: { categories: Category[] } }>("GET", "/api/images/pool").then(load).catch((e) => fail(e, "풀을 불러오지 못했습니다."));
  }, []);

  const used = (id: string) => choice[id] !== SKIP;
  const clip = (combination: Combination): Combination => Object.fromEntries(Object.entries(combination).filter(([id]) => used(id)));

  async function roll() {
    setError("");
    const number = Number(count);
    if (!Number.isInteger(number) || number < 1 || number > 24) return setError("장수는 1~24 사이로 입력하세요.");
    const locked = Object.fromEntries(Object.entries(choice).filter(([, value]) => value !== RANDOM && value !== SKIP));
    setWorking("roll");
    try {
      setCombinations((await api<{ combinations: Combination[] }>("POST", "/api/images/random", { count: number, locked })).combinations);
      setPrompts([]);
    } catch (e) {
      fail(e, "조합을 뽑지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  async function redo(row: number, category: string) {
    try {
      const { phrase } = await api<{ phrase: string }>("POST", "/api/images/random", { redo: { category, avoid: combinations[row]?.[category] ?? "" } });
      setCombinations((list) => list.map((item, at) => (at === row ? { ...item, [category]: phrase } : item)));
      setPrompts([]);
    } catch (e) {
      fail(e, "다시 뽑지 못했습니다.");
    }
  }

  async function compose() {
    setError("");
    if (combinations.length === 0) return setError("먼저 조합을 뽑으세요.");
    if (joinOnly) {
      // As they are: the chosen phrases of every category, in the order of the categories.
      return setPrompts(combinations.map(clip).map((combination) => categories.map(({ id }) => combination[id]).filter(Boolean).join(", ")));
    }
    setWorking("compose");
    try {
      setPrompts((await api<{ prompts: string[] }>("POST", "/api/images/compose", { combinations: combinations.map(clip) })).prompts);
    } catch (e) {
      fail(e, "프롬프트를 만들지 못했습니다.");
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
    const extra = loraFields(loras);
    const items: MakeItem[] = list.map((text, index) => ({
      tool: "comfyui_krea_image",
      label: text,
      record: { kind: "image", prompt: text, ...extra.recipe },
      inputs: { prompt: text, width, height, ...extra.inputs, output_path: `assets/images/mix-${id}-${String(index + 1).padStart(2, "0")}.png` },
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

  async function savePool(next: unknown = draft) {
    setError("");
    setWorking("pool");
    try {
      load(await api<{ pool: { categories: Category[] } }>("PUT", "/api/images/pool", { pool: next }));
      setChoice({});
      setCombinations([]);
      setPrompts([]);
      notify("풀을 저장했습니다.");
    } catch (e) {
      fail(e, "풀을 저장하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  function exportPool() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`${JSON.stringify({ categories }, null, 2)}\n`], { type: "application/json" }));
    link.download = "image-pool.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importPool(file: File | undefined) {
    if (!file) return;
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
    } catch {
      return setError("JSON 파일을 읽지 못했습니다.");
    }
    if (window.confirm("지금 풀을 이 파일의 내용으로 바꿉니다. 계속할까요?")) await savePool(parsed);
  }

  const setCategory = (index: number, patch: Partial<Category>) => setDraft((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const setPhrase = (index: number, row: number, patch: Partial<Phrase>) => setCategory(index, { phrases: draft[index].phrases.map((item, at) => (at === row ? { ...item, ...patch } : item)) });

  const label = (id: string) => categories.find((category) => category.id === id)?.label ?? id;
  return (
    <section className="gen-card">
      <h3>랜덤 조합</h3>
      <span className="hint">인물, 의상, 화풍, 배경, 동작, 소품을 무작위로 섞어 그림을 만듭니다. 항목마다 "무작위", "쓰지 않음", 또는 늘 같은 문구로 정할 수 있습니다.</span>

      <div className="fields" style={{ marginTop: 14 }}>
        {categories.map(({ id, label: name, phrases }) => (
          <div className="field" key={id}>
            <label htmlFor={`mix-${id}`}>{name}</label>
            <select id={`mix-${id}`} value={choice[id] ?? RANDOM} onChange={(event) => setChoice((current) => ({ ...current, [id]: event.target.value }))}>
              <option value={RANDOM}>무작위</option>
              <option value={SKIP}>쓰지 않음</option>
              {phrases.map((phrase) => (
                <option key={phrase.text} value={phrase.text}>
                  {phrase.text}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="field">
          <label htmlFor="mix-count">장수</label>
          <input id="mix-count" type="number" min={1} max={24} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mix-size">크기</label>
          <select id="mix-size" value={sizeId} onChange={(event) => setSizeId(event.target.value as ImageSizeId)}>
            {IMAGE_SIZES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" disabled={working !== ""} onClick={() => void roll()}>
          <Dices size={15} /> {combinations.length ? "다시 뽑기" : "조합 뽑기"}
        </button>
        <button className="btn" type="button" disabled={working !== "" || combinations.length === 0} onClick={() => void compose()}>
          <Shuffle size={15} /> {working === "compose" ? "프롬프트를 쓰는 중..." : joinOnly ? "문구 그대로 합치기" : "프롬프트 만들기"}
        </button>
        <label className="row" style={{ gap: 6 }} title="끄면 뽑은 문구를 그대로 쉼표로 이어 붙입니다. 켜면 LLM이 한 문단의 영어 프롬프트로 다듬습니다.">
          <input type="checkbox" checked={!joinOnly} onChange={(event) => setJoinOnly(!event.target.checked)} /> LLM으로 다듬기
        </label>
      </div>

      {combinations.length > 0 && (
        <div className="field wide" style={{ marginTop: 14 }}>
          <label>뽑은 조합 (문구를 누르면 그 항목만 다시 뽑습니다)</label>
          {combinations.map((combination, row) => (
            <div key={row} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <strong>{row + 1}.</strong>
              {Object.entries(clip(combination)).map(([id, phrase]) => (
                <button key={id} type="button" className="chip-btn" title={`${label(id)}만 다시 뽑기`} onClick={() => void redo(row, id)}>
                  {label(id)}: {phrase}
                </button>
              ))}
            </div>
          ))}
          <PromptLog projectId={project.id} stages={["image-compose"]} refreshKey={working === "compose" ? 1 : 0} />
        </div>
      )}

      {prompts.length > 0 && (
        <div className="field wide" style={{ marginTop: 14 }}>
          <label>만들 프롬프트 ({prompts.length}개, 각각 고칠 수 있습니다)</label>
          {prompts.map((text, index) => (
            <textarea key={index} rows={3} value={text} maxLength={7000} aria-label={`조합 ${index + 1}`} onChange={(event) => setPrompts((list) => list.map((item, at) => (at === index ? event.target.value : item)))} />
          ))}
          <div>
            <button className="btn primary" type="button" disabled={working !== "" || running} onClick={() => void make()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
              <Sparkles size={16} /> {running ? "다른 작업 진행 중" : `${prompts.length}장 만들기`}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      <details style={{ marginTop: 18 }}>
        <summary>풀 고치기 (항목과 문구를 더하고 빼고 고칩니다)</summary>
        <span className="hint">가중치는 뽑힐 확률의 비율입니다 (기본 1, 0이면 무작위로는 뽑히지 않고 직접 고를 때만 씁니다).</span>
        {draft.map((category, index) => (
          <div className="field wide" key={category.id || `new-${index}`} style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 6 }}>
              <input type="text" aria-label="항목 이름" value={category.label} maxLength={20} onChange={(event) => setCategory(index, { label: event.target.value })} style={{ width: 160 }} />
              <button className="icon-btn" type="button" aria-label="항목 지우기" title="이 항목을 지웁니다 (저장해야 적용됩니다)" onClick={() => setDraft((list) => list.filter((_, at) => at !== index))}>
                <Trash2 size={15} />
              </button>
            </div>
            {category.phrases.map((phrase, row) => (
              <div className="lora-row" key={row}>
                <input type="text" aria-label="문구" value={phrase.text} maxLength={200} onChange={(event) => setPhrase(index, row, { text: event.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <input type="number" aria-label="가중치" title="가중치" min={0} max={100} step={0.5} value={phrase.weight} onChange={(event) => setPhrase(index, row, { weight: Number(event.target.value) })} />
                <button className="icon-btn" type="button" aria-label="문구 지우기" onClick={() => setCategory(index, { phrases: category.phrases.filter((_, at) => at !== row) })}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div>
              <button className="btn" type="button" onClick={() => setCategory(index, { phrases: [...category.phrases, { text: "", weight: 1 }] })}>
                <Plus size={15} /> 문구 추가
              </button>
            </div>
          </div>
        ))}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => setDraft((list) => [...list, { id: "", label: "새 항목", phrases: [{ text: "", weight: 1 }] }])}>
            <Plus size={15} /> 항목 추가
          </button>
          <button className="btn primary" type="button" disabled={working !== ""} onClick={() => void savePool()}>
            <Save size={15} /> 풀 저장
          </button>
          <button className="btn" type="button" disabled={working !== ""} onClick={() => setDraft(defaults)} title="기본 항목과 문구를 칸에 채웁니다. 저장해야 적용됩니다.">
            기본값으로 채우기
          </button>
          <button className="btn" type="button" onClick={exportPool} title="저장된 풀을 JSON 파일로 내려받습니다.">
            <Download size={15} /> 내보내기
          </button>
          <label className="btn" title="JSON 파일로 풀을 통째로 바꿉니다.">
            <Upload size={15} /> 가져오기
            <input type="file" accept=".json,application/json" hidden onChange={(event) => { void importPool(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
        </div>
      </details>
    </section>
  );
}
