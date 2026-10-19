import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveSize } from "../../shared/settings.mjs";
import { ApiError, type MediaFile, type ProjectSettingsView } from "../api";
import { makeItem, startItems, stamp, type MakeItem, type MakeKind } from "../sections/mediaJobs";

export type Kind = MakeKind;

const KINDS: Record<Kind, { label: string; hint: string }> = {
  image: { label: "이미지", hint: "Krea 2 Turbo로 장면 이미지를 만듭니다." },
  voice: { label: "음성", hint: "설정의 음성(Qwen3-TTS)으로 대사를 읽습니다." },
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
  const [duration, setDuration] = useState("5");
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
    const output = kind === "image" ? `assets/images/gen-${id}.png` : kind === "voice" ? `assets/audio/tts-${id}.wav` : `assets/video/clip-${id}.mp4`;
    return makeItem(settings, { kind, prompt, first: first || undefined, last: kind === "fl2v" ? last || undefined : undefined, audio: kind === "s2v" ? audio || undefined : undefined, duration: Number(duration) }, output);
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
          <label htmlFor="gen-prompt">{kind === "voice" ? "대사" : kind === "image" ? "이미지 설명" : "움직임 설명"}</label>
          <textarea id="gen-prompt" rows={3} value={prompt} maxLength={1000} onChange={(event) => setPrompt(event.target.value)} placeholder={kind === "voice" ? "읽을 문장을 입력하세요." : kind === "image" ? "예: 아침 햇살 속 데이지 꽃에 앉은 꿀벌" : "예: 벌이 꽃에서 날아오른다, 부드러운 카메라 이동"} />
        </div>
        {needsFrame && picker(kind === "s2v" ? "얼굴 이미지" : "첫 이미지", first, setFirst, media.images, "이미지가 없습니다")}
        {kind === "fl2v" && picker("마지막 이미지", last, setLast, media.images, "이미지가 없습니다")}
        {kind === "s2v" && picker("음성", audio, setAudio, media.audio, "음성이 없습니다")}
        {needsFrame && (
          <div className="field">
            <label htmlFor="gen-duration">길이(초)</label>
            <input id="gen-duration" type="number" min={2} max={15} step={0.5} value={duration} onChange={(event) => setDuration(event.target.value)} />
            <span className="hint">{size && `생성 ${size.generate.join("×")} → 최종 ${size.final.join("×")}. 5초 영상은 약 1분 걸립니다.`}</span>
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
