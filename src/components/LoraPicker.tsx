import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { SceneLora } from "../sections/mediaJobs";

export const MAX_LORAS = 4;

/** What a LoRA list adds to a make call: the recipe field and the tool input (both empty when no LoRA has a name). */
export function loraFields(loras: SceneLora[]): { recipe: { loras?: SceneLora[] }; inputs: { extra_loras?: SceneLora[] } } {
  const chosen = loras.filter((lora) => lora.name.trim());
  return chosen.length ? { recipe: { loras: chosen }, inputs: { extra_loras: chosen } } : { recipe: {}, inputs: {} };
}

/** A check box; checked, rows of LoRA (chosen from the installed ones) and strength, each with + (a row below) and X (remove). Added after the LoRAs of the settings. */
export default function LoraPicker({ value, onChange }: { value: SceneLora[]; onChange: (next: SceneLora[]) => void }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    api<{ loras: string[] }>("GET", "/api/comfy/models").then((data) => setNames(data.loras)).catch(() => {});
  }, []);
  const update = (index: number, patch: Partial<SceneLora>) => onChange(value.map((lora, i) => (i === index ? { ...lora, ...patch } : lora)));
  const add = (after: number) => onChange([...value.slice(0, after + 1), { name: "", strength: 1 }, ...value.slice(after + 1)]);

  return (
    <div className="field wide">
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={value.length > 0} onChange={(event) => onChange(event.target.checked ? [{ name: "", strength: 1 }] : [])} />
        LoRA 사용 (설정의 LoRA에 더해 적용, 최대 {MAX_LORAS}개)
      </label>
      {value.map((lora, index) => (
        <div className="lora-row" key={index}>
          <select aria-label="LoRA 이름" value={lora.name} onChange={(event) => update(index, { name: event.target.value })} style={{ flex: 1, minWidth: 0 }}>
            <option value="">LoRA를 고르세요</option>
            {lora.name && !names.includes(lora.name) && <option value={lora.name}>{lora.name}</option>}
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input type="number" aria-label="강도" title="강도(가중치)" step={0.05} min={-4} max={4} value={lora.strength} onChange={(event) => update(index, { strength: Number(event.target.value) })} />
          <button className="icon-btn" type="button" aria-label="아래에 LoRA 추가" title="아래에 하나 더 추가" disabled={value.length >= MAX_LORAS} onClick={() => add(index)}>
            <Plus size={15} />
          </button>
          <button className="icon-btn" type="button" aria-label="LoRA 지우기" title="이 LoRA 빼기" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
