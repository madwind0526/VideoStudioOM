import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { changedSampling, IMAGE_MODELS, modelsFor, SAMPLING_FIELDS } from "../../shared/imageModels.mjs";
import { api } from "../api";

export type Kind = "t2i" | "i2i" | "r2i";
type Values = Record<string, number | string>;

export interface ModelChoice {
  id: string;
  label: string;
  tool: string;
  /** How many pictures the model takes at most, and how the instruction names them ("tokens" <image1>, "plain" the first picture). */
  maxPictures: number;
  naming: "tokens" | "plain";
  /** Fixed tool inputs of the model (the model name of the shared T2I tool). */
  inputs: Record<string, string>;
  /** Sampling values that differ from the model's defaults (nothing when all are default), to put in the tool inputs. */
  sampling: Values;
  /** The seed of the first picture; the next ones add 1 (null: every picture draws its own). */
  seed: number | null;
  /** The element to show: the model list and its "고급" button. */
  picker: React.ReactNode;
}

const STORE = "imageModelChoice";
const read = (): { model: Record<string, string>; values: Record<string, Values> } => {
  try {
    return { model: {}, values: {}, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return { model: {}, values: {} };
  }
};
const write = (state: ReturnType<typeof read>) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // The choice is only remembered when the browser lets it.
  }
};

/** The model list of one tab ("모델 [목록] [고급]") and what it chose; the choice is remembered per tab and model. */
export function useModelChoice(kind: Kind): ModelChoice {
  const models = modelsFor(kind) as typeof IMAGE_MODELS;
  const [state, setState] = useState(read);
  const [open, setOpen] = useState(false);
  const model = models.find((item) => item.id === state.model[kind]) ?? models[0];
  const values = state.values[model.id] ?? {};

  const save = (next: typeof state) => {
    setState(next);
    write(next);
  };
  const sampling = changedSampling(model, values) as Values;
  const seed = values.seed === undefined || values.seed === "" ? null : Number(values.seed);

  const picker = (
    <div className="field" style={{ marginTop: 14 }}>
      <label htmlFor={`model-${kind}`}>모델</label>
      <div className="row" style={{ gap: 8 }}>
        <select id={`model-${kind}`} value={model.id} onChange={(event) => save({ ...state, model: { ...state.model, [kind]: event.target.value } })} style={{ flex: 1, minWidth: 0 }}>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <button className="btn" type="button" onClick={() => setOpen(true)} title="스텝, CFG, 샘플러, 스케줄러, 시드">
          <SlidersHorizontal size={15} /> 고급{Object.keys(sampling).length > 0 || seed !== null ? " ●" : ""}
        </button>
      </div>
      {open && <AdvancedDialog model={model} values={values} onChange={(next) => save({ ...state, values: { ...state.values, [model.id]: next } })} onClose={() => setOpen(false)} />}
    </div>
  );
  return { id: model.id, label: model.label, tool: model.tool, inputs: (model as { input?: Record<string, string> }).input ?? {}, maxPictures: (model as { maxPictures?: number }).maxPictures ?? 10, naming: (model as { naming?: "tokens" | "plain" }).naming ?? "tokens", sampling, seed, picker };
}

function AdvancedDialog({ model, values, onChange, onClose }: { model: (typeof IMAGE_MODELS)[number]; values: Values; onChange: (values: Values) => void; onClose: () => void }) {
  const [lists, setLists] = useState<{ samplers: string[]; schedulers: string[] }>({ samplers: [], schedulers: [] });
  useEffect(() => {
    api<{ samplers: string[]; schedulers: string[] }>("GET", "/api/comfy/models").then((data) => setLists({ samplers: data.samplers ?? [], schedulers: data.schedulers ?? [] })).catch(() => undefined);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const defaults = model.defaults as Values;
  const set = (key: string, value: number | string) => onChange({ ...values, [key]: value });
  const show = (key: string) => values[key] ?? defaults[key];

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true" aria-label={`${model.label} 고급 설정`}>
        <div className="modal-head">
          <h2>{model.label} · 고급</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <span className="hint">{model.note}</span>
          <div className="fields" style={{ marginTop: 12 }}>
            {SAMPLING_FIELDS.filter((field) => model.fields.includes(field.key)).map((field) => (
              <div className="field" key={field.key}>
                <label htmlFor={`adv-${field.key}`}>
                  {field.label} <span className="muted">(기본 {String(defaults[field.key])})</span>
                </label>
                {field.type === "int" || field.type === "float" ? (
                  <input id={`adv-${field.key}`} type="number" min={field.min} max={field.max} step={field.step} value={show(field.key)} onChange={(event) => set(field.key, event.target.value === "" ? defaults[field.key] : Number(event.target.value))} />
                ) : (
                  <select id={`adv-${field.key}`} value={String(show(field.key))} onChange={(event) => set(field.key, event.target.value)}>
                    {[...new Set([String(defaults[field.key]), ...(field.type === "sampler" ? lists.samplers : lists.schedulers)])].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            <div className="field">
              <label htmlFor="adv-seed">
                시드 <span className="muted">(비우면 장마다 무작위)</span>
              </label>
              <input id="adv-seed" type="number" min={0} step={1} placeholder="무작위" value={values.seed ?? ""} onChange={(event) => onChange({ ...values, seed: event.target.value === "" ? "" : Math.floor(Math.abs(Number(event.target.value))) })} />
              <span className="hint">값을 넣으면 첫 장은 그 값, 다음 장은 +1, +2로 만들어서 같은 설정으로 다시 만들 수 있습니다.</span>
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={() => onChange({})} title="스텝, CFG, 샘플러, 스케줄러, 시드를 모두 기본값으로 되돌립니다.">
            기본값으로
          </button>
          <button className="btn primary" type="button" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

/** The tool inputs of picture number `index` (0, 1, ...) of a run: the changed sampling values and, when a seed is set, its seed. */
export const samplingInputs = (choice: ModelChoice, index: number): Record<string, unknown> => ({ ...choice.inputs, ...choice.sampling, ...(choice.seed !== null ? { seed: choice.seed + index } : {}) });
