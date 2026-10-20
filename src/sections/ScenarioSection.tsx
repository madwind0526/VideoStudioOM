import { Plus, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import TimelineBar from "../components/TimelineBar";
import { SCENE_OPTS_FILE, type SceneLora, type SceneOpts } from "./mediaJobs";
import { storyApi } from "../story";
import { formatTime } from "../format";
import { useJsonFile } from "../useFile";
import type { SectionProps } from "./types";

// scene_plan.json follows OpenMontage's schema: scenes need id, type, description and start/end seconds.
// Fields this screen does not edit (script_section_id, framing, ...) are kept untouched.
const SCENE_TYPES: [string, string][] = [
  ["generated", "생성 장면"],
  ["broll", "보조 화면(B-roll)"],
  ["talking_head", "말하는 얼굴"],
  ["animation", "애니메이션"],
  ["character_scene", "캐릭터 장면"],
  ["diagram", "도표"],
  ["text_card", "자막 카드"],
  ["transition", "전환"],
  ["screen_recording", "화면 녹화"],
];

interface Scene {
  id: string;
  type: string;
  description: string;
  start_seconds: number;
  end_seconds: number;
  script_section_id?: string;
  [key: string]: unknown;
}

interface ScenePlan {
  version: string;
  scenes: Scene[];
  [key: string]: unknown;
}

function nextId(scenes: Scene[]): string {
  let n = scenes.length + 1;
  while (scenes.some((scene) => scene.id === `scene-${n}`)) n += 1;
  return `scene-${n}`;
}

function newScene(scenes: Scene[]): Scene {
  const start = scenes.at(-1)?.end_seconds ?? 0;
  return { id: nextId(scenes), type: "generated", description: "", start_seconds: start, end_seconds: start + 5 };
}

/** Blocking problems (the file would not follow the schema) and soft warnings (the timeline has holes). */
function check(scenes: Scene[]): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  scenes.forEach((scene, index) => {
    const name = `${index + 1}번 장면`;
    if (!scene.id.trim()) problems.push(`${name}: 이름(id)이 비어 있습니다.`);
    else if (scenes.findIndex((other) => other.id === scene.id) !== index) problems.push(`${name}: 이름(id) "${scene.id}"이 겹칩니다.`);
    if (!Number.isFinite(scene.start_seconds) || !Number.isFinite(scene.end_seconds)) problems.push(`${name}: 시작과 끝 시간을 숫자로 입력하세요.`);
    else if (scene.end_seconds <= scene.start_seconds) problems.push(`${name}: 끝이 시작보다 커야 합니다.`);
    const previous = scenes[index - 1];
    if (previous && Number.isFinite(previous.end_seconds) && Math.abs(previous.end_seconds - scene.start_seconds) > 0.01) warnings.push(`${name}: 앞 장면이 끝나는 시간과 이어지지 않습니다.`);
    if (!scene.description.trim()) warnings.push(`${name}: 설명이 비어 있습니다.`);
  });
  return { problems, warnings };
}

const num = (value: number) => (Number.isFinite(value) ? value : "");

/** View and edit the scenario (artifacts/scene_plan.json): which scenes the video has and how long each is. */
export default function ScenarioSection({ project, onChanged, notify }: SectionProps) {
  const file = useJsonFile<ScenePlan>(project.id, "artifacts/scene_plan.json", notify);
  const plan = file.data;
  const scenes = plan?.scenes ?? [];
  const { problems, warnings } = check(scenes);
  const [busy, setBusy] = useState(false);
  // LoRAs only some scenes use (e.g. a fight move); kept next to the scenario because scene_plan.json has no field for them.
  const opts = useJsonFile<SceneOpts>(project.id, SCENE_OPTS_FILE, notify);
  const [loraNames, setLoraNames] = useState<string[]>([]);
  useEffect(() => {
    api<{ loras: string[] }>("GET", "/api/comfy/models").then((data) => setLoraNames(data.loras)).catch(() => {});
  }, []);
  const lorasOf = (id: string): SceneLora[] => opts.data?.[id]?.loras ?? [];
  const setLoras = (id: string, loras: SceneLora[]) => opts.setData({ ...(opts.data ?? {}), [id]: { ...(opts.data?.[id] ?? {}), loras } });
  const dirty = file.dirty || opts.dirty;
  const total = scenes.reduce((max, scene) => (Number.isFinite(scene.end_seconds) ? Math.max(max, scene.end_seconds) : max), 0);

  const setScenes = (next: Scene[]) => plan && file.setData({ ...plan, scenes: next });
  const update = (index: number, patch: Partial<Scene>) => setScenes(scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));

  async function save() {
    const saved = file.dirty ? await file.save() : true;
    if (saved && opts.dirty) await opts.save();
    if (saved) onChanged();
  }

  /** The LLM splits the saved synopsis into scenes; the result is a draft that can be reviewed, edited and reverted. */
  async function generate() {
    setBusy(true);
    try {
      const scenario = await storyApi.scenario(project.id);
      file.setData({ ...(plan ?? {}), ...scenario } as ScenePlan);
      notify(`${scenario.scenes.length}개 장면을 만들었습니다. 확인하고 저장하세요.`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "시나리오를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>시나리오</h2>
        {plan && (
          <div className="row">
            <span className="muted">
              {scenes.length}장면 · 총 {formatTime(total)}
            </span>
            <button className="btn" type="button" onClick={() => setScenes([...scenes, newScene(scenes)])}>
              <Plus size={15} /> 장면 추가
            </button>
            <button className="btn" type="button" disabled={!dirty} onClick={() => { file.revert(); opts.revert(); }}>
              <RotateCcw size={15} /> 되돌리기
            </button>
            <button className="btn primary" type="button" disabled={!dirty || problems.length > 0 || file.saving} onClick={() => void save()}>
              <Save size={15} /> 저장
            </button>
          </div>
        )}
      </div>
      <p className="muted section-note">줄거리를 장면으로 나눈 계획입니다. 장면 길이는 영상 클립 단위(약 5초)에 맞추면 좋아요.</p>
      <div className="row" style={{ marginBottom: 14, gap: 12 }}>
        <button className="btn" type="button" disabled={busy} onClick={() => void generate()}>
          <Wand2 size={15} /> {busy ? "시나리오 만드는 중..." : "줄거리로 시나리오 만들기"}
        </button>
        <span className="hint">저장된 줄거리와 등장인물을 씁니다. 결과는 저장하기 전에 고치거나 되돌릴 수 있어요.</span>
      </div>

      {!file.ready ? (
        <p className="muted">불러오는 중...</p>
      ) : file.invalid ? (
        <div className="textblock">
          <p className="error">scene_plan.json을 읽을 수 없습니다(JSON 형식 오류). 파일을 직접 고친 뒤 다시 열어 주세요.</p>
          <pre>{file.raw}</pre>
        </div>
      ) : !plan ? (
        <div className="empty">
          <strong>아직 시나리오가 없어요</strong>
          <span>장면을 직접 하나씩 만들어 볼 수 있어요.</span>
          <button className="btn primary" type="button" onClick={() => file.setData({ version: "1.0", scenes: [newScene([])] })}>
            <Plus size={15} /> 직접 만들기
          </button>
        </div>
      ) : (
        <>
          {problems.length > 0 && (
            <ul className="problems error">
              {problems.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="problems warn">
              {warnings.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          <datalist id="scene-lora-list">
            {loraNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <TimelineBar
            segments={scenes.map((scene, index) => ({ label: String(index + 1), start: scene.start_seconds, end: scene.end_seconds }))}
            onBoundary={(boundary, seconds) => setScenes(scenes.map((scene, i) => (i === boundary ? { ...scene, end_seconds: seconds } : i === boundary + 1 ? { ...scene, start_seconds: seconds } : scene)))}
          />
          <div className="edit-list">
            {scenes.map((scene, index) => (
              <article className="edit-row" key={index}>
                <span className="no">{index + 1}</span>
                <div className="edit-body">
                  <div className="edit-line">
                    <label>
                      <span>종류</span>
                      <select value={scene.type} onChange={(event) => update(index, { type: event.target.value })}>
                        {SCENE_TYPES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                        {!SCENE_TYPES.some(([value]) => value === scene.type) && <option value={scene.type}>{scene.type}</option>}
                      </select>
                    </label>
                    <label>
                      <span>시작(초)</span>
                      <input type="number" min={0} step={0.5} value={num(scene.start_seconds)} onChange={(event) => update(index, { start_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>끝(초)</span>
                      <input type="number" min={0} step={0.5} value={num(scene.end_seconds)} onChange={(event) => update(index, { end_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                    {scene.script_section_id && (
                      <span className="chip" title="이 장면과 이어진 대본 구간">
                        대본 {scene.script_section_id}
                      </span>
                    )}
                    <button className="icon-btn danger" type="button" title="장면 지우기" aria-label={`${index + 1}번 장면 지우기`} onClick={() => setScenes(scenes.filter((_, i) => i !== index))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <textarea rows={2} value={scene.description} placeholder="이 장면에서 보이는 것과 움직임을 적어 주세요." onChange={(event) => update(index, { description: event.target.value })} />
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="hint">이 장면만 쓰는 LoRA:</span>
                    {lorasOf(scene.id).map((lora, loraIndex) => (
                      <span key={loraIndex} className="row" style={{ gap: 4 }}>
                        <input type="text" list="scene-lora-list" aria-label="LoRA 이름" value={lora.name} placeholder="LoRA 이름" style={{ width: 200 }} onChange={(event) => setLoras(scene.id, lorasOf(scene.id).map((item, i) => (i === loraIndex ? { ...item, name: event.target.value } : item)))} />
                        <input type="number" aria-label="강도" step={0.05} min={-4} max={4} value={lora.strength} style={{ width: 70 }} onChange={(event) => setLoras(scene.id, lorasOf(scene.id).map((item, i) => (i === loraIndex ? { ...item, strength: Number(event.target.value) } : item)))} />
                        <button className="icon-btn" type="button" aria-label="LoRA 지우기" onClick={() => setLoras(scene.id, lorasOf(scene.id).filter((_, i) => i !== loraIndex))}>
                          <Trash2 size={14} />
                        </button>
                      </span>
                    ))}
                    <button className="btn" type="button" disabled={lorasOf(scene.id).length >= 4} onClick={() => setLoras(scene.id, [...lorasOf(scene.id), { name: "", strength: 1 }])}>
                      <Plus size={14} /> LoRA
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
