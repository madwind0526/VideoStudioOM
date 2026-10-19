import { ArrowDown, ArrowUp, X } from "lucide-react";
import { LLM_PROVIDERS } from "../../shared/settings.mjs";
import type { FieldDef } from "../fields";

interface Props {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  /** Shown next to the label, e.g. "기본값 따름" / "이 프로젝트만". */
  badge?: string;
  onReset?: () => void;
}

const numberOrRaw = (raw: string) => (raw === "" || Number.isNaN(Number(raw)) ? raw : Number(raw));

function ChainEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const move = (index: number, delta: number) => {
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  const unused = LLM_PROVIDERS.filter((provider) => !value.includes(provider));
  return (
    <div className="chain">
      {value.map((provider, index) => (
        <div key={provider} className="chain-row">
          <span className="chain-no">{index + 1}</span>
          <span className="chain-name">{provider}</span>
          <button type="button" className="icon-btn small" title="위로" disabled={index === 0} onClick={() => move(index, -1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="icon-btn small" title="아래로" disabled={index === value.length - 1} onClick={() => move(index, 1)}>
            <ArrowDown size={14} />
          </button>
          <button type="button" className="icon-btn small" title="빼기" disabled={value.length === 1} onClick={() => onChange(value.filter((item) => item !== provider))}>
            <X size={14} />
          </button>
        </div>
      ))}
      {unused.length > 0 && (
        <select aria-label="LLM 추가" value="" onChange={(event) => event.target.value && onChange([...value, event.target.value])}>
          <option value="">+ 추가</option>
          {unused.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function SettingField({ field, value, onChange, error, badge, onReset }: Props) {
  const id = `f-${field.path}`;
  let control;
  switch (field.kind) {
    case "select":
      control = (
        <select id={id} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "segmented":
      control = (
        <div className="seg" role="group" aria-label={field.label}>
          {field.options?.map((option) => (
            <button key={option.value} type="button" aria-pressed={String(value) === option.value} onClick={() => onChange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      );
      break;
    case "number":
      control = <input id={id} type="number" min={field.min} max={field.max} step={field.step} value={String(value ?? "")} onChange={(event) => onChange(numberOrRaw(event.target.value))} />;
      break;
    case "bool":
      control = (
        <label className="check">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /> 사용
        </label>
      );
      break;
    case "size": {
      const [width, height] = Array.isArray(value) ? (value as unknown[]) : ["", ""];
      control = (
        <div className="size">
          <input id={id} aria-label={`${field.label} 가로`} type="number" step={32} value={String(width)} onChange={(event) => onChange([numberOrRaw(event.target.value), height])} />
          <span>×</span>
          <input aria-label={`${field.label} 세로`} type="number" step={32} value={String(height)} onChange={(event) => onChange([width, numberOrRaw(event.target.value)])} />
        </div>
      );
      break;
    }
    case "chain":
      control = <ChainEditor value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />;
      break;
    default:
      control = <input id={id} type="text" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }

  return (
    <div className={field.wide ? "field wide" : "field"}>
      <label htmlFor={id}>
        {field.label}
        {badge && <span className="tag">{badge}</span>}
        {onReset && (
          <button type="button" className="link" onClick={onReset}>
            기본값으로
          </button>
        )}
      </label>
      {control}
      {error ? <span className="error">{error}</span> : field.hint && <span className="hint">{field.hint}</span>}
    </div>
  );
}
