import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

const fileUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/file`;

export interface TextFile {
  /** Current editor content. */
  text: string;
  setText: (value: string) => void;
  /** The file exists on disk (it can still be empty). */
  exists: boolean;
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  /** Writes the editor content. `content` overrides it (for editors that build the text themselves). */
  save: (content?: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

/**
 * One text file of a project (studio/..., artifacts/...) with the modified-time check of the file API:
 * if the file changed elsewhere since it was loaded, the save is refused and the new content is loaded.
 */
export function useTextFile(projectId: string, rel: string, notify: (text: string) => void, refreshKey = 0): TextFile {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState("");
  const [mtime, setMtime] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ content: string | null; mtimeMs: number | null }>("GET", `${fileUrl(projectId)}?path=${encodeURIComponent(rel)}&optional=1`);
      setText(data.content ?? "");
      setLoaded(data.content ?? "");
      setMtime(data.mtimeMs);
    } catch {
      notify("파일을 불러오지 못했습니다.");
    } finally {
      setReady(true);
    }
  }, [projectId, rel, notify]);

  useEffect(() => {
    setReady(false);
    void reload();
  }, [reload, refreshKey]);

  const save = useCallback(
    async (content?: string) => {
      const next = content ?? text;
      setSaving(true);
      try {
        const saved = await api<{ mtimeMs: number }>("PUT", fileUrl(projectId), { path: rel, content: next, expectedMtimeMs: mtime });
        setText(next);
        setLoaded(next);
        setMtime(saved.mtimeMs);
        notify("저장했습니다.");
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          notify("다른 곳에서 파일이 바뀌어 다시 불러왔습니다. 고친 내용은 사라졌으니 다시 입력하세요.");
          await reload();
        } else notify("저장하지 못했습니다.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [projectId, rel, text, mtime, notify, reload],
  );

  return { text, setText, exists: mtime !== null, ready, dirty: text !== loaded, saving, save, reload };
}

export interface JsonFile<T> {
  /** The parsed document being edited (null when the file does not exist or is not valid JSON). */
  data: T | null;
  setData: (value: T | null) => void;
  /** The file exists but is not valid JSON; `raw` has its text. */
  invalid: boolean;
  raw: string;
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  save: () => Promise<boolean>;
  /** Drops unsaved edits. */
  revert: () => void;
}

/** A JSON file of a project edited as an object. Other fields of the document are kept as they are. */
export function useJsonFile<T extends object>(projectId: string, rel: string, notify: (text: string) => void, refreshKey = 0): JsonFile<T> {
  const file = useTextFile(projectId, rel, notify, refreshKey);
  const [data, setData] = useState<T | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [baseline, setBaseline] = useState("null");

  // `file.text` only changes when the file is loaded or saved, never while typing in the editor.
  useEffect(() => {
    if (!file.ready) return;
    if (!file.exists || !file.text.trim()) {
      setData(null);
      setInvalid(false);
      setBaseline("null");
      return;
    }
    try {
      const parsed = JSON.parse(file.text) as T;
      setData(parsed);
      setInvalid(false);
      setBaseline(JSON.stringify(parsed));
    } catch {
      setData(null);
      setInvalid(true);
    }
  }, [file.ready, file.exists, file.text]);

  const revert = useCallback(() => {
    setData(baseline === "null" ? null : (JSON.parse(baseline) as T));
  }, [baseline]);

  const save = useCallback(async () => (data === null ? false : file.save(`${JSON.stringify(data, null, 2)}\n`)), [data, file]);

  return { data, setData, invalid, raw: file.text, ready: file.ready, dirty: data !== null ? JSON.stringify(data) !== baseline : baseline !== "null", saving: file.saving, save, revert };
}
