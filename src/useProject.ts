import { useCallback, useEffect, useState } from "react";
import { api, type Job, type ProjectDetail } from "./api";

/** Detail of one project (media lists, files). Reloads when files change or a job finishes. */
export function useProjectDetail(id: string, ...reloadOn: number[]) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setDetail((await api<{ project: ProjectDetail }>("GET", `/api/projects/${encodeURIComponent(id)}`)).project);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...reloadOn]);

  return { detail, missing, reload };
}

/** The job queue: the running job and the recent history. */
export function useJobs(jobTick: number) {
  const [jobs, setJobs] = useState<{ current: Job | null; history: Job[] }>({ current: null, history: [] });
  const reload = useCallback(async () => {
    setJobs(await api<{ current: Job | null; history: Job[] }>("GET", "/api/jobs").catch(() => ({ current: null, history: [] })));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload, jobTick]);
  return { ...jobs, reload };
}
