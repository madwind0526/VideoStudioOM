import { api } from "./api";
import type { Bible } from "./bible";

export interface SynopsisOption {
  title: string;
  logline: string;
  synopsis: string;
}

export interface GeneratedScene {
  id: string;
  type: string;
  description: string;
  start_seconds: number;
  end_seconds: number;
  script_section_id?: string;
}

const call = <T,>(projectId: string, step: string, body: Record<string, unknown> = {}) => api<T>("POST", `/api/story/${step}`, { project: projectId, ...body });

/** The LLM steps of the story: each one reads the saved files of the project and returns a draft to review. */
export const storyApi = {
  synopses: (projectId: string, idea: string, preset: string) => call<{ options: SynopsisOption[] }>(projectId, "synopsis", { idea, preset, count: 4 }).then((data) => data.options),
  bible: (projectId: string) => call<{ bible: Bible }>(projectId, "bible").then((data) => data.bible),
  scenario: (projectId: string) => call<{ scenario: { version: string; scenes: GeneratedScene[] } }>(projectId, "scenario").then((data) => data.scenario),
  script: (projectId: string) =>
    call<{ script: { version: string; title: string; total_duration_seconds: number; sections: Record<string, unknown>[] }; kinds: Record<string, string>; scenes: GeneratedScene[] }>(projectId, "script"),
};
