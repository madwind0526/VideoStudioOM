import { Square } from "lucide-react";
import { api, type Job } from "../api";
import { formatTime } from "../format";

const TOOL_LABELS: Record<string, string> = { comfyui_krea_image: "이미지", qwen3_tts: "음성", h3_local_video: "영상", h3_reference_video: "영상(R2V)", comfyui_workflow: "워크플로", songyue_music: "음악", songyue_sfx: "효과음" };
const STATUS_LABELS: Record<Job["status"], string> = { running: "만드는 중", done: "완료", failed: "실패", cancelled: "취소됨", interrupted: "중단됨" };

interface Props {
  projectId: string;
  jobs: Job[];
  /** Only jobs whose result goes under one of these folders are listed (e.g. the image screen shows image jobs). */
  outputs: string[];
  /** Jobs of a batch that are still waiting for their turn. */
  pending: number;
  /** Work of a stopped batch that can be made again. */
  paused: number;
  onChanged: () => void;
}

/** Jobs of one project that are running or did not finish well. Finished results appear in the section's own list. */
export default function JobList({ projectId, jobs, outputs, pending, paused, onChanged }: Props) {
  const mine = jobs.filter((job) => job.meta.project === projectId && outputs.some((prefix) => job.meta.output?.startsWith(prefix)) && job.status !== "done").slice(0, 5);
  if (mine.length === 0 && paused === 0) return null;

  async function cancel(id: string) {
    await api("POST", `/api/jobs/${id}/cancel`).catch(() => undefined);
    onChanged();
  }

  async function resume(discard: boolean) {
    await api("POST", discard ? "/api/jobs/discard" : "/api/jobs/resume").catch(() => undefined);
    onChanged();
  }

  return (
    <div className="jobs" aria-label="최근 작업">
      {paused > 0 && (
        <article className="job interrupted">
          <div className="job-head">
            <strong>중단된 작업 {paused}개</strong>
            <span className="job-label">멈춘 곳부터 이어서 만들 수 있어요.</span>
            <button className="btn primary" type="button" onClick={() => void resume(false)}>
              이어서 만들기
            </button>
            <button className="btn" type="button" onClick={() => void resume(true)}>
              버리기
            </button>
          </div>
        </article>
      )}
      {mine.map((job) => (
        <article key={job.id} className={`job ${job.status}`}>
          <div className="job-head">
            <strong>{TOOL_LABELS[job.tool] ?? job.tool}</strong>
            <span className="chip">{STATUS_LABELS[job.status]}</span>
            {job.meta.batch && job.meta.batch.total > 1 && <span className="chip">{job.meta.batch.index}/{job.meta.batch.total}</span>}
            {job.durationSeconds != null && <span className="chip">{formatTime(job.durationSeconds)}</span>}
            <span className="job-label" title={job.meta.label}>
              {job.meta.label}
            </span>
            {job.status === "running" && (
              <button className="btn" type="button" onClick={() => void cancel(job.id)}>
                <Square size={13} /> {pending > 0 ? "모두 취소" : "취소"}
              </button>
            )}
          </div>
          {(job.status === "failed" || job.status === "interrupted") && job.error && <p className="error">{job.error}</p>}
        </article>
      ))}
    </div>
  );
}
