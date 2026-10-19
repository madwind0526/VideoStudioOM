import { Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveSize } from "../../shared/settings.mjs";
import { ApiError, type MediaFile, type ProjectSettingsView } from "../api";
import { makeItem, makePrompt, startItems, stamp, type MakeItem, type MakeKind } from "../sections/mediaJobs";

export type Kind = MakeKind;

const KINDS: Record<Kind, { label: string; hint: string }> = {
  image: { label: "이미지", hint: "Krea 2 Turbo로 장면 이미지를 만듭니다." },
  voice: { label: "대화 (TTS)", hint: "설정의 음성(Qwen3-TTS)으로 대사를 읽습니다." },
  sfx: { label: "효과음", hint: "SongYUE2(Stable Audio SFX)로 효과음을 만듭니다. 소리는 영어로 설명해야 잘 만들어져요." },
  instrumental: { label: "연주곡", hint: "SongYUE2로 가사 없는 연주곡을 만듭니다. 장르, 악기, 분위기를 적어 주세요." },
  vocal: { label: "보컬", hint: "SongYUE2로 가사를 부르는 노래를 만듭니다. 스타일과 가사를 따로 적어 주세요." },
  i2v: { label: "영상 (I2V)", hint: "고른 이미지를 첫 장면으로 영상을 만듭니다." },
  fl2v: { label: "영상 (FL2V)", hint: "첫 이미지에서 마지막 이미지로 이어지는 영상을 만듭니다." },
  s2v: { label: "S2V", hint: "Sound → Video: 얼굴 이미지와 음성을 고르면 입이 음성을 따라 움직이는 영상을 만듭니다." },
};

interface Props {
  projectId: string;
  kinds: Kind[];
  view: ProjectSettingsView | null;
  media: { images: MediaFile[]; audio: MediaFile[] };
  running: boolean;
  notify: (text: string) => void;
  onStarted: () => void;
}

/** Starts a generation job for the free local tools; the result is saved in the project's assets. */
export default function GenerateForm({ projectId, kinds, view, media, running, notify, onStarted }: Props) {
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [prompt, setPrompt] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [audio, setAudio] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [duration, setDuration] = useState("5");
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Keep the chosen files valid as the project's media changes.
  useEffect(() => {
    setFirst((value) => (media.images.some((file) => file.path === value) ? value : (media.images[0]?.path ?? "")));
    setLast((value) => (media.images.some((file) => file.path === value) ? value : (media.images.at(-1)?.path ?? "")));
    setAudio((value) => (media.audio.some((file) => file.path === value) ? value : (media.audio[0]?.path ?? "")));
  }, [media]);

  const settings = view?.effective;
  const size = settings ? resolveSize(settings) : null;

  function build(): MakeItem | string {
    if (!settings || !size) return "설정을 불러오는 중입니다.";
    const id = stamp();
    const audioPrefix = { voice: "tts", sfx: "sfx", instrumental: "bgm", vocal: "song" } as Record<string, string>;
    const output = kind === "image" ? `assets/images/gen-${id}.png` : audioPrefix[kind] ? `assets/audio/${audioPrefix[kind]}-${id}.wav` : `assets/video/clip-${id}.mp4`;
    return makeItem(settings, { kind, prompt, lyrics: kind === "vocal" ? lyrics : undefined, first: first || undefined, last: kind === "fl2v" ? last || undefined : undefined, audio: kind === "s2v" ? audio || undefined : undefined, duration: Number(duration) }, output);
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
    setDrafting(true);
    try {
      const target = kind === "image" ? "image" : kind === "sfx" ? "sfx" : "video";
      setPrompt(await makePrompt(projectId, { target, mode: kind, text: prompt, duration: Number(duration), hasAudio: kind === "s2v", first: needsFrame ? first || undefined : undefined, last: kind === "fl2v" ? last || undefined : undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프롬프트를 만들지 못했습니다.");
    } finally {
      setDrafting(false);
    }
  }

  const picker = (label: string, value: string, set: (v: string) => void, files: MediaFile[], empty: string) => (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => set(event.target.value)} disabled={files.length === 0}>
        {files.length === 0 ? (
          <option value="">{empty}</option>
        ) : (
          files.map((file) => (
            <option key={file.path} value={file.path}>
              {file.path.replace(/^assets\//, "")}
            </option>
          ))
        )}
      </select>
    </div>
  );

  const needsFrame = kind === "i2v" || kind === "fl2v" || kind === "s2v";
  const canDraft = kind === "image" || kind === "sfx" || needsFrame;
  const promptLabel = { voice: "대사", image: "이미지 설명", sfx: "소리 설명 (영어)", instrumental: "음악 스타일", vocal: "음악 스타일" }[kind as string] ?? "움직임 설명";
  const placeholder =
    { voice: "읽을 문장을 입력하세요.", image: "예: 아침 햇살 속 데이지 꽃에 앉은 꿀벌", sfx: "예: heavy wooden door creaking open", instrumental: "예: cinematic ambient, slow, piano", vocal: "예: korean ballad, warm female vocal, piano" }[kind as string] ??
    "예: 벌이 꽃에서 날아오른다, 부드러운 카메라 이동";
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
      <div className="fields" style={{ marginTop: 14 }}>
        <div className="field wide">
          <label htmlFor="gen-prompt">{promptLabel}</label>
          <textarea id="gen-prompt" rows={kind === "image" || needsFrame ? 5 : 3} value={prompt} maxLength={7000} onChange={(event) => setPrompt(event.target.value)} placeholder={placeholder} />
          {canDraft && (
            <div>
              <button className="btn" type="button" disabled={drafting} onClick={() => void draft()} title="간단한 설명을 모델에 맞는 프롬프트로 바꿔 줍니다.">
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
        {needsFrame && picker(kind === "s2v" ? "얼굴 이미지" : "첫 이미지", first, setFirst, media.images, "이미지가 없습니다")}
        {kind === "fl2v" && picker("마지막 이미지", last, setLast, media.images, "이미지가 없습니다")}
        {kind === "s2v" && picker("음성", audio, setAudio, media.audio, "음성이 없습니다")}
        {(needsFrame || kind === "sfx") && (
          <div className="field">
            <label htmlFor="gen-duration">길이(초)</label>
            <input id="gen-duration" type="number" min={kind === "sfx" ? 1 : 2} max={kind === "sfx" ? 30 : 15} step={0.5} value={duration} onChange={(event) => setDuration(event.target.value)} />
            {needsFrame && <span className="hint">{size && `생성 ${size.generate.join("×")} → 최종 ${size.final.join("×")}. 5초 영상은 약 1분 걸립니다.`}</span>}
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
