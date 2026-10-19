import { FolderOpen, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import FileNavigator from "./FileNavigator";

export const ENGINE_PATHS = [
  "engine.image.workflowT2I",
  "engine.image.workflowI2I",
  "engine.image.diffusion",
  "engine.image.textEncoder",
  "engine.image.vae",
  "engine.image.loras",
  "engine.video.workflowT2V",
  "engine.video.workflowI2V",
  "engine.video.workflowR2V",
  "engine.video.diffusion",
  "engine.video.textEncoder",
  "engine.video.vae",
  "engine.video.loras",
  "engine.upscale.model",
];

interface Lora {
  name: string;
  strength: number;
}
interface Models {
  diffusion: string[];
  textEncoder: string[];
  vae: string[];
  loras: string[];
  upscale: string[];
}
interface Check {
  ok: boolean;
  problems: string[];
  nodeCount?: number;
  imageInputs?: number;
  videoInputs?: number;
  audioInputs?: number;
}
interface Props {
  get: (path: string) => unknown;
  set: (path: string, value: unknown) => void;
  errors: Record<string, string>;
}

/** Advanced engine options: workflow files, model names, LoRAs and the upscaler. Empty means the built-in one. */
export default function EngineSettings({ get, set, errors }: Props) {
  const [models, setModels] = useState<Models | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, Check | "busy">>({});

  useEffect(() => {
    api<Models>("GET", "/api/comfy/models").then(setModels).catch(() => {});
  }, []);

  const text = (path: string) => String(get(path) ?? "");

  async function check(path: string) {
    setChecks((all) => ({ ...all, [path]: "busy" }));
    try {
      const result = await api<Check>("POST", "/api/workflows/check", { path: text(path) });
      setChecks((all) => ({ ...all, [path]: result }));
    } catch (e) {
      setChecks((all) => ({ ...all, [path]: { ok: false, problems: [e instanceof ApiError ? e.message : "확인하지 못했습니다."] } }));
    }
  }

  const workflowRow = (path: string, label: string, hint: string) => {
    const value = text(path);
    const result = checks[path];
    return (
      <div className="field wide" key={path}>
        <label htmlFor={path}>{label}</label>
        <div className="row" style={{ gap: 8 }}>
          <input id={path} type="text" value={value} placeholder={hint} onChange={(event) => set(path, event.target.value)} style={{ flex: 1 }} />
          <button className="btn" type="button" onClick={() => setPicking(path)}>
            <FolderOpen size={15} /> 찾아보기
          </button>
          <button className="btn" type="button" disabled={!value || result === "busy"} onClick={() => void check(path)}>
            {result === "busy" ? "확인 중..." : "확인"}
          </button>
          {value && (
            <button className="icon-btn" type="button" aria-label="기본 워크플로로" title="비우기 (기본 워크플로)" onClick={() => set(path, "")}>
              <X size={16} />
            </button>
          )}
        </div>
        {errors[path] && <span className="error">{errors[path]}</span>}
        {result && result !== "busy" && (
          <span className={result.ok ? "folder-status ok" : "folder-status warn"}>
            {result.ok
              ? `✓ 사용할 수 있습니다 (노드 ${result.nodeCount}개 · 이미지 입력 ${result.imageInputs} · 영상 입력 ${result.videoInputs} · 오디오 입력 ${result.audioInputs})`
              : result.problems.map((problem) => `⚠ ${problem}`).join(" ")}
          </span>
        )}
      </div>
    );
  };

  const modelRow = (path: string, label: string, options: string[] | undefined) => (
    <div className="field" key={path}>
      <label htmlFor={path}>{label}</label>
      <input id={path} type="text" list={`${path}-list`} value={text(path)} placeholder="워크플로에 들어 있는 모델" onChange={(event) => set(path, event.target.value)} />
      <datalist id={`${path}-list`}>{options?.map((name) => <option key={name} value={name} />)}</datalist>
      {errors[path] && <span className="error">{errors[path]}</span>}
    </div>
  );

  const loraRows = (path: string) => {
    const list = (get(path) as Lora[] | undefined) ?? [];
    const update = (index: number, patch: Partial<Lora>) => set(path, list.map((lora, i) => (i === index ? { ...lora, ...patch } : lora)));
    return (
      <div className="field wide" key={path}>
        <label>LoRA</label>
        {list.map((lora, index) => (
          <div className="row" style={{ gap: 8, marginBottom: 6 }} key={index}>
            <input type="text" list="engine-lora-list" aria-label="LoRA 이름" value={lora.name} placeholder="LoRA 파일 이름" onChange={(event) => update(index, { name: event.target.value })} style={{ flex: 1 }} />
            <input type="number" aria-label="강도" step={0.05} min={-4} max={4} value={lora.strength} onChange={(event) => update(index, { strength: Number(event.target.value) })} style={{ width: 90 }} />
            <button className="icon-btn" type="button" aria-label="LoRA 지우기" onClick={() => set(path, list.filter((_, i) => i !== index))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <div>
          <button className="btn" type="button" disabled={list.length >= 8} onClick={() => set(path, [...list, { name: "", strength: 1 }])}>
            <Plus size={15} /> LoRA 추가
          </button>
        </div>
        {errors[path] && <span className="error">{errors[path]}</span>}
      </div>
    );
  };

  return (
    <>
      <datalist id="engine-lora-list">{models?.loras.map((name) => <option key={name} value={name} />)}</datalist>
      <h3 className="sub-head">이미지</h3>
      <div className="fields">
        {workflowRow("engine.image.workflowT2I", "T2I 워크플로", "비워 두면 기본(Krea 2 Turbo)")}
        {workflowRow("engine.image.workflowI2I", "I2I 워크플로", "비워 두면 기본 워크플로")}
        {modelRow("engine.image.diffusion", "diffusion 모델", models?.diffusion)}
        {modelRow("engine.image.textEncoder", "text encoder", models?.textEncoder)}
        {modelRow("engine.image.vae", "VAE", models?.vae)}
        {loraRows("engine.image.loras")}
      </div>
      <h3 className="sub-head">영상</h3>
      <div className="fields">
        {workflowRow("engine.video.workflowT2V", "T2V 워크플로", "비워 두면 기본(MiniMax H3)")}
        {workflowRow("engine.video.workflowI2V", "I2V 워크플로 (FL2V·S2V 포함)", "비워 두면 기본(MiniMax H3)")}
        {workflowRow("engine.video.workflowR2V", "R2V 워크플로", "비워 두면 기본(MiniMax H3 R2V)")}
        {modelRow("engine.video.diffusion", "diffusion 모델", models?.diffusion)}
        {modelRow("engine.video.textEncoder", "text encoder", models?.textEncoder)}
        {modelRow("engine.video.vae", "VAE", models?.vae)}
        {loraRows("engine.video.loras")}
      </div>
      <h3 className="sub-head">업스케일</h3>
      <div className="fields">{modelRow("engine.upscale.model", "업스케일 모델", models?.upscale)}</div>
      {picking && (
        <FileNavigator
          title="워크플로 선택"
          accept={[".json"]}
          start={text(picking)}
          onClose={() => setPicking(null)}
          onPick={(file) => {
            set(picking, file);
            setChecks((all) => ({ ...all, [picking]: undefined as never }));
            setPicking(null);
          }}
        />
      )}
    </>
  );
}
