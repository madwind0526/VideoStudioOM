import type { ProjectSummary } from "./api";

/** 35.5 -> "0:35", 3725 -> "62:05". */
export function formatTime(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—:——";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Timestamp (ms) -> "2026. 10. 19." in the viewer's locale. */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ko-KR");
}

export const stagesDone = (project: ProjectSummary) => project.stages.filter((stage) => stage.done).length;

export type ProjectState = "done" | "draft";

/** A project with a finished video is "완성본", everything else is still being worked on. */
export const stateOf = (project: ProjectSummary): ProjectState => (project.hasFinal ? "done" : "draft");
