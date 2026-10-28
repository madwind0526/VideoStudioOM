import { FileText, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, mediaUrl } from "../api";
import ExportPanel from "../components/ExportPanel";
import VideoPlayer from "../components/VideoPlayer";
import { makeSubtitles } from "./mediaJobs";
import type { SectionProps } from "./types";

const SRT_FILE = "renders/subtitles.srt";
const FINAL_FILE = "renders/final.mp4";
const SOUND_FILE = "assets/audio/narration.wav";
const NAMES: Record<string, string> = { "final.mp4": "이어 붙인 영상", "export.mp4": "하나로 합친 영상" };

const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/** The finished files of a project: the joined video, the mixed sound and the subtitles, and the one file they are put into. */
export default function FinalSection(props: SectionProps) {
  const { project, detail, notify } = props;
  const [playing, setPlaying] = useState<string | null>(null);
  const [srt, setSrt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renders = (detail?.media.videos ?? []).filter((file) => file.path.startsWith("renders/"));
  const joined = renders.find((file) => file.path === FINAL_FILE);
  const sound = detail?.media.audio.find((file) => file.path === SOUND_FILE);
  const readSrt = () =>
    api<{ content: string | null }>("GET", `/api/projects/${encodeURIComponent(project.id)}/file?path=${encodeURIComponent(SRT_FILE)}&optional=1`)
      .then((data) => setSrt(data.content))
      .catch(() => setSrt(null));
  useEffect(() => {
    void readSrt();
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function makeSrt() {
    setBusy(true);
    try {
      await makeSubtitles(project.id);
      await readSrt();
      notify("자막 파일을 만들었습니다. (renders/subtitles.srt)");
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "자막을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const status = (ok: boolean, text: string) => <span className={ok ? "chip" : "chip warn"}>{ok ? text : "없음"}</span>;

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          완성본<span className="count">{renders.length}</span>
        </h2>
      </div>
      <p className="muted section-note">동영상 화면에서 이어 붙인 영상, 오디오 화면에서 합친 소리, 대본의 자막을 여기서 하나의 파일로 합칩니다.</p>

      <section className="gen-card">
        <h3>합칠 재료</h3>
        <div className="final-parts">
          <div className="final-part">
            <strong>영상</strong>
            {status(Boolean(joined), joined ? `${sizeLabel(joined.size)} · 이어 붙인 영상` : "")}
            <span className="muted">{FINAL_FILE} · 동영상 화면의 "이어 붙이기"로 만듭니다.</span>
            {joined && (
              <button className="btn" type="button" onClick={() => setPlaying(joined.path)}>
                <Play size={14} /> 보기
              </button>
            )}
          </div>
          <div className="final-part">
            <strong>오디오</strong>
            {status(Boolean(sound), sound ? sizeLabel(sound.size) : "")}
            <span className="muted">{SOUND_FILE} · 오디오 화면의 "시간에 맞춰 합치기"로 만듭니다.</span>
            {sound && <audio controls preload="metadata" src={mediaUrl(project.id, sound.path, sound.mtimeMs)} />}
          </div>
          <div className="final-part">
            <strong>자막</strong>
            {status(srt !== null, "SRT 있음")}
            <span className="muted">{SRT_FILE} · 대본의 대화로 만듭니다.</span>
            <button className="btn" type="button" disabled={busy} onClick={() => void makeSrt()}>
              <FileText size={14} /> {busy ? "만드는 중..." : srt === null ? "자막 파일(SRT) 만들기" : "자막 파일 다시 만들기"}
            </button>
          </div>
        </div>
        {srt && (
          <details style={{ marginTop: 10 }}>
            <summary className="muted">자막 내용 보기</summary>
            <pre className="final-srt">{srt}</pre>
          </details>
        )}
      </section>

      <ExportPanel projectId={project.id} hasFinal={Boolean(joined)} hasSound={Boolean(sound)} defaultCodec={props.view?.effective.video.codec} notify={notify} onExported={props.onJobsChanged} />

      <h3 className="sub-head">완성된 영상 ({renders.length})</h3>
      {renders.length === 0 ? (
        <p className="muted">아직 완성본이 없습니다. 동영상 화면에서 구간 영상을 이어 붙이면 여기에 나타납니다.</p>
      ) : (
        <div className="video-cards">
          {renders.map((file) => (
            <div key={file.path} className="vcard media-item">
              <button className="video-card" type="button" title={file.path} onClick={() => setPlaying(file.path)}>
                <span className="vthumb">
                  <video src={`${mediaUrl(project.id, file.path, file.mtimeMs)}#t=0.1`} preload="metadata" muted playsInline />
                  <span className="play">
                    <Play size={30} fill="currentColor" />
                  </span>
                </span>
                <span className="vname">
                  {NAMES[file.path.replace(/^renders\//, "")] ?? file.path.replace(/^renders\//, "")} · {sizeLabel(file.size)}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      {playing && <VideoPlayer src={mediaUrl(project.id, playing, renders.find((file) => file.path === playing)?.mtimeMs)} title={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
