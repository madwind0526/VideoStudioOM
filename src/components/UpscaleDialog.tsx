import { Maximize2, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, type Job, type MediaFile } from "../api";
import { defaultUpscaleModel, UPSCALE_WORKFLOWS } from "../../shared/upscale.mjs";
import { recipeOf, startItems, upscaleItem, type UpscaleHow } from "../sections/mediaJobs";

const SCALES = [1.5, 2, 3, 4];

interface Props {
  projectId?: string;
  file?: MediaFile;
  /** The running job and the finished ones (the progress and the result are read from them). */
  jobs?: { current: Job | null; history: Job[] };
  notify?: (text: string) => void;
  onJobsChanged?: () => void;
  onClose: () => void;
  /** Without a picture: the pop-up only chooses how to enlarge (the make screens) and hands the choice over with "확인". */
  onChoose?: (how: UpscaleHow) => void;
  initial?: UpscaleHow | null;
}

const NO_JOBS = { current: null, history: [] };

/**
 * Pop-up to choose the workflow, its model and the scale. For one picture (`file`) it starts the enlargement and follows the
 * progress; the result becomes a new version of the picture. With `onChoose` it only returns the choice.
 */
export default function UpscaleDialog({ projectId = "", file, jobs = NO_JOBS, notify = () => undefined, onJobsChanged = () => undefined, onClose, onChoose, initial }: Props) {
  const [workflow, setWorkflow] = useState<string>(initial?.workflow ?? "rtx");
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [model, setModel] = useState(initial?.model ?? "");
  const entry = UPSCALE_WORKFLOWS.find((item) => item.id === workflow) ?? UPSCALE_WORKFLOWS[0];
  const names = choices[workflow] ?? [];
  const [scale, setScale] = useState(String(initial?.scale ?? 2));
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const running = jobs.current !== null && !output;

  useEffect(() => {
    api<{ upscaleChoices: Record<string, string[]> }>("GET", "/api/comfy/models")
      .then((data) => {
        setChoices(data.upscaleChoices);
        setModel((current) => current || defaultUpscaleModel(workflow, data.upscaleChoices[workflow] ?? []));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mine = output ? (jobs.current?.meta.output === output ? jobs.current : jobs.history.find((job) => job.meta.output === output)) : undefined;
  const percent = mine?.progress && mine.progress.max > 0 ? Math.round((mine.progress.value / mine.progress.max) * 100) : 0;
  const state = !output ? "form" : mine?.status === "done" ? "done" : mine?.status && mine.status !== "running" ? "failed" : "running";

  async function start() {
    setError("");
    if (!entry.fixed && !model) return setError(`${entry.modelLabel}이(가) ComfyUI에 보이지 않습니다.`);
    const factor = Number(scale);
    if (!(factor >= 1 && factor <= 4)) return setError("배율은 1~4 사이로 입력하세요.");
    if (onChoose || !file) {
      onChoose?.({ scale: factor, workflow: workflow as UpscaleHow["workflow"], model });
      return onClose();
    }
    const item = upscaleItem(file.path, recipeOf(file.record) ?? { kind: "image", prompt: "" }, factor, { workflow: workflow as UpscaleHow["workflow"], model });
    try {
      await startItems(projectId, [item]);
      setOutput(String(item.inputs.output_path));
      notify("확대를 시작했습니다. 결과는 이 그림의 새 버전으로 들어갑니다.");
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "확대를 시작하지 못했습니다.");
    }
  }

  async function cancel() {
    if (mine) await api("POST", `/api/jobs/${mine.id}/cancel`).catch(() => undefined);
    onJobsChanged();
  }

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && state !== "running" && onClose()}>
      <div className="modal" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true" aria-label="그림 확대">
        <div className="modal-head">
          <h2 title={file?.path}>
            <Maximize2 size={16} /> {file ? `확대 · ${file.path.replace(/^assets\//, "")}` : "업스케일 설정 (만든 뒤 확대)"}
          </h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="fields">
            <div className="field wide">
              <label htmlFor="up-workflow">1. 확대 워크플로</label>
              <select
                id="up-workflow"
                value={workflow}
                disabled={state !== "form"}
                onChange={(event) => {
                  setWorkflow(event.target.value);
                  setModel(defaultUpscaleModel(event.target.value, choices[event.target.value] ?? []));
                }}
              >
                {UPSCALE_WORKFLOWS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field wide">
              <label htmlFor="up-model">2. {entry.modelLabel}</label>
              {entry.fixed ? (
                <select id="up-model" value={entry.fixed} disabled>
                  <option>{entry.fixed}</option>
                </select>
              ) : (
                <select id="up-model" value={model} disabled={state !== "form"} onChange={(event) => setModel(event.target.value)}>
                  {names.length === 0 && <option value="">(모델 없음)</option>}
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
              <span className="hint">워크플로를 고르면 기본값이 들어옵니다. {entry.fixed ? "이 워크플로의 모델은 노드 안에 들어 있어 바꿀 수 없습니다." : "바꿀 수 있습니다."}</span>
            </div>
            <div className="field">
              <label htmlFor="up-scale">3. 배율</label>
              <input id="up-scale" type="number" list="up-scales" min={1} max={4} step={0.1} value={scale} disabled={state !== "form"} onChange={(event) => setScale(event.target.value)} />
              <datalist id="up-scales">
                {SCALES.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <span className="hint">목록에서 고르거나 1~4 사이로 직접 입력합니다.</span>
            </div>
          </div>
          {state !== "form" && (
            <div style={{ marginTop: 16 }} aria-live="polite">
              <div className="row" style={{ gap: 8 }}>
                <strong>{state === "done" ? "완료" : state === "failed" ? "실패" : percent > 0 ? `확대하는 중 ${percent}%` : "확대를 준비하는 중..."}</strong>
              </div>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state === "done" ? 100 : percent} style={{ height: 8, borderRadius: 4, background: "var(--line, #333)", marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${state === "done" ? 100 : percent}%`, height: "100%", background: state === "failed" ? "var(--danger, #f87171)" : "var(--accent, #7c6af7)", transition: "width .3s" }} />
              </div>
              {state === "failed" && mine?.error && <p className="error">{mine.error}</p>}
              {state === "done" && <span className="hint">이 그림의 새 버전으로 들어갔습니다. 그림 위의 버전 버튼에서 비교하고 고를 수 있습니다.</span>}
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          {state === "running" ? (
            <button className="btn" type="button" onClick={() => void cancel()}>
              <Square size={13} /> 취소
            </button>
          ) : (
            <button className="btn" type="button" onClick={onClose}>
              {state === "form" ? "취소" : "닫기"}
            </button>
          )}
          {state === "form" && (
            <button className="btn primary" type="button" disabled={running} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined} onClick={() => void start()}>
              <Maximize2 size={15} /> {onChoose ? "확인" : "실행"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
