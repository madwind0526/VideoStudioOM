import { ClipboardCheck, FileText, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { checkClips, exportFinal, listCodecs, makeSubtitles, type ClipCheck } from "../sections/mediaJobs";

interface Props {
  projectId: string;
  /** The finished (joined) video exists. */
  hasFinal: boolean;
  /** The mixed sound track (narration.wav) exists. */
  hasSound: boolean;
  notify: (text: string) => void;
  onChecked: (results: ClipCheck[]) => void;
  onExported: () => void;
}

/** Quality check of the clips, subtitles, and the finished export (sound track, burned-in subtitles, codec). */
export default function ExportPanel({ projectId, hasFinal, hasSound, notify, onChecked, onExported }: Props) {
  const [codecs, setCodecs] = useState<{ id: string; label: string }[]>([]);
  const [codec, setCodec] = useState("h264");
  const [burn, setBurn] = useState(false);
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState<"qa" | "srt" | "export" | null>(null);

  useEffect(() => {
    listCodecs()
      .then((list) => setCodecs(list))
      .catch(() => setCodecs([]));
  }, []);

  async function run<T>(name: "qa" | "srt" | "export", job: () => Promise<T>, done: (value: T) => void, fallback: string) {
    setBusy(name);
    try {
      done(await job());
    } catch (e) {
      notify(e instanceof ApiError ? e.message : fallback);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="gen-card export-panel">
      <h3>점검 · 내보내기</h3>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run(
              "qa",
              () => checkClips(projectId),
              (results) => {
                onChecked(results);
                const bad = results.filter((item) => item.issues.length > 0).length;
                notify(bad ? `문제가 있는 영상이 ${bad}개 있습니다. 영상 목록의 표시를 확인하세요.` : "검은 화면이나 멈춘 화면이 없습니다.");
              },
              "점검하지 못했습니다.",
            )
          }
        >
          <ClipboardCheck size={15} /> {busy === "qa" ? "점검 중..." : "영상 점검 (검은 화면·멈춤)"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run(
              "srt",
              () => makeSubtitles(projectId),
              (result) => {
                notify(`자막 파일을 만들었습니다. (${result.output})`);
                onExported();
              },
              "자막을 만들지 못했습니다.",
            )
          }
        >
          <FileText size={15} /> {busy === "srt" ? "만드는 중..." : "자막 파일(SRT) 만들기"}
        </button>
      </div>
      <div className="row" style={{ gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={sound && hasSound} disabled={!hasSound} onChange={(event) => setSound(event.target.checked)} /> 오디오 화면의 합친 소리(narration.wav) 넣기
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={burn} onChange={(event) => setBurn(event.target.checked)} /> 대사를 자막으로 새기기
        </label>
        <label className="row" style={{ gap: 6 }}>
          코덱
          <select value={codec} onChange={(event) => setCodec(event.target.value)}>
            {(codecs.length ? codecs : [{ id: "h264", label: "H.264 (CPU)" }]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn primary"
          type="button"
          disabled={busy !== null || !hasFinal}
          title={hasFinal ? undefined : "먼저 구간 영상을 이어 붙여 완성본을 만드세요."}
          onClick={() =>
            void run(
              "export",
              () => exportFinal(projectId, { codec, burnSubtitles: burn, sound: sound && hasSound }),
              (result) => {
                notify(`내보냈습니다. (${result.output}${result.subtitles ? ", 자막 포함" : ""}${result.sound ? ", 합친 소리 포함" : ""})`);
                onExported();
              },
              "내보내지 못했습니다.",
            )
          }
        >
          <Upload size={15} /> {busy === "export" ? "내보내는 중..." : "내보내기 (renders/export.mp4)"}
        </button>
      </div>
    </section>
  );
}
