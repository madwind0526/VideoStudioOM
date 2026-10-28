import { ArrowUp, File as FileIcon, Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface Entry {
  name: string;
  isDirectory: boolean;
}

interface Listing {
  path: string;
  parent: string | null;
  entries: Entry[];
  shortcuts: { label: string; path: string }[];
  error?: string;
}

interface Props {
  title: string;
  /** File name endings that can be picked (others are shown greyed out), e.g. [".json"]. */
  accept?: string[];
  /** Folder (or file inside it) to open first. */
  start?: string;
  /** The open project: its folder becomes a shortcut. */
  projectId?: string;
  onPick: (file: string) => void;
  onClose: () => void;
}

const joinPath = (dir: string, name: string) => `${dir}${/[\\/]$/.test(dir) ? "" : dir.includes("\\") ? "\\" : "/"}${name}`;
const matches = (name: string, accept?: string[]) => !accept || accept.length === 0 || accept.some((ending) => name.toLowerCase().endsWith(ending.toLowerCase()));

/** The app's own file browser (same layout as MeetingNote's): shortcuts, path bar, list, selected file, cancel/open. */
export default function FileNavigator({ title, accept, start, projectId, onPick, onClose }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(dir?: string) {
    setLoading(true);
    try {
      const result = await api<Listing>("GET", `/api/fs?dir=${encodeURIComponent(dir ?? "")}${projectId ? `&project=${encodeURIComponent(projectId)}` : ""}`);
      setListing(result);
      setPathInput(result.path);
      setError(result.error ?? "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "폴더를 열지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Start next to the current file when there is one.
    const inside = start && matches(start, accept) ? start.replace(/[\\/][^\\/]*$/, "") : start;
    void load(inside || undefined);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function click(entry: Entry) {
    if (!listing) return;
    const full = joinPath(listing.path, entry.name);
    if (entry.isDirectory) void load(full);
    else if (matches(entry.name, accept)) setSelected(full);
  }

  return (
    <div className="backdrop" role="dialog" aria-modal="true" aria-label={title} style={{ zIndex: 80 }}>
      <div className="modal" style={{ width: "min(680px, 100%)" }}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="file-navigator-shortcuts">
            {listing?.shortcuts.map((shortcut) => (
              <button className="btn" key={shortcut.path} type="button" onClick={() => void load(shortcut.path)}>
                {shortcut.label}
              </button>
            ))}
          </div>

          <div className="file-navigator-pathbar">
            <button className="btn" type="button" disabled={!listing?.parent} title="상위 폴더로 이동" onClick={() => listing?.parent && void load(listing.parent)}>
              <ArrowUp size={15} /> 위로
            </button>
            <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load(pathInput)} aria-label="폴더 경로" />
            <button className="btn" type="button" onClick={() => void load(pathInput)}>
              이동
            </button>
          </div>

          <div className="file-navigator-list">
            {loading ? (
              <div className="file-navigator-empty">불러오는 중...</div>
            ) : (
              <>
                {listing?.parent && (
                  <button className="file-navigator-row" type="button" onClick={() => void load(listing.parent ?? undefined)}>
                    <Folder size={15} /> ..
                  </button>
                )}
                {listing && listing.entries.length === 0 && !listing.error ? (
                  <div className="file-navigator-empty">폴더가 비어 있습니다.</div>
                ) : (
                  listing?.entries.map((entry) => {
                    const disabled = !entry.isDirectory && !matches(entry.name, accept);
                    const active = !entry.isDirectory && selected === joinPath(listing.path, entry.name);
                    return (
                      <button className={`file-navigator-row${active ? " active" : ""}${disabled ? " disabled" : ""}`} disabled={disabled} key={entry.name} type="button" onClick={() => click(entry)} onDoubleClick={() => !entry.isDirectory && !disabled && onPick(joinPath(listing.path, entry.name))}>
                        {entry.isDirectory ? <Folder size={15} /> : <FileIcon size={15} />} {entry.name}
                      </button>
                    );
                  })
                )}
              </>
            )}
          </div>

          <div className="field">
            <label>선택한 파일</label>
            <input readOnly placeholder="목록에서 파일을 선택하세요" value={selected} />
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" type="button" disabled={!selected} onClick={() => onPick(selected)}>
            열기
          </button>
        </div>
      </div>
    </div>
  );
}
