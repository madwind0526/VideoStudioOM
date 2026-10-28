import { ArrowUp, File as FileIcon, Folder, X, Image as ImageIcon, Video, Music, FileAudio } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, mediaUrl } from "../api";

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

const getFileIcon = (name: string) => {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) return ImageIcon;
  if (/\.(mp4|webm)$/i.test(lower)) return Video;
  if (/\.(mp3|flac|ogg)$/i.test(lower)) return Music;
  if (/\.(wav)$/i.test(lower)) return FileAudio;
  return FileIcon;
};

const getFileType = (name: string) => {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/i.test(lower)) return "image";
  if (/\.(mp4|webm)$/i.test(lower)) return "video";
  if (/\.(mp3|flac|ogg|wav)$/i.test(lower)) return "audio";
  return "file";
};

/** The app's own file browser (same layout as MeetingNote's): shortcuts, path bar, list, selected file, cancel/open. */
export default function FileNavigator({ title, accept, start, projectId, onPick, onClose }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");

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
            <div className="row" style={{ gap: 4, marginLeft: "auto" }}>
              <button className={`btn${viewMode === "grid" ? " primary" : ""}`} type="button" onClick={() => setViewMode("grid")}>
                그리드
              </button>
              <button className={`btn${viewMode === "list" ? " primary" : ""}`} type="button" onClick={() => setViewMode("list")}>
                목록
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
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
                      const Icon = entry.isDirectory ? Folder : getFileIcon(entry.name);
                      return (
                        <button className={`file-navigator-row${active ? " active" : ""}${disabled ? " disabled" : ""}`} disabled={disabled} key={entry.name} type="button" onClick={() => click(entry)} onDoubleClick={() => !entry.isDirectory && !disabled && onPick(joinPath(listing.path, entry.name))}>
                          <Icon size={15} /> {entry.name}
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="file-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, maxHeight: 320, overflow: "auto", padding: 8 }}>
              {loading ? (
                <div className="file-navigator-empty" style={{ gridColumn: "1 / -1" }}>불러오는 중...</div>
              ) : (
                <>
                  {listing?.parent && (
                    <button className="file-grid-item" type="button" onClick={() => void load(listing.parent ?? undefined)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 10, border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
                      <Folder size={28} />
                      <span style={{ fontSize: 11, textAlign: "center" }}>..</span>
                    </button>
                  )}
                  {listing && listing.entries.length === 0 && !listing.error ? (
                    <div className="file-navigator-empty" style={{ gridColumn: "1 / -1" }}>폴더가 비어 있습니다.</div>
                  ) : (
                    listing?.entries.map((entry) => {
                      const disabled = !entry.isDirectory && !matches(entry.name, accept);
                      const active = !entry.isDirectory && selected === joinPath(listing.path, entry.name);
                      const fullPath = joinPath(listing.path, entry.name);
                      const type = getFileType(entry.name);
                      const isImage = type === "image" && !entry.isDirectory;
                      return (
                        <button
                          className="file-grid-item"
                          disabled={disabled}
                          key={entry.name}
                          type="button"
                          onClick={() => click(entry)}
                          onDoubleClick={() => !entry.isDirectory && !disabled && onPick(fullPath)}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 6,
                            padding: 8,
                            border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                            borderRadius: 10,
                            background: active ? "var(--nav-active)" : "var(--card)",
                            opacity: disabled ? 0.4 : 1,
                          }}
                        >
                          {entry.isDirectory ? (
                            <Folder size={28} />
                          ) : isImage && projectId ? (
                            <img src={mediaUrl(projectId, fullPath.replace(/\\/g, "/"))} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />
                          ) : type === "video" ? (
                            <Video size={28} />
                          ) : type === "audio" ? (
                            <Music size={28} />
                          ) : (
                            <FileIcon size={28} />
                          )}
                          <span style={{ fontSize: 10, textAlign: "center", wordBreak: "break-all", maxWidth: 100 }}>{entry.name.length > 20 ? entry.name.slice(0, 17) + "..." : entry.name}</span>
                        </button>
                      );
                    })
                  )}
                </>
              )}
            </div>
          )}

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
