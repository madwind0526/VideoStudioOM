import { ArrowUp, File as FileIcon, Film, Folder, LayoutGrid, List, Play, X } from "lucide-react";
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
  /** With `multiple` several files can be ticked (a click ticks or unticks one); they come back together here instead of through onPick. */
  multiple?: boolean;
  onPickMany?: (files: string[]) => void;
  onClose: () => void;
}

const PICTURE_ENDINGS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const isPicture = (name: string) => PICTURE_ENDINGS.some((ending) => name.toLowerCase().endsWith(ending));
const VIDEO_ENDINGS = [".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"];
const isVideo = (name: string) => VIDEO_ENDINGS.some((ending) => name.toLowerCase().endsWith(ending));
const VIEW_KEY = "fileNavigatorView";
const savedView = (): "list" | "thumbs" => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "thumbs";
  } catch {
    return "thumbs";
  }
};

const joinPath = (dir: string, name: string) => `${dir}${/[\\/]$/.test(dir) ? "" : dir.includes("\\") ? "\\" : "/"}${name}`;
const matches = (name: string, accept?: string[]) => !accept || accept.length === 0 || accept.some((ending) => name.toLowerCase().endsWith(ending.toLowerCase()));

/** The first picture of a video (made by the server); the film icon stays when no picture can be made. */
function VideoThumb({ path, name }: { path: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Film size={28} />;
  return (
    <>
      <img src={`/api/fs/thumb?path=${encodeURIComponent(path)}`} alt={name} loading="lazy" onError={() => setFailed(true)} />
      <Play size={14} fill="currentColor" style={{ position: "absolute", right: 6, bottom: 6, color: "#fff", filter: "drop-shadow(0 0 2px rgba(0,0,0,0.8))" }} />
    </>
  );
}

/** The app's own file browser (same layout as MeetingNote's): shortcuts, path bar, list, selected file, cancel/open. */
export default function FileNavigator({ title, accept, start, projectId, onPick, multiple, onPickMany, onClose }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selected, setSelected] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"list" | "thumbs">(savedView);
  const changeView = (next: "list" | "thumbs") => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The choice is only remembered when the browser lets it.
    }
  };

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
    else if (matches(entry.name, accept)) {
      if (multiple) setTicked((list) => (list.includes(full) ? list.filter((item) => item !== full) : [...list, full]));
      else setSelected(full);
    }
  }

  /** A double click takes the file at once (with the ticked ones when several are allowed). */
  const pickNow = (full: string) => (multiple ? onPickMany?.([...ticked.filter((item) => item !== full), full]) : onPick(full));
  const isActive = (full: string) => (multiple ? ticked.includes(full) : selected === full);

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
            <button className="icon-btn" type="button" aria-label="목록으로 보기" title="목록으로 보기" aria-pressed={view === "list"} style={view === "list" ? { color: "var(--primary, #2f9e7e)" } : undefined} onClick={() => changeView("list")}>
              <List size={17} />
            </button>
            <button className="icon-btn" type="button" aria-label="썸네일로 보기" title="썸네일로 보기" aria-pressed={view === "thumbs"} style={view === "thumbs" ? { color: "var(--primary, #2f9e7e)" } : undefined} onClick={() => changeView("thumbs")}>
              <LayoutGrid size={17} />
            </button>
          </div>

          {view === "thumbs" ? (
            <div className="file-navigator-grid">
              {loading ? (
                <div className="file-navigator-empty">불러오는 중...</div>
              ) : (
                <>
                  {listing?.parent && (
                    <button className="file-navigator-tile" type="button" onClick={() => void load(listing.parent ?? undefined)}>
                      <span className="file-navigator-thumb">
                        <Folder size={28} />
                      </span>
                      <span className="file-navigator-name">..</span>
                    </button>
                  )}
                  {listing && listing.entries.length === 0 && !listing.error ? (
                    <div className="file-navigator-empty">폴더가 비어 있습니다.</div>
                  ) : (
                    listing?.entries.map((entry) => {
                      const full = joinPath(listing.path, entry.name);
                      const disabled = !entry.isDirectory && !matches(entry.name, accept);
                      const active = !entry.isDirectory && isActive(full);
                      return (
                        <button className={`file-navigator-tile${active ? " active" : ""}${disabled ? " disabled" : ""}`} disabled={disabled} key={entry.name} type="button" title={entry.name} onClick={() => click(entry)} onDoubleClick={() => !entry.isDirectory && !disabled && pickNow(full)}>
                          <span className="file-navigator-thumb">
                            {entry.isDirectory ? <Folder size={28} /> : isPicture(entry.name) ? <img src={`/api/fs/image?path=${encodeURIComponent(full)}`} alt={entry.name} loading="lazy" /> : isVideo(entry.name) ? <VideoThumb path={full} name={entry.name} /> : <FileIcon size={28} />}
                          </span>
                          <span className="file-navigator-name">{entry.name}</span>
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
          ) : (
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
                      const active = !entry.isDirectory && isActive(joinPath(listing.path, entry.name));
                      return (
                        <button className={`file-navigator-row${active ? " active" : ""}${disabled ? " disabled" : ""}`} disabled={disabled} key={entry.name} type="button" onClick={() => click(entry)} onDoubleClick={() => !entry.isDirectory && !disabled && pickNow(joinPath(listing.path, entry.name))}>
                          {entry.isDirectory ? <Folder size={15} /> : <FileIcon size={15} />} {entry.name}
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
  
          )}

          <div className="field">
            <label>{multiple ? "선택한 파일 (눌러서 고르고 다시 누르면 뺍니다)" : "선택한 파일"}</label>
            <input readOnly placeholder="목록에서 파일을 선택하세요" value={multiple ? (ticked.length > 0 ? `${ticked.length}개: ${ticked.map((item) => item.split(/[\\/]/).pop()).join(", ")}` : "") : selected} />
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" type="button" disabled={multiple ? ticked.length === 0 : !selected} onClick={() => (multiple ? onPickMany?.(ticked) : onPick(selected))}>
            {multiple && ticked.length > 0 ? `${ticked.length}장 ` : ""}열기
          </button>
        </div>
      </div>
    </div>
  );
}
