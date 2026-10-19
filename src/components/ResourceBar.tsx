import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SystemStats } from "../api";

// Green up to 70 %, amber above it, red above 90 % (same thresholds as the SongYUE2 monitor).
const level = (percent: number) => (percent > 90 ? "high" : percent > 70 ? "mid" : "");

const TOOL_LABELS: Record<string, string> = {
  comfyui_krea_image: "이미지 생성 중",
  h3_local_video: "영상 생성 중",
  qwen3_tts: "음성 생성 중",
  songyue_music: "음악 생성 중",
};

function Item({ label, percent, title }: { label: string; percent: number; title: string }) {
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <span className="meter" title={title}>
      <b>
        <em>{label}</em>
        {value}%
      </b>
      <i className={level(value)} style={{ width: `${value}%` }} />
    </span>
  );
}

function activityOf(stats: SystemStats): { text: string; busy: boolean } {
  if (stats.activity.tool) return { text: TOOL_LABELS[stats.activity.tool] ?? "작업 중", busy: true };
  if (stats.activity.songyueBusy) return { text: "SongYUE2 곡 생성 중", busy: true };
  return { text: "대기 중", busy: false };
}

/** Right side of the top bar, like SongYUE2: connection, GPU name, usage numbers, what the GPU is doing. */
export default function ResourceBar({ connected }: { connected: boolean }) {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      // A hidden tab does not need a reading every two seconds.
      if (document.visibilityState === "visible") {
        const next = await api<SystemStats>("GET", "/api/system/stats").catch(() => null);
        if (!stopped) setStats(next);
      }
      if (!stopped) timer = window.setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  const gpu = stats?.gpu;
  const activity = stats ? activityOf(stats) : null;
  return (
    <div className="top-right">
      <span className="conn" title={connected ? "서버와 연결되어 있습니다." : "서버 연결이 끊겼습니다."}>
        <i className={connected ? "dot on" : "dot"} />
        {connected ? "서버 연결됨" : "연결 끊김"}
      </span>
      {stats && (
        <div className="resource" aria-label="자원 사용량">
          <span className="res-gpu" title={gpu ? `GPU: ${gpu.name}` : "GPU 정보를 읽을 수 없습니다."}>
            <Cpu size={14} /> {gpu ? `${gpu.name} · ${Math.round(gpu.vramTotalMb / 1024)} GB` : "GPU 없음"}
          </span>
          {gpu?.utilization != null && <Item label="GPU" percent={gpu.utilization} title={`GPU 사용률 ${gpu.utilization}%`} />}
          {gpu?.vramUsedMb != null && gpu.vramTotalMb > 0 && (
            <Item label="VRAM" percent={(gpu.vramUsedMb / gpu.vramTotalMb) * 100} title={`GPU 메모리 ${(gpu.vramUsedMb / 1024).toFixed(1)} / ${Math.round(gpu.vramTotalMb / 1024)} GB`} />
          )}
          {stats.cpuPercent !== null && <Item label="CPU" percent={stats.cpuPercent} title={`CPU 사용률 ${stats.cpuPercent}%`} />}
          {stats.ramTotalMb > 0 && (
            <Item label="RAM" percent={(stats.ramUsedMb / stats.ramTotalMb) * 100} title={`메모리 ${(stats.ramUsedMb / 1024).toFixed(1)} / ${Math.round(stats.ramTotalMb / 1024)} GB`} />
          )}
          {activity && (
            <span className={activity.busy ? "activity busy" : "activity"} title="지금 GPU를 쓰고 있는 작업">
              {activity.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
