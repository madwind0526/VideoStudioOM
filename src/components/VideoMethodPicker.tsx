import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { VideoMethod } from "../sections/mediaJobs";
import LoraPicker from "./LoraPicker";

type Method = "local" | "tiled";

/** The two ways a video is made; the advanced options of each open in a dialog (sampler values, extra LoRAs). */
export default function VideoMethodPicker({ value, fallback, onChange }: { value: VideoMethod; fallback: boolean; onChange: (value: VideoMethod) => void }) {
  const tiled = value.tiled ?? fallback;
  const [dialog, setDialog] = useState<Method | null>(null);
  const name = useId();
  const choices: { id: Method; label: string; on: boolean }[] = [
    { id: "local", label: "기본 Local 모델", on: !tiled },
    { id: "tiled", label: "Tiled Sampler (R2V 방식)", on: tiled },
  ];

  return (
    <div className="field wide">
      <label>만드는 방식</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px", alignItems: "center" }}>
      {choices.map((choice) => (
        <div key={choice.id} className="row" style={{ gap: 10, alignItems: "center" }}>
          <label className="row" style={{ gap: 6, cursor: "pointer" }}>
            <input type="radio" name={name} checked={choice.on} onChange={() => onChange({ ...value, tiled: choice.id === "tiled" })} /> {choice.label}
          </label>
          <button
            className="btn"
            type="button"
            onClick={() => {
              onChange({ ...value, tiled: choice.id === "tiled" });
              setDialog(choice.id);
            }}
          >
            <SlidersHorizontal size={14} /> 고급 옵션
          </button>
        </div>
      ))}
      </div>
      {dialog && <AdvancedDialog method={dialog} value={value} onChange={onChange} onClose={() => setDialog(null)} />}
    </div>
  );
}

const number = (text: string): number | undefined => (text.trim() === "" || !Number.isFinite(Number(text)) ? undefined : Number(text));

function AdvancedDialog({ method, value, onChange, onClose }: { method: Method; value: VideoMethod; onChange: (value: VideoMethod) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const tile = value.tile ?? {};
  const setTile = (patch: NonNullable<VideoMethod["tile"]>) => onChange({ ...value, tile: { ...tile, ...patch } });

  return (
    <div className="backdrop" style={{ zIndex: 80 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(560px, 100%)" }} role="dialog" aria-modal="true" aria-label="고급 옵션">
        <div className="modal-head">
          <h2>{method === "tiled" ? "Tiled Sampler (R2V 방식) 고급 옵션" : "기본 Local 모델 고급 옵션"}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="fields">
            {method === "local" ? (
              <div className="field">
                <label htmlFor="vm-steps">스텝 수</label>
                <input id="vm-steps" type="number" min={1} max={20} step={1} placeholder="4 (기본)" value={value.steps ?? ""} onChange={(event) => onChange({ ...value, steps: number(event.target.value) })} />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="vm-ts">1단계 스텝 수 (작은 크기)</label>
                  <input id="vm-ts" type="number" min={2} max={12} step={1} placeholder="6 (기본)" value={value.tiledSteps ?? ""} onChange={(event) => onChange({ ...value, tiledSteps: number(event.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="vm-fs">마지막 스텝 수 (타일)</label>
                  <input id="vm-fs" type="number" min={1} max={4} step={1} placeholder="1 (기본)" value={value.finalSteps ?? ""} onChange={(event) => onChange({ ...value, finalSteps: number(event.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="vm-tw">타일 가로</label>
                  <input id="vm-tw" type="number" min={256} step={32} placeholder="896 (기본)" value={tile.width ?? ""} onChange={(event) => setTile({ width: number(event.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="vm-th">타일 세로</label>
                  <input id="vm-th" type="number" min={256} step={32} placeholder="704 (기본)" value={tile.height ?? ""} onChange={(event) => setTile({ height: number(event.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="vm-ox">겹침 가로</label>
                  <input id="vm-ox" type="number" min={0} step={32} placeholder="256 (기본)" value={tile.overlapX ?? ""} onChange={(event) => setTile({ overlapX: number(event.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="vm-oy">겹침 세로</label>
                  <input id="vm-oy" type="number" min={0} step={32} placeholder="320 (기본)" value={tile.overlapY ?? ""} onChange={(event) => setTile({ overlapY: number(event.target.value) })} />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="vm-seed">시드</label>
              <input id="vm-seed" type="number" min={0} step={1} placeholder="비우면 무작위" value={value.seed ?? ""} onChange={(event) => onChange({ ...value, seed: number(event.target.value) })} />
            </div>
          </div>
          <p className="hint">{method === "tiled" ? "Pika LoRA로 작은 크기에서 1단계(기본 6스텝) → 2배 확대 → 마지막 스텝(기본 1스텝, 타일). 발표에서는 마지막 1스텝만으로 충분하다고 했습니다. 타일 크기는 VRAM에 맞춰 줄일 수 있습니다." : "기본은 4스텝 터보 LoRA 방식입니다."}</p>
          <LoraPicker button value={value.loras ?? []} onChange={(loras) => onChange({ ...value, loras })} />
        </div>
        <div className="modal-foot">
          <button className="btn primary" type="button" onClick={onClose}>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
