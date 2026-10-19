import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { ASPECTS } from "../../shared/settings.mjs";
import { api, ApiError, type Settings } from "../api";

interface Props {
  notify: (text: string) => void;
  onSaved: () => void;
}

export default function SettingsPage({ notify, onSaved }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fps, setFps] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ settings: Settings }>("GET", "/api/settings")
      .then(({ settings: loaded }) => {
        setSettings(loaded);
        setFps(String(loaded.video.finalFps));
        setAspect(loaded.defaults.aspect);
      })
      .catch(() => setError("설정을 불러오지 못했습니다."));
  }, []);

  async function save() {
    setError("");
    try {
      const { settings: saved } = await api<{ settings: Settings }>("PUT", "/api/settings", {
        video: { finalFps: Number(fps) },
        defaults: { aspect },
      });
      setSettings(saved);
      onSaved();
      notify("설정을 저장했습니다.");
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...(e.errors ?? []).map((item) => item.message)].join(" ") : "저장하지 못했습니다.");
    }
  }

  if (!settings) return <p className={error ? "error" : "muted"}>{error || "불러오는 중..."}</p>;

  return (
    <>
      <h1>설정</h1>
      <p className="muted">가끔 바꾸는 기본값입니다. 영상마다 바꾸는 값은 시작 화면에 있습니다.</p>
      <div className="row">
        <div className="field">
          <label htmlFor="fps">최종 FPS</label>
          <input id="fps" type="number" min={12} max={60} value={fps} onChange={(e) => setFps(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="aspect">기본 화면 비율</label>
          <select id="aspect" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {ASPECTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <button className="btn" onClick={() => void save()}>
          <Save size={16} /> 저장
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <h2>연결</h2>
      <ul className="files">
        <li>SongYUE2: {settings.connections.songyueUrl}</li>
        <li>ComfyUI: {settings.connections.comfyUrl}</li>
        <li>OpenMontage: {settings.connections.openmontageDir}</li>
      </ul>
      <p className="muted">나머지 항목은 다음 단계에서 이 화면에 추가됩니다.</p>
    </>
  );
}
