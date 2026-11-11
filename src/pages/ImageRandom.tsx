import { Dices, Download, Plus, Save, Shuffle, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import FileNavigator from "../components/FileNavigator";
import PromptLog from "../components/PromptLog";
import type { SectionProps } from "../sections/types";

interface Phrase {
  text: string;
  weight: number;
  /** Only for this gender (the text of a phrase of the gender category); missing: for every one. */
  for?: string;
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

/** A long phrase is shown cut short with "..."; the whole text is in the tooltip. */
const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);

/** With gender, age and hair categories the "인물" category (a whole person in one phrase) would contradict them: it starts as "쓰지 않음". */
const startChoice = (categories: Category[]): Record<string, string> => (categories.some((category) => category.id === "gender") && categories.some((category) => category.id === "person") ? { person: SKIP } : {});

/**
 * Pop-up of the make screen: prompts from random mixes of person, outfit, style, place, action and prop (the pool is a
 * file the user edits). The number of prompts is the number of pictures of the make screen. "저장" hands the prompts to the make
 * screen, where the LoRAs and the upscale are chosen and the pictures are made.
 */
export default function ImageRandom({ props, count, onSave, onClose }: { props: SectionProps; count: string; onSave: (prompts: string[]) => void; onClose: () => void }) {
  const { project, notify } = props;
  const [categories, setCategories] = useState<Category[]>([]);
  const [defaults, setDefaults] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Category[]>([]);
  const [joinOnly, setJoinOnly] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [working, setWorking] = useState<"" | "roll" | "compose" | "make" | "pool">("");
  const [error, setError] = useState("");
  const [browsing, setBrowsing] = useState(false);

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);
  const load = (data: { pool: { categories: Category[] }; defaults?: { categories: Category[] } }) => {
    setCategories(data.pool.categories);
    setDraft(data.pool.categories);
    if (data.defaults) setDefaults(data.defaults.categories);
    return data.pool.categories;
  };

  useEffect(() => {
    api<{ pool: { categories: Category[] }; defaults: { categories: Category[] } }>("GET", "/api/images/pool").then((data) => setChoice(startChoice(load(data)))).catch((e) => fail(e, "풀을 불러오지 못했습니다."));
  }, []);

  const used = (id: string) => choice[id] !== SKIP;
  // With a gender chosen by hand the lists only offer the phrases that fit it.
  const lockedGender = choice.gender && choice.gender !== RANDOM && choice.gender !== SKIP ? choice.gender : "";
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
      const { phrase } = await api<{ phrase: string }>("POST", "/api/images/random", { redo: { category, avoid: combinations[row]?.[category] ?? "", gender: combinations[row]?.gender ?? "" } });
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

  async function savePool(next: unknown = draft) {
    setError("");
    setWorking("pool");
    try {
      const saved = load(await api<{ pool: { categories: Category[] } }>("PUT", "/api/images/pool", { pool: next }));
      setChoice(startChoice(saved));
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

  async function importPool(path: string) {
    setError("");
    let parsed: unknown;
    try {
      // The file is read by the server (the app's own file browser picked it).
      parsed = JSON.parse((await api<{ text: string }>("GET", `/api/fs/text?path=${encodeURIComponent(path)}`)).text);
    } catch {
      return setError("JSON 파일을 읽지 못했습니다.");
    }
    if (window.confirm("지금 풀을 이 파일의 내용으로 바꿉니다. 계속할까요?")) await savePool(parsed);
  }

  const setCategory = (index: number, patch: Partial<Category>) => setDraft((list) => list.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  const setPhrase = (index: number, row: number, patch: Partial<Phrase>) => setCategory(index, { phrases: draft[index].phrases.map((item, at) => (at === row ? { ...item, ...patch } : item)) });

  const label = (id: string) => categories.find((category) => category.id === id)?.label ?? id;
  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" style={{ width: "min(900px, 100%)" }} role="dialog" aria-modal="true" aria-label="랜덤으로 만들기">
    <div className="modal-head">
      <h2>랜덤 프롬프트 만들기 ({count}개)</h2>
      <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
        <X size={18} />
      </button>
    </div>
    <div className="modal-body">
      <span className="hint">인물, 의상, 표정, 동작, 배경, 구도, 조명 같은 항목을 무작위로 섞어 그림을 만듭니다. 항목마다 "무작위", "쓰지 않음", 또는 늘 같은 문구로 정할 수 있습니다. 장수와 크기는 만들기 화면의 값을 씁니다. 성별·나이·머리 항목이 있으면 "인물" 항목은 처음에 "쓰지 않음"으로 시작합니다(서로 어긋나지 않게).</span>

      <div className="fields" style={{ marginTop: 14 }}>
        {categories.map(({ id, label: name, phrases }) => (
          <div className="field mix-field" key={id}>
            <label htmlFor={`mix-${id}`}>{name}</label>
            <select id={`mix-${id}`} value={choice[id] ?? RANDOM} onChange={(event) => setChoice((current) => ({ ...current, [id]: event.target.value }))}>
              <option value={RANDOM}>무작위</option>
              <option value={SKIP}>쓰지 않음</option>
              {phrases.filter((phrase) => !lockedGender || !phrase.for || phrase.for === lockedGender).map((phrase) => (
                <option key={phrase.text} value={phrase.text} title={phrase.text}>
                  {shorten(phrase.text, 40)}
                </option>
              ))}
            </select>
          </div>
        ))}
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
            <div key={row} className="combo-row">
              <strong>{row + 1}.</strong>
              <div className="combo-chips">
                {Object.entries(clip(combination)).map(([id, phrase]) => (
                  <button key={id} type="button" className="chip-btn" title={`${phrase}

(누르면 ${label(id)}만 다시 뽑습니다)`} onClick={() => void redo(row, id)}>
                    {label(id)}: {shorten(phrase, 60)}
                  </button>
                ))}
              </div>
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
          <span className="hint">마음에 들면 "저장"을 누르세요. 저장하면 창이 닫히고, 이미지 생성 화면에서 LoRA나 업스케일을 고른 뒤 "만들기"를 누릅니다.</span>
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
                <input type="text" aria-label="문구" value={phrase.text} maxLength={1000} onChange={(event) => setPhrase(index, row, { text: event.target.value })} style={{ flex: 1, minWidth: 0 }} />
                <select aria-label="어울리는 성별" title="어울리는 성별 (성별 항목을 쓸 때, 다른 성별의 조합에는 이 문구를 쓰지 않습니다)" value={phrase.for ?? ""} onChange={(event) => setPhrase(index, row, { for: event.target.value || undefined })} style={{ width: 76 }}>
                  <option value="">공통</option>
                  <option value="woman">여성</option>
                  <option value="man">남성</option>
                </select>
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
          <button className="btn" type="button" title="JSON 파일로 풀을 통째로 바꿉니다." onClick={() => setBrowsing(true)}>
            <Upload size={15} /> 가져오기
          </button>
        </div>
      </details>
    </div>
    <div className="modal-foot">
      <button className="btn" type="button" onClick={onClose}>
        취소
      </button>
      <button className="btn primary" type="button" disabled={working !== "" || prompts.filter((text) => text.trim()).length === 0} title={prompts.length === 0 ? "먼저 조합을 뽑고 프롬프트 만들기를 누르세요." : undefined} onClick={() => onSave(prompts.map((text) => text.trim()).filter(Boolean))}>
        <Save size={15} /> 저장
      </button>
    </div>
    </div>
    {browsing && (
      <FileNavigator
        title="풀 가져오기"
        accept={[".json"]}
        onClose={() => setBrowsing(false)}
        onPick={(path) => {
          setBrowsing(false);
          void importPool(path);
        }}
      />
    )}
    </div>
  );
}
