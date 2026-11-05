import { Dices, Save, Shuffle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import PromptLog from "../components/PromptLog";
import { IMAGE_SIZES, type ImageSizeId } from "../imageSizes";
import { startItems, stamp, type MakeItem } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

interface Category {
  id: string;
  label: string;
}
type Pool = Record<string, string[]>;
type Combination = Record<string, string>;

/** For each category: random, left out, or always the same phrase. */
const RANDOM = "";
const SKIP = "__skip__";

/** Pictures from random mixes of person, outfit, style, place, action and prop (the pool is a file the user edits). */
export default function ImageRandom({ props }: { props: SectionProps }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const [pool, setPool] = useState<Pool>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaults, setDefaults] = useState<Pool>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [count, setCount] = useState("4");
  const [sizeId, setSizeId] = useState<ImageSizeId>("wide");
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<"" | "roll" | "compose" | "make" | "pool">("");
  const [error, setError] = useState("");
  const running = jobs.current !== null;

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);
  const toEditing = (next: Pool) => Object.fromEntries(Object.entries(next).map(([id, list]) => [id, list.join("\n")]));

  useEffect(() => {
    api<{ pool: Pool; categories: Category[]; defaults: Pool }>("GET", "/api/images/pool")
      .then((data) => {
        setPool(data.pool);
        setCategories(data.categories);
        setDefaults(data.defaults);
        setEditing(toEditing(data.pool));
      })
      .catch((e) => fail(e, "풀을 불러오지 못했습니다."));
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
    const items: MakeItem[] = list.map((text, index) => ({
      tool: "comfyui_krea_image",
      label: text,
      record: { kind: "image", prompt: text },
      inputs: { prompt: text, width, height, output_path: `assets/images/mix-${id}-${String(index + 1).padStart(2, "0")}.png` },
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

  async function savePool() {
    setError("");
    const next = Object.fromEntries(categories.map(({ id }) => [id, (editing[id] ?? "").split("\n").map((line) => line.trim()).filter(Boolean)]));
    setWorking("pool");
    try {
      const saved = (await api<{ pool: Pool }>("PUT", "/api/images/pool", { pool: next })).pool;
      setPool(saved);
      setEditing(toEditing(saved));
      notify("풀을 저장했습니다.");
    } catch (e) {
      fail(e, "풀을 저장하지 못했습니다.");
    } finally {
      setWorking("");
    }
  }

  const label = (id: string) => categories.find((category) => category.id === id)?.label ?? id;
  return (
    <section className="gen-card">
      <h3>랜덤 조합</h3>
      <span className="hint">인물, 의상, 화풍, 배경, 동작, 소품을 무작위로 섞어 그림을 만듭니다. 항목마다 "무작위", "쓰지 않음", 또는 늘 같은 문구로 정할 수 있습니다.</span>

      <div className="fields" style={{ marginTop: 14 }}>
        {categories.map(({ id, label: name }) => (
          <div className="field" key={id}>
            <label htmlFor={`mix-${id}`}>{name}</label>
            <select id={`mix-${id}`} value={choice[id] ?? RANDOM} onChange={(event) => setChoice((current) => ({ ...current, [id]: event.target.value }))}>
              <option value={RANDOM}>무작위</option>
              <option value={SKIP}>쓰지 않음</option>
              {(pool[id] ?? []).map((phrase) => (
                <option key={phrase} value={phrase}>
                  {phrase}
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
          <Shuffle size={15} /> {working === "compose" ? "프롬프트를 쓰는 중..." : "프롬프트 만들기"}
        </button>
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
        <summary>풀 고치기 (한 줄에 문구 하나)</summary>
        <div className="fields" style={{ marginTop: 10 }}>
          {categories.map(({ id, label: name }) => (
            <div className="field wide" key={id}>
              <label htmlFor={`pool-${id}`}>{name}</label>
              <textarea id={`pool-${id}`} rows={5} value={editing[id] ?? ""} onChange={(event) => setEditing((current) => ({ ...current, [id]: event.target.value }))} />
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn" type="button" disabled={working !== ""} onClick={() => void savePool()}>
            <Save size={15} /> 풀 저장
          </button>
          <button className="btn" type="button" disabled={working !== ""} onClick={() => setEditing(toEditing(defaults))} title="기본 문구를 칸에 채웁니다. 저장해야 적용됩니다.">
            기본 문구로 채우기
          </button>
        </div>
      </details>
    </section>
  );
}
