import { Sparkles, UserRound, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveSize } from "../../shared/settings.mjs";
import { ApiError, type MediaFile, type ProjectSettingsView } from "../api";
import { charactersIn, sheetPath, type Bible } from "../bible";
import { makeItem, makePrompt, startItems, stamp, type MakeItem, type MakeKind } from "../sections/mediaJobs";

/** "auto" is a form-only choice: the video mode follows what was picked (references, first/last image, sound). */
export type Kind = MakeKind | "auto";

const KINDS: Record<Kind, { label: string; hint: string }> = {
  auto: { label: "자동", hint: "고른 그림·소리에 맞춰 방식을 자동으로 정합니다. 참조 그림이 있으면 R2V, 소리와 얼굴이 있으면 S2V, 첫·끝 이미지가 있으면 FL2V, 첫 이미지만 있으면 I2V입니다." },
  image: { label: "이미지", hint: "Krea 2 Turbo로 장면 이미지를 만듭니다." },
  sheet: { label: "캐릭터 시트", hint: "등장인물 탭에서 만듭니다." },
  voice: { label: "대화 (TTS)", hint: "설정의 음성(Qwen3-TTS)으로 대사를 읽습니다." },
  sfx: { label: "효과음", hint: "SongYUE2(Stable Audio SFX)로 효과음을 만듭니다. 소리는 영어로 설명해야 잘 만들어져요." },
  instrumental: { label: "연주곡", hint: "SongYUE2로 가사 없는 연주곡을 만듭니다. 장르, 악기, 분위기를 적어 주세요." },
  vocal: { label: "보컬", hint: "SongYUE2로 가사를 부르는 노래를 만듭니다. 스타일과 가사를 따로 적어 주세요." },
  i2v: { label: "I2V", hint: "고른 이미지를 첫 장면으로 영상을 만듭니다." },
  fl2v: { label: "FL2V", hint: "첫 이미지에서 마지막 이미지로 이어지는 영상을 만듭니다." },
  s2v: { label: "S2V", hint: "Sound → Video: 얼굴 이미지와 음성을 고르면 입이 음성을 따라 움직이는 영상을 만듭니다." },
  r2v: { label: "R2V", hint: "Reference → Video: 인물 시트나 장면 그림(9장까지)을 참조해, 같은 인물이 나오는 새 영상을 만듭니다." },
};

interface Props {
  projectId: string;
  kinds: Kind[];
  view: ProjectSettingsView | null;
  media: { images: MediaFile[]; audio: MediaFile[] };
  bible?: Bible | null;
  running: boolean;
  notify: (text: string) => void;
  onStarted: () => void;
}

/** Starts a generation job for the free local tools; the result is saved in the project's assets. */
export default function GenerateForm({ projectId, kinds, view, media, bible, running, notify, onStarted }: Props) {
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [prompt, setPrompt] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [audio, setAudio] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState("5");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Keep the chosen files valid as the project's media changes (in "auto" nothing is picked by default).
  useEffect(() => {
    const fallback = (list: MediaFile[], pick: (list: MediaFile[]) => string | undefined) => (kind === "auto" ? "" : (pick(list) ?? ""));
    setFirst((value) => (media.images.some((file) => file.path === value) ? value : fallback(media.images, (list) => list[0]?.path)));
    setLast((value) => (media.images.some((file) => file.path === value) ? value : fallback(media.images, (list) => list.at(-1)?.path)));
    setAudio((value) => (media.audio.some((file) => file.path === value) ? value : fallback(media.audio, (list) => list[0]?.path)));
    setRefs((list) => list.filter((path) => media.images.some((file) => file.path === path)));
  }, [media, kind]);

  const settings = view?.effective;
  const size = settings ? resolveSize(settings) : null;

  /** The mode that is really used: "auto" decides from what is picked. */
  const resolved: MakeKind | null =
    kind !== "auto" ? kind : audio && first ? "s2v" : refs.length > 0 ? "r2v" : first && last && first !== last ? "fl2v" : first ? "i2v" : null;
  const isVideo = kind === "auto" || kind === "i2v" || kind === "fl2v" || kind === "s2v" || kind === "r2v";
  /** R2V references: the picked ones, plus the first image when one is picked as well (the scene picture). */
  const refList = resolved === "r2v" ? [...new Set([...refs, ...(first ? [first] : [])])].slice(0, 9) : [];

  const describeRef = (path: string): string => {
    const owner = bible?.characters.find((character) => sheetPath(character) === path);
    if (owner) return `character sheet of ${owner.name}: ${owner.description}`;
    const recipe = media.images.find((file) => file.path === path)?.record;
    return typeof recipe?.prompt === "string" ? `scene picture: ${recipe.prompt.slice(0, 300)}` : "scene picture";
  };

  function build(): MakeItem | string {
    if (!settings || !size) return "설정을 불러오는 중입니다.";
    if (!resolved) return "첫 이미지나 참조 그림을 고르세요.";
    const id = stamp();
    const audioPrefix = { voice: "tts", sfx: "sfx", instrumental: "bgm", vocal: "song" } as Record<string, string>;
    const output = resolved === "image" ? `assets/images/gen-${id}.png` : audioPrefix[resolved] ? `assets/audio/${audioPrefix[resolved]}-${id}.wav` : `assets/video/clip-${id}.mp4`;
    return makeItem(
      settings,
      { kind: resolved, prompt, lyrics: resolved === "vocal" ? lyrics : undefined, first: first || undefined, last: resolved === "fl2v" ? last || undefined : undefined, audio: resolved === "s2v" ? audio || undefined : undefined, refs: resolved === "r2v" ? refList : undefined, duration: Number(duration) },
      output,
    );
  }

  async function submit() {
    setError("");
    const request = build();
    if (typeof request === "string") return setError(request);
    setBusy(true);
    try {
      await startItems(projectId, [request]);
      notify("작업을 시작했습니다.");
      setPrompt("");
      onStarted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** Turns the short idea in the box into a prompt written the way the model likes it (LLM, see docs/prompting.md). */
  async function draft() {
    setError("");
    if (!prompt.trim()) return setError("만들고 싶은 장면을 간단히 적은 뒤 눌러 주세요.");
    if (isVideo && !resolved) return setError("첫 이미지나 참조 그림을 먼저 고르세요.");
    setDrafting(true);
    try {
      const target = kind === "image" ? "image" : kind === "sfx" ? "sfx" : "video";
      setPrompt(
        await makePrompt(projectId, {
          target,
          mode: resolved ?? kind,
          text: prompt,
          duration: Number(duration),
          hasAudio: resolved === "s2v",
          first: resolved === "i2v" || resolved === "fl2v" || resolved === "s2v" ? first || undefined : undefined,
          last: resolved === "fl2v" ? last || undefined : undefined,
          refs: resolved === "r2v" ? refList.map(describeRef) : undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  /** Puts the sheet of every character named in the prompt into the references. */
  function addNamedSheets() {
    const sheets = charactersIn(bible, prompt)
      .map((character) => sheetPath(character))
      .filter((path) => media.images.some((file) => file.path === path));
    if (sheets.length === 0) return setError("설명에 이름이 나오는 인물의 캐릭터 시트가 없습니다. 등장인물 탭에서 시트를 먼저 만드세요.");
    setError("");
    setRefs((list) => [...new Set([...list, ...sheets])].slice(0, 9));
  }

  const picker = (label: string, value: string, set: (v: string) => void, files: MediaFile[], empty: string, optional = false) => (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => set(event.target.value)} disabled={files.length === 0}>
        {files.length === 0 ? (
          <option value="">{empty}</option>
        ) : (
          <>
            {optional && <option value="">(없음)</option>}
            {files.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path.replace(/^assets\//, "")}
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );

  const optional = kind === "auto";
  const showFirst = kind === "auto" || kind === "i2v" || kind === "fl2v" || kind === "s2v" || kind === "r2v";
  const showLast = kind === "auto" || kind === "fl2v";
  const showAudio = kind === "auto" || kind === "s2v";
  const showRefs = kind === "auto" || kind === "r2v";
  const canDraft = kind === "image" || kind === "sfx" || isVideo;
  const promptLabel = { voice: "대사", image: "이미지 설명", sfx: "소리 설명 (영어)", instrumental: "음악 스타일", vocal: "음악 스타일" }[kind as string] ?? "움직임 설명";
  const placeholder =
    { voice: "읽을 문장을 입력하세요.", image: "예: 아침 햇살 속 데이지 꽃에 앉은 꿀벌", sfx: "예: heavy wooden door creaking open", instrumental: "예: cinematic ambient, slow, piano", vocal: "예: korean ballad, warm female vocal, piano" }[kind as string] ??
    "예: 미나가 창가에서 편지를 펼친다, 부드러운 카메라 이동";
  return (
    <section className="gen-card">
      <h3>새로 만들기</h3>
      {kinds.length > 1 && (
        <div className="field">
          <div className="seg wrap" role="group" aria-label="종류">
            {kinds.map((item) => (
              <button key={item} type="button" aria-pressed={kind === item} onClick={() => { setKind(item); setError(""); }}>
                {KINDS[item].label}
              </button>
            ))}
          </div>
        </div>
      )}
      <span className="hint">{KINDS[kind].hint}</span>
      {kind === "auto" && <span className="hint" style={{ display: "block" }}>지금 방식: {resolved ? KINDS[resolved].label : "고르면 정해집니다"}</span>}
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="gen-prompt">{promptLabel}</label>
          <textarea id="gen-prompt" rows={kind === "image" || isVideo ? 5 : 3} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder={placeholder} />
          {canDraft && (
            <div>
              <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 모델에 맞는 프롬프트로 바꿔 줍니다. 등장인물과 화풍은 설정집의 글이 그대로 들어갑니다.">
                <Wand2 size={15} /> {drafting ? "만드는 중..." : "프롬프트 만들기"}
              </button>
            </div>
          )}
        </div>
        {kind === "vocal" && (
          <div className="field wide">
            <label htmlFor="gen-lyrics">가사</label>
            <textarea id="gen-lyrics" rows={4} value={lyrics} maxLength={4000} onChange={(event) => setLyrics(event.target.value)} placeholder="부를 가사를 입력하세요." />
          </div>
        )}
        {showFirst && picker(kind === "s2v" ? "얼굴 이미지" : kind === "r2v" ? "장면 이미지 (선택)" : "첫 이미지", first, setFirst, media.images, "이미지가 없습니다", optional || kind === "r2v")}
        {showLast && picker("마지막 이미지", last, setLast, media.images, "이미지가 없습니다", optional)}
        {showAudio && picker("음성", audio, setAudio, media.audio, "음성이 없습니다", optional)}
        {showRefs && (
          <div className="field wide">
            <label>참조 그림 (9장까지: 인물마다 캐릭터 시트 한 장씩)</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {media.images.map((file) => {
                const on = refs.includes(file.path);
                const owner = bible?.characters.find((character) => sheetPath(character) === file.path);
                return (
                  <label key={file.path} className="chip" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={on} disabled={!on && refs.length >= 9} onChange={() => setRefs((list) => (on ? list.filter((path) => path !== file.path) : [...list, file.path]))} /> {owner ? `시트: ${owner.name || owner.id}` : file.path.replace("assets/images/", "")}
                  </label>
                );
              })}
              {media.images.length === 0 && <span className="muted">이미지가 없습니다.</span>}
            </div>
            <div>
              <button className="btn" type="button" onClick={addNamedSheets}>
                <UserRound size={15} /> 설명에 나온 인물의 시트 넣기
              </button>
            </div>
          </div>
        )}
        {(isVideo || kind === "sfx") && (
          <div className="field">
            <label htmlFor="gen-duration">길이(초)</label>
            <input id="gen-duration" type="number" min={kind === "sfx" ? 1 : 2} max={kind === "sfx" ? 30 : 15} step={0.5} value={duration} onChange={(event) => setDuration(event.target.value)} />
            {isVideo && <span className="hint">{size && `생성 ${size.generate.join("×")} → 최종 ${size.final.join("×")}. 5초 영상은 약 1분 걸립니다.`}</span>}
          </div>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || running} onClick={() => void submit()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : "만들기"}
        </button>
      </div>
    </section>
  );
}
