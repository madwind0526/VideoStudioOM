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

/** Rows of LoRA name and strength, added after the LoRAs of the settings. */
export default function LoraPicker({ value, onChange }: { value: SceneLora[]; onChange: (next: SceneLora[]) => void }) {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    api<{ loras: string[] }>("GET", "/api/comfy/models").then((data) => setNames(data.loras)).catch(() => {});
  }, []);
  const update = (index: number, patch: Partial<SceneLora>) => onChange(value.map((lora, i) => (i === index ? { ...lora, ...patch } : lora)));

  return (
    <div className="field wide">
      <label>LoRA (설정의 LoRA에 더해 적용, 최대 {MAX_LORAS}개)</label>
      {value.map((lora, index) => (
        <div className="lora-row" key={index}>
          <input type="text" list="image-lora-list" aria-label="LoRA 이름" value={lora.name} placeholder="LoRA 파일 이름" onChange={(event) => update(index, { name: event.target.value })} style={{ flex: 1, minWidth: 0 }} />
          <input type="number" aria-label="강도" title="강도(가중치)" step={0.05} min={-4} max={4} value={lora.strength} onChange={(event) => update(index, { strength: Number(event.target.value) })} />
          <button className="icon-btn" type="button" aria-label="LoRA 지우기" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            <X size={15} />
          </button>
        </div>
      ))}
      <div>
        <button className="btn" type="button" disabled={value.length >= MAX_LORAS} onClick={() => onChange([...value, { name: "", strength: 1 }])}>
          <Plus size={15} /> LoRA 추가
        </button>
      </div>
      <datalist id="image-lora-list">{names.map((name) => <option key={name} value={name} />)}</datalist>
    </div>
  );
}
