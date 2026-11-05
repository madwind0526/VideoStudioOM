import { AlertTriangle, CheckCircle2, Clapperboard, GripVertical, Image as ImageIcon, Music, Plus, RefreshCw, RotateCcw, Save, Trash2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { chainFrom, clipPathOf, clipStatus, continuesPrevious, firstImagePath, defaultMode, lastImagePath, modeOf, needsFirstPicture, pictureMoves, slotImages, usesSong, withProjectMode } from "../../shared/scenes.mjs";
import { resolveSize } from "../../shared/settings.mjs";
import { api, ApiError, mediaUrl } from "../api";
import { BIBLE_FILE, charactersIn, describeReference, type Bible } from "../bible";
import FileNavigator from "../components/FileNavigator";
import PictureDialog from "../components/PictureDialog";
import TimelineBar from "../components/TimelineBar";
import { arrangePictures, importPicture, makeItem, makePrompt, refineItem, SCENE_OPTS_FILE, startItems, stamp, type MakeItem, type SceneLora, type SceneOpt, type SceneOpts } from "./mediaJobs";
import { refsOfScene, sceneItems, sceneSeconds, lacksReference, slotImageItems, slotRecipe, slotText } from "./sceneJobs";
import PromptLog from "../components/PromptLog";
import { storyApi } from "../story";
import { formatTime } from "../format";
import { useJsonFile } from "../useFile";
import type { SectionProps } from "./types";

// scene_plan.json follows OpenMontage's schema: scenes need id, type, description and start/end seconds.
// Fields this screen does not edit (type, script_section_id, framing, ...) are kept untouched.
const MODE_LABELS: Record<string, string> = {
  fl2v: "FL2V (시작·끝 이미지)",
  t2v: "T2V (글로 만든 첫 이미지, 이어가기)",
  i2v: "I2V (참조 이미지로 만든 첫 이미지, 이어가기)",
  s2v: "S2V (노래 + 첫 이미지, 이어가기)",
  r2v: "R2V (인물 참조)",
};

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
  /** The scene options with the way clips are made (the project's video mode, chosen on the start page) filled in. */
  const optData = withProjectMode(opts.data, defaultMode(settings?.defaults));
  const running = props.jobs.current !== null;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  /** The picture slot (project path) the file browser is open for. */
  const [picking, setPicking] = useState<string | null>(null);
  /** The picture slot (project path) shown in the viewer. */
  const [viewing, setViewing] = useState<string | null>(null);
  /** Saved options of one scene; unset values mean the defaults of shared/scenes.mjs. */
  const optOf = (id: string): SceneOpt => opts.data?.[id] ?? {};
  const setOpt = (id: string, patch: Partial<SceneOpt>) => opts.setData({ ...(opts.data ?? {}), [id]: { ...optOf(id), ...patch } } as SceneOpts);
  const hasPeople = (scene: Scene) => charactersIn(bible, scene.description).length > 0;

  const setScenes = (next: Scene[]) => plan && file.setData({ ...plan, scenes: next });
  const update = (index: number, patch: Partial<Scene>) => setScenes(scenes.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  
  /** A new 5 s scene right below scene `index`; the scenes after it move later by its length (their song pieces change, so made clips are marked out of date). */
  const insertAfter = (index: number) => {
    const end = scenes[index].end_seconds;
    const added: Scene = { id: nextId(scenes), type: "generated", description: "", start_seconds: end, end_seconds: end + 5 };
    setScenes([...scenes.slice(0, index + 1), added, ...scenes.slice(index + 1).map((scene) => ({ ...scene, start_seconds: scene.start_seconds + 5, end_seconds: scene.end_seconds + 5 }))]);
  };

  const reorderScenes =(from: number, to: number) => {
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

  const slots = slotImages(scenes, optData);
  const imageSize = settings ? (resolveSize(settings).image as [number, number]) : null;

  /** A first or last picture is made with the prompt maker and Krea; one that exists gets the new picture as its next version. */
  async function makeSlot(path: string) {
    const slot = slots.find((item) => item.path === path);
    if (!settings || !slot) return;
    setWorking(path);
    try {
      const prompt = await makePrompt(project.id, { target: "image", text: slotText(scenes, optData, slot) });
      const exists = images.some((file) => file.path === path);
      const output = exists ? `assets/versions/${path.slice("assets/images/".length, -4)}-${stamp()}.png` : path;
      const recipe = slotRecipe({ scenes, opts: optData, bible, images }, slot, prompt);
      const item = makeItem(settings, recipe, output);
      if (typeof item === "string") return notify(item);
      await startItems(project.id, [{ ...item, final: true, ...(exists ? { candidateOf: path } : {}) }]);
      notify(`${exists ? "새 버전을 만듭니다. 끝나면 이미지 화면에서 비교하고 고르세요." : "이미지를 만듭니다."}${lacksReference(scenes, optData, slot, recipe) ? " 참조 이미지가 없어 글로만 만듭니다(등장인물 시트를 만들거나 영상 계획에서 참조 그림을 고르세요)." : ""}`);
      props.onJobsChanged();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "이미지를 만들지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

  /** Every first and last picture the clips still need, one after the other. */
  async function makeMissingSlots() {
    if (!settings) return;
    setWorking("slots");
    try {
      const describe = (path: string) => describeReference(bible, path, images);
      const items: MakeItem[] = [];
      const wanted = slotImages(scenes, optData).filter((slot) => !images.some((file) => file.path === slot.path));
      let plain = 0;
      for (const item of slotImageItems({ settings, scenes, opts: optData, bible, images, videos })) {
        const slot = wanted.find((entry) => entry.path === item.inputs.output_path);
        if (slot && lacksReference(scenes, optData, slot, item.record)) plain += 1;
        items.push(await refineItem(project.id, settings, item, describe).catch(() => item));
      }
      if (items.length === 0) return notify("만들 이미지가 없습니다.");
      await startItems(project.id, items);
      notify(`${items.length}개 이미지를 차례로 만듭니다.${plain > 0 ? ` 그중 ${plain}개는 참조 이미지가 없어 글로만 만듭니다(등장인물 시트를 만들거나 영상 계획에서 참조 그림을 고르세요).` : ""}`);
      props.onJobsChanged();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "이미지를 만들지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

  /** The scene and the scenes that continue it are made again as new versions of their clips (nothing is replaced until one is chosen). */
  async function remakeFrom(index: number) {
    if (!settings) return;
    if (dirty) return notify("먼저 저장하세요. 저장된 시나리오로 다시 만듭니다.");
    setWorking(scenes[index].id);
    try {
      const describe = (path: string) => describeReference(bible, path, images);
      const made = sceneItems({ settings, scenes, opts: optData, bible, images, videos }, { only: chainFrom(scenes, optData, index), asVersions: true });
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
      const mode = modeOf(optData, scene);
      const refs = mode === "r2v" ? refsOfScene({ bible, images, opts: optData }, scene) : [];
      // The pictures the clip starts from and ends on, or the clip before it (its last picture) where the scene continues: a vision model describes them for the prompt.
      const at = scenes.findIndex((item) => item.id === scene.id);
      const before = at > 0 ? clipPathOf(scenes[at - 1].id) : "";
      const hasVideo = (path: string) => (props.detail?.media.videos ?? []).some((file) => file.path === path);
      const own = mode !== "r2v" && needsFirstPicture(optData, scene, at) ? firstImagePath(at) : "";
      const first = own && images.some((file) => file.path === own) ? own : mode !== "r2v" && before && hasVideo(before) ? before : undefined;
      const last = mode === "fl2v" ? lastImagePath(scenes, optData, at) : undefined;
      const prompt = await makePrompt(project.id, { target: "video", mode, text: scene.description, duration: sceneSeconds(scene), hasAudio: mode === "s2v", first, last, refs: refs.map((path) => describeReference(bible, path, images)), refPaths: refs });
      setOpt(scene.id, { prompt });
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setWorking(null);
    }
  }

  /** The picture names follow the clip numbers: when the saved scene list changes, each scene takes its pictures along. */
  async function arrangeBeforeSave() {
    const parse = (text: string): { scenes?: Scene[] } | SceneOpts => {
      try {
        return JSON.parse(text) as { scenes?: Scene[] };
      } catch {
        return {};
      }
    };
    const before = (parse(file.raw) as { scenes?: Scene[] }).scenes;
    if (!before || before.length === 0) return;
    const { moves, clips } = pictureMoves(before, withProjectMode(parse(opts.raw) as SceneOpts, defaultMode(settings?.defaults)), scenes, optData);
    const exists = (path: string | null) => path !== null && images.some((image) => image.path === path);
    if (!moves.some((move) => move.from !== move.to && (exists(move.from) || exists(move.to)))) return;
    const done = await arrangePictures(project.id, { moves, clips });
    if (done.aside > 0) notify("바뀐 장면 번호에 맞게 이미지를 옮겼습니다. 쓰지 않는 이미지는 assets/versions에 보관했습니다.");
  }

  async function save() {
    if (file.dirty || opts.dirty) {
      try {
        await arrangeBeforeSave();
      } catch (e) {
        return notify(e instanceof ApiError ? e.message : "이미지를 옮기지 못했습니다. 저장하지 않았습니다.");
      }
    }
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
              {scenes.length}장면 · 총 {formatTime(total)} · 영상 방식 {MODE_LABELS[defaultMode(settings?.defaults)]}
            </span>
            <button className="btn" type="button" disabled={running || working !== null || !settings || slotImageItems({ settings, scenes, opts: optData, bible, images, videos }).length === 0} title="시작·끝 이미지가 없는 장면의 이미지를 장면 글로 차례로 만듭니다." onClick={() => void makeMissingSlots()}>
              <ImageIcon size={15} /> {working === "slots" ? "준비 중..." : `없는 이미지 모두 만들기${settings ? ` (${slotImageItems({ settings, scenes, opts: optData, bible, images, videos }).length})` : ""}`}
            </button>
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
                        const clip = clipStatus({ scene, index, scenes, opts: optData, videos, images });
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
                      {(() => {
                        const mode = modeOf(optData, scene);
                        const has = (path: string) => images.some((file) => file.path === path);
                        const missing = (needsFirstPicture(optData, scene, index) && !has(firstImagePath(index))) || (mode === "fl2v" && !has(lastImagePath(scenes, optData, index)));
                        return (
                          <>
                            {missing && (
                              <span className="scene-badge pending" title={mode === "fl2v" ? "영상을 만들려면 시작 이미지와 끝 이미지가 필요합니다" : "영상을 만들려면 시작 이미지가 필요합니다"}>
                                <ImageIcon size={12} /> 이미지 필요
                              </span>
                            )}
                            {mode === "s2v" && !songFile && (
                              <span className="scene-badge pending" title="S2V는 노래가 필요합니다. 만들기 화면에서 노래를 고르세요.">
                                <Music size={12} /> 노래 필요
                              </span>
                            )}
                          </>
                        );
                      })()}
                      <button className="icon-btn" type="button" title="이 장면 바로 아래에 새 장면 추가 (뒤 장면의 시간이 5초씩 밀립니다)" aria-label={`${index + 1}번 장면 아래에 장면 추가`} onClick={() => insertAfter(index)}>
                        <Plus size={15} />
                      </button>
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
                  <div className="scene-extra">
                  <div className="scene-extra-main">
                  <div className="opts" style={{ margin: "10px 0 0" }}>
                    <label title={modeOf(optData, scene) === "fl2v" ? "켜면 앞 장면의 끝 이미지와 이 장면의 시작 이미지가 같은 그림이라 장면 사이가 이어집니다. 끄면 서로 다른 그림입니다." : modeOf(optData, scene) === "r2v" ? "켜면 앞 장면 영상의 마지막 그림에서 이 장면이 시작해 장면 사이가 이어집니다. 끄면 새로 시작합니다." : "켜면 앞 장면 영상의 마지막 프레임에서 이 장면이 시작합니다. 끄면 이 장면 전용 시작 이미지가 필요합니다(장면이 크게 바뀔 때)."}>
                      <input type="checkbox" disabled={index === 0} checked={continuesPrevious(optData, scene, index)} onChange={(event) => setOpt(scene.id, { continuePrevious: event.target.checked })} /> 앞 장면과 연결
                    </label>
                    <label title={modeOf(optData, scene) === "s2v" ? "S2V는 항상 노래의 이 장면 시간대를 씁니다." : modeOf(optData, scene) === "i2v" ? "I2V는 노래를 쓰지 않습니다. 노래에 입을 맞추려면 S2V를 고르세요." : songFile ? "프로젝트의 노래에서 이 장면 시간대의 소리를 입 모양 가이드로 씁니다." : "먼저 만들기 화면에서 노래를 고르세요."}>
                      <input type="checkbox" disabled={!songFile || modeOf(optData, scene) === "s2v" || modeOf(optData, scene) === "i2v"} checked={usesSong(optData, scene, songFile, hasPeople(scene))} onChange={(event) => setOpt(scene.id, { song: event.target.checked })} /> 노래 사용
                    </label>
                    <button className="btn" type="button" disabled={running || working !== null || !videos.some((video) => video.path === clipPathOf(scene.id))} title="이 장면의 영상 클립을 새 버전으로 다시 만듭니다(이미지는 그대로 씁니다). 인물 참조(R2V)는 이어받는 뒤 장면의 영상도 함께 만듭니다." onClick={() => void remakeFrom(index)}>
                      <RefreshCw size={14} /> {working === scene.id ? "준비 중..." : chainFrom(scenes, optData, index).length > 1 ? "영상부터 다시 만들기" : "영상 다시 만들기"}
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
                          const on = refsOfScene({ bible, images, opts: optData }, scene).includes(image.path);
                          return (
                            <label key={image.path} className="chip" style={{ cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const now = refsOfScene({ bible, images, opts: optData }, scene);
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
                  <div style={{ marginTop: 10 }}>
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
                  </div>
                  {needsFirstPicture(optData, scene, index) && (
                    <span className="scene-slots">
                      {(modeOf(optData, scene) === "fl2v" ? (["first", "last"] as const) : (["first"] as const)).map((role) => {
                        const path = role === "first" ? firstImagePath(index) : lastImagePath(scenes, optData, index);
                        const file = images.find((image) => image.path === path);
                        return (
                          <button key={role} className="scene-slot" type="button" title={`${role === "first" ? "시작" : "끝"} 이미지 (${path.replace("assets/images/", "")}): 눌러서 보기·새로 만들기·파일에서 읽기`} onClick={() => setViewing(path)}>
                            <span className="slot-label">{role === "first" ? "시작" : "끝"}</span>
                            <span className="slot-thumb">{file ? <img src={mediaUrl(project.id, path, file.mtimeMs)} alt={path} loading="lazy" /> : <span className="slot-empty">No Image</span>}</span>
                          </button>
                        );
                      })}
                    </span>
                  )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {viewing && (
        <PictureDialog
          title={`${viewing.replace("assets/images/", "").replace(".png", "")} · ${viewing.endsWith("-1.png") ? "시작" : "끝"} 이미지`}
          src={images.some((file) => file.path === viewing) ? mediaUrl(project.id, viewing, images.find((file) => file.path === viewing)?.mtimeMs) : null}
          note={slots.find((slot) => slot.path === viewing)?.shared ? "앞 장면의 끝 이미지와 같은 이미지입니다. 바꾸면 두 클립이 모두 '다시 만들기 필요'가 됩니다." : undefined}
          busy={running || working !== null || !imageSize}
          onMake={() => {
            const target = viewing;
            setViewing(null);
            void makeSlot(target);
          }}
          onBrowse={() => {
            const target = viewing;
            setViewing(null);
            setPicking(target);
          }}
          onClose={() => setViewing(null)}
        />
      )}
      {picking && imageSize && (
        <FileNavigator
          title="이미지 가져오기"
          accept={[".png", ".jpg", ".jpeg", ".webp"]}
          projectId={project.id}
          onClose={() => setPicking(null)}
          onPick={(from) => {
            const target = picking;
            setPicking(null);
            importPicture(project.id, from, target, imageSize)
              .then(() => {
                notify(`이미지를 가져왔습니다. (${target.replace("assets/images/", "")}, 영상 크기에 맞춰 잘랐습니다)`);
                props.onJobsChanged();
              })
              .catch((e) => notify(e instanceof ApiError ? e.message : "이미지를 가져오지 못했습니다."));
          }}
        />
      )}
      <PromptLog projectId={project.id} stages={["scenario"]} refreshKey={busy ? 1 : 0} />
    </div>
  );
}
