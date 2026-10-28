import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../api";
import { exportFinal, listCodecs } from "../sections/mediaJobs";

interface Props {
  projectId: string;
  /** The joined video (renders/final.mp4) exists. */
  hasFinal: boolean;
  /** The mixed sound track (narration.wav) exists. */
  hasSound: boolean;
  /** The project's video save method; the export starts with it chosen. */
  defaultCodec?: string;
  notify: (text: string) => void;
  onExported: () => void;
}

/** Puts the joined video, the mixed sound track and the subtitles of the script into one file (renders/export.mp4). */
export default function ExportPanel({ projectId, hasFinal, hasSound, defaultCodec, notify, onExported }: Props) {
  const [codecs, setCodecs] = useState<{ id: string; label: string }[]>([]);
  const [codec, setCodec] = useState(defaultCodec ?? "h264");
  useEffect(() => setCodec(defaultCodec ?? "h264"), [defaultCodec]);
  const [burn, setBurn] = useState(false);
  const [sound, setSound] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCodecs()
      .then((list) => setCodecs(list))
      .catch(() => setCodecs([]));
  }, []);

  async function start() {
    setBusy(true);
    try {
      const result = await exportFinal(projectId, { codec, burnSubtitles: burn, sound: sound && hasSound });
      notify(`하나로 합쳤습니다. (${result.output}${result.subtitles ? ", 자막 포함" : ""}${result.sound ? ", 합친 소리 포함" : ""})`);
      onExported();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "합치지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gen-card export-panel">
      <h3>하나로 합치기</h3>
      <div className="opts">
        <label title="오디오 화면의 '시간에 맞춰 합치기'로 만든 소리를 영상의 소리로 넣습니다. 체크하지 않으면 영상에 원래 있던 소리를 씁니다.">
          <input type="checkbox" checked={sound && hasSound} disabled={!hasSound} onChange={(event) => setSound(event.target.checked)} /> 합친 소리(narration.wav) 넣기
        </label>
        <label title="대본의 대화를 시간에 맞춰 영상 화면에 글자로 새깁니다. 새긴 자막은 나중에 끌 수 없습니다.">
          <input type="checkbox" checked={burn} onChange={(event) => setBurn(event.target.checked)} /> 대사를 자막으로 새기기
        </label>
        <label>
          코덱
          <select value={codec} onChange={(event) => setCodec(event.target.value)}>
            {(codecs.length ? codecs : [{ id: "h264", label: "H.264 (CPU)" }]).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="btn-row" style={{ marginBottom: 0 }}>
        <button className="btn primary" type="button" disabled={busy || !hasFinal} title={hasFinal ? undefined : "먼저 동영상 화면에서 구간 영상을 이어 붙이세요."} onClick={() => void start()}>
          <Upload size={15} /> {busy ? "합치는 중..." : "하나로 합치기 (renders/export.mp4)"}
        </button>
      </div>
    </section>
  );
}
