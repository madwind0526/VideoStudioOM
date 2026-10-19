import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { resolveSize } from "../../shared/settings.mjs";
import { api, ApiError, type MediaFile, type ProjectSettingsView } from "../api";

export type Kind = "image" | "voice" | "i2v" | "fl2v" | "s2v";

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

const stamp = () => new Date().toISOString().replace(/\D/g, "").slice(2, 14);

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

  function build(): { tool: string; inputs: Record<string, unknown>; label: string } | string {
    if (!settings || !size) return "설정을 불러오는 중입니다.";
    const text = prompt.trim();
    if (!text) return kind === "voice" ? "읽을 대사를 입력하세요." : "내용을 입력하세요.";
    const id = stamp();
    const video = {
      prompt: text,
      width: size.generate[0],
      height: size.generate[1],
      duration_seconds: Number(duration),
      // Only the RTX pass is wired to the tool; other settings mean "no enlargement" for now.
      upscale: settings.video.upscale === "rtx-2pass" && size.final[0] > size.generate[0],
      upscale_scale: size.final[0] / size.generate[0],
      output_path: `assets/video/clip-${id}.mp4`,
    };
    if (kind !== "image" && kind !== "voice" && !(Number(duration) >= 2 && Number(duration) <= 15)) return "길이는 2~15초로 입력하세요.";
    switch (kind) {
      case "image":
        return { tool: "comfyui_krea_image", label: text, inputs: { prompt: text, width: size.image[0], height: size.image[1], output_path: `assets/images/gen-${id}.png` } };
      case "voice":
        return { tool: "qwen3_tts", label: text, inputs: { text, voice: settings.audio.voice.name, language: settings.audio.voice.language, output_path: `assets/audio/tts-${id}.wav` } };
      case "i2v":
        return first ? { tool: "h3_local_video", label: text, inputs: { ...video, reference_image_path: first } } : "첫 이미지를 고르세요. 이미지가 없으면 이미지 화면에서 먼저 만드세요.";
      case "fl2v":
        return first && last && first !== last ? { tool: "h3_local_video", label: text, inputs: { ...video, reference_image_path: first, last_frame_path: last } } : "서로 다른 첫 이미지와 마지막 이미지를 고르세요.";
      case "s2v":
        return first && audio ? { tool: "h3_local_video", label: text, inputs: { ...video, reference_image_path: first, audio_path: audio } } : "얼굴 이미지와 음성을 고르세요. 음성은 오디오 화면에서 만들 수 있습니다.";
    }
  }

  async function submit() {
    setError("");
    const request = build();
    if (typeof request === "string") return setError(request);
    setBusy(true);
    try {
      await api("POST", "/api/jobs", { project: projectId, tool: request.tool, label: request.label, inputs: request.inputs });
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
