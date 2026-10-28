import { AlertTriangle, CheckCircle2, Clapperboard, GripVertical, Image as ImageIcon, Plus, RefreshCw, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { chainFrom, clipPathOf, clipStatus, continuesPrevious, imagePathOf, usesSong } from "../../shared/scenes.mjs";
import { api, ApiError } from "../api";
import { BIBLE_FILE, charactersIn, describeReference, type Bible } from "../bible";
import TimelineBar from "../components/TimelineBar";
import { makePrompt, refineItem, SCENE_OPTS_FILE, startItems, type MakeItem, type SceneLora, type SceneOpt, type SceneOpts } from "./mediaJobs";
import { refsOfScene, sceneItems, sceneSeconds } from "./sceneJobs";
import PromptLog from "../components/PromptLog";
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
export default function ScenarioSection(props: SectionProps) {
  const { project, onChanged, notify } = props;
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

  const bible = useJsonFile<Bible>(project.id, BIBLE_FILE, notify).data;
  const images = props.detail?.media.images ?? [];
  const videos = props.detail?.media.videos ?? [];
  const settings = props.view?.effective;
  const songFile = settings?.defaults.songFile ?? "";
  const running = props.jobs.current !== null;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  /** Saved options of one scene; unset values mean the defaults of shared/scenes.mjs. */
  const optOf = (id: string): SceneOpt => opts.data?.[id] ?? {};
  const setOpt = (id: string, patch: Partial<SceneOpt>) => opts.setData({ ...(opts.data ?? {}), [id]: { ...optOf(id), ...patch } } as SceneOpts);
  const hasPeople = (scene: Scene) => charactersIn(bible, scene.description).length > 0;

  const setScenes = (next: Scene[]) => plan && file.setData({ ...plan, scenes: next });
  const update = (index: number, patch: Partial<Scene>) => setScenes(scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  
  const reorderScenes = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= scenes.length || to >= scenes.length) return;
    // Moving a scene moves its place in the song and its place in the join: clips already made for the scenes in between are marked as out of date.
    const touched = scenes.slice(Math.min(from, to), Math.max(from, to) + 1).filter((scene) => videos.some((video) => video.path === clipPathOf(scene.id)));
    if (touched.length > 0 && !window.confirm(`이미 영상이 있는 장면이 ${touched.length}개 있습니다. 순서를 바꾸면 그 영상은 '다시 만들기 필요'로 표시됩니다. 바꿀까요?`)) return;
    const next = [...scenes];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    // Recalculate times to maintain continuity
    let currentTime = 0;
    const reordered = next.map((scene, idx) => {
      const duration = scene.end_seconds - scene.start_seconds;
      const updated = { ...scene, start_seconds: currentTime, end_seconds: currentTime + duration };
      currentTime += duration;
      return updated;
    });
    setScenes(reordered);
  };

  /** The scene and the scenes that continue it are made again as new versions of their clips (nothing is replaced until one is chosen). */
  async function remakeFrom(index: number) {
    if (!settings) return;
    if (dirty) return notify("먼저 저장하세요. 저장된 시나리오로 다시 만듭니다.");
    setWorking(scenes[index].id);
    try {
      const describe = (path: string) => describeReference(bible, path, images);
      const made = sceneItems({ settings, scenes, opts: opts.data, bible, images, videos }, { only: chainFrom(scenes, opts.data, index), asVersions: true });
      if (made.length === 0) return notify("다시 만들 수 있는 장면이 없습니다. 인물 시트나 장면 이미지가 필요합니다.");
      const items: MakeItem[] = [];
      for (const item of made) {
        if (item.final) items.push(item);
        else items.push({ ...(await refineItem(project.id, settings, item, describe).catch(() => item)), candidateOf: item.candidateOf });
      }
      await startItems(project.id, items);
      notify(`${items.length}개 장면을 새 버전으로 차례로 만듭니다. 끝나면 동영상 화면에서 비교하고 고르세요.`);
      props.onJobsChanged();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "다시 만들지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

  /** The prompt maker writes the H3 prompt of a scene's clip from its text and references; it is kept with the scene. */
  async function writePrompt(scene: Scene) {
    setWorking(scene.id);
    try {
      const refs = refsOfScene({ bible, images, opts: opts.data }, scene);
      const prompt = await makePrompt(project.id, { target: "video", mode: refs.length > 0 ? "r2v" : "i2v", text: scene.description, duration: sceneSeconds(scene), refs: refs.map((path) => describeReference(bible, path, images)) });
      setOpt(scene.id, { prompt });
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

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
          <div className="scene-cards">
            {scenes.map((scene, index) => (
              <article
                className="scene-card"
                key={scene.id || index}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== index) {
                    reorderScenes(dragIndex, index);
                  }
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                style={{ opacity: dragIndex === index ? 0.5 : 1 }}
              >
                <div className="scene-side">
                  {/* Only the handle drags: dragging inside the text boxes still selects text. */}
                  <span
                    className="scene-grip"
                    draggable
                    title="끌어서 장면 순서 바꾸기"
                    onDragStart={(e) => {
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = "move";
                      const card = e.currentTarget.closest(".scene-card");
                      if (card) e.dataTransfer.setDragImage(card, 16, 16);
                    }}
                  >
                    <GripVertical size={18} />
                  </span>
                  <div className="scene-number">{index + 1}</div>
                </div>
                <div className="scene-card-content">
                  <div className="scene-card-header">
                    <div className="scene-card-meta">
                      <select value={scene.type} onChange={(event) => update(index, { type: event.target.value })}>
                        {SCENE_TYPES.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                        {!SCENE_TYPES.some(([value]) => value === scene.type) && <option value={scene.type}>{scene.type}</option>}
                      </select>
                      <span className="muted">
                        {formatTime(scene.start_seconds)} - {formatTime(scene.end_seconds)} ({(scene.end_seconds - scene.start_seconds).toFixed(1)}초)
                      </span>
                      {scene.script_section_id && (
                        <span className="scene-badge" title="이 장면과 이어진 대본 구간">
                          대본 {scene.script_section_id}
                        </span>
                      )}
                    </div>
                    <div className="scene-card-badges">
                      {(() => {
                        const clip = clipStatus({ scene, index, scenes, opts: opts.data, videos });
                        return clip.state === "none" ? (
                          <span className="scene-badge pending">
                            <Clapperboard size={12} /> 영상 없음
                          </span>
                        ) : clip.state === "stale" ? (
                          <span className="scene-badge error" title={clip.reasons.join(" · ")}>
                            <AlertTriangle size={12} /> 다시 만들기 필요
                          </span>
                        ) : (
                          <span className="scene-badge done">
                            <CheckCircle2 size={12} /> 영상 있음{clip.versions > 1 ? ` · 버전 ${clip.versions}` : ""}
                          </span>
                        );
                      })()}
                      {images.some((file) => file.path === imagePathOf(scene.id)) && (
                        <span className="scene-badge" title="이 장면의 이미지가 있습니다">
                          <ImageIcon size={12} /> 이미지
                        </span>
                      )}
                      <button className="icon-btn danger" type="button" title="장면 지우기" aria-label={`${index + 1}번 장면 지우기`} onClick={() => setScenes(scenes.filter((_, i) => i !== index))}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="edit-line">
                    <label>
                      <span>시작(초)</span>
                      <input type="number" min={0} step={0.5} value={num(scene.start_seconds)} onChange={(event) => update(index, { start_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>끝(초)</span>
                      <input type="number" min={0} step={0.5} value={num(scene.end_seconds)} onChange={(event) => update(index, { end_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                  </div>
                  <textarea rows={4} value={scene.description} placeholder="이 장면에서 보이는 것과 움직임을 적어 주세요." onChange={(event) => update(index, { description: event.target.value })} />
                  <div className="opts" style={{ margin: "10px 0 0" }}>
                    <label title="켜면 앞 장면 영상의 마지막 그림에서 이 장면이 시작해 장면 사이가 이어집니다. 끄면 새로 시작합니다.">
                      <input type="checkbox" disabled={index === 0} checked={continuesPrevious(opts.data, scene, index)} onChange={(event) => setOpt(scene.id, { continuePrevious: event.target.checked })} /> 앞 장면 이어받기
                    </label>
                    <label title={songFile ? "프로젝트의 노래에서 이 장면 시간대의 소리를 입 모양 가이드로 씁니다." : "먼저 만들기 화면에서 노래를 고르세요."}>
                      <input type="checkbox" disabled={!songFile} checked={usesSong(opts.data, scene, songFile, hasPeople(scene))} onChange={(event) => setOpt(scene.id, { song: event.target.checked })} /> 노래 사용
                    </label>
                    <button className="btn" type="button" disabled={running || working !== null || !videos.some((video) => video.path === clipPathOf(scene.id))} title="이 장면과, 이어받는 뒤 장면들을 새 버전으로 다시 만듭니다." onClick={() => void remakeFrom(index)}>
                      <RefreshCw size={14} /> {working === scene.id ? "준비 중..." : chainFrom(scenes, opts.data, index).length > 1 ? "이 장면부터 다시 만들기" : "이 장면 다시 만들기"}
                    </button>
                  </div>
                  <details className="scene-plan">
                    <summary className="muted">영상 계획 (프롬프트 · 참조 그림){optOf(scene.id).prompt || optOf(scene.id).refs ? " · 저장됨" : ""}</summary>
                    <div className="field" style={{ marginTop: 8 }}>
                      <label>영상 프롬프트</label>
                      <textarea rows={5} value={optOf(scene.id).prompt ?? ""} maxLength={7000} placeholder="비워 두면 영상을 만들 때 프롬프트 만들기가 장면 설명으로 자동으로 씁니다." onChange={(event) => setOpt(scene.id, { prompt: event.target.value })} />
                      <div className="btn-row" style={{ marginBottom: 0 }}>
                        <button className="btn" type="button" disabled={working !== null || !scene.description.trim()} onClick={() => void writePrompt(scene)}>
                          <Wand2 size={14} /> 프롬프트 만들기
                        </button>
                        {optOf(scene.id).prompt && (
                          <button className="btn" type="button" onClick={() => setOpt(scene.id, { prompt: undefined })}>
                            프롬프트 지우기
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: 10 }}>
                      <label>참조 그림 ({optOf(scene.id).refs ? "직접 고름" : "장면 글에 이름이 나온 인물의 시트·사진"})</label>
                      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                        {images.map((image) => {
                          const on = refsOfScene({ bible, images, opts: opts.data }, scene).includes(image.path);
                          return (
                            <label key={image.path} className="chip" style={{ cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const now = refsOfScene({ bible, images, opts: opts.data }, scene);
                                  setOpt(scene.id, { refs: (on ? now.filter((path) => path !== image.path) : [...now, image.path]).slice(0, 9) });
                                }}
                              />{" "}
                              {image.path.replace("assets/images/", "")}
                            </label>
                          );
                        })}
                        {optOf(scene.id).refs && (
                          <button className="link" type="button" onClick={() => setOpt(scene.id, { refs: undefined })}>
                            자동으로
                          </button>
                        )}
                      </div>
                    </div>
                  </details>
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
      <PromptLog projectId={project.id} stages={["scenario"]} refreshKey={busy ? 1 : 0} />
    </div>
  );
}
