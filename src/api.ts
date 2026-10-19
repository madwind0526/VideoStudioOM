import type { DEFAULTS } from "../shared/settings.mjs";

export type Settings = typeof DEFAULTS;

export interface Stage {
  id: "synopsis" | "scenario" | "script" | "images" | "video" | "final";
  done: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: number;
  hasFinal: boolean;
  poster: string | null;
  stages: Stage[];
  description: string;
  favorite: boolean;
  durationSeconds: number | null;
}

export interface SystemStats {
  gpu: { name: string; utilization: number | null; vramUsedMb: number | null; vramTotalMb: number } | null;
  cpuPercent: number | null;
  ramUsedMb: number;
  ramTotalMb: number;
  activity: { tool: string | null; songyueBusy: boolean };
}

export interface MediaFile {
  path: string;
  size: number;
}

export interface ProjectDetail extends ProjectSummary {
  files: { path: string; size: number; mtimeMs: number }[];
  media: { images: MediaFile[]; videos: MediaFile[]; audio: MediaFile[] };
}

export interface LlmProviderStatus {
  id: string;
  kind: "cli" | "local";
  ready: boolean;
  command?: string;
  models?: string[];
}

export interface FolderInfo {
  path: string;
  exists: boolean;
  isFile: boolean;
}

export interface Job {
  id: string;
  tool: string;
  status: "running" | "done" | "failed" | "cancelled" | "interrupted";
  startedAt: number;
  finishedAt?: number;
  artifacts?: string[];
  error?: string | null;
  code?: string | null;
  durationSeconds?: number | null;
  meta: { project?: string; output?: string; label?: string };
}

export interface ProjectSettingsView {
  stored: Record<string, unknown>;
  effective: Settings;
  overridden: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

// The token changes on every server start; it is fetched lazily and re-fetched after a 403.
let token: string | null = null;

async function getToken(): Promise<string> {
  if (token === null) {
    const res = await fetch("/api/session");
    token = ((await res.json()) as { token: string }).token;
  }
  return token;
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["x-studio-token"] = await getToken();
    return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  let res = await send();
  if (res.status === 403 && method !== "GET") {
    token = null;
    res = await send();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "요청에 실패했습니다.", data.errors);
  return data as T;
}

export const mediaUrl = (id: string, rel: string) => `/api/projects/${encodeURIComponent(id)}/media?path=${encodeURIComponent(rel)}`;
