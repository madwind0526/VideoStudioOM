import type { Job, ProjectDetail, ProjectSettingsView, ProjectSummary } from "../api";

export type SectionId = "title" | "synopsis" | "scenario" | "script" | "images" | "audio" | "videos";

export interface SectionProps {
  project: ProjectSummary;
  detail: ProjectDetail | null;
  view: ProjectSettingsView | null;
  jobs: { current: Job | null; history: Job[] };
  /** Reloads the job list and the project's media after a job started or changed. */
  onJobsChanged: () => void;
  /** Reloads the project list (title, stages) after an edit. */
  onChanged: () => void;
  notify: (text: string) => void;
}
