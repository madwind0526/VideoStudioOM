import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, mediaUrl, type MediaFile, type ProjectDetail, type ProjectSummary } from "../api";
import { ascending } from "../sortOptions";

interface Shelf {
  id: string;
  title: string;
  videos: MediaFile[];
}

/** The video library as cards: the clips of the short-clip menu (the hidden image library) and the videos of every project. */
export default function VideoLibraryDialog({ ownId, own, onPick, onClose }: { ownId: string; own: MediaFile[]; onPick: (path: string) => void; onClose: () => void }) {
  const [shelves, setShelves] = useState<Shelf[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ projects: ProjectSummary[] }>("GET", "/api/projects")
      .then(async ({ projects }) => {
        const loaded: Shelf[] = [{ id: ownId, title: "영상 clip · 가져온 영상", videos: own }];
        for (const project of ascending(projects, (item) => item.title)) {
          const detail = await api<{ project: ProjectDetail }>("GET", `/api/projects/${encodeURIComponent(project.id)}`);
          if (detail.project.media.videos.length > 0) loaded.push({ id: project.id, title: project.title, videos: detail.project.media.videos });
        }
        if (alive) setShelves(loaded);
      })
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : "동영상 라이브러리를 열지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [ownId, own]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** A video of another project is copied into the library project first; one that is already there is used as it is. */
  async function pick(shelf: Shelf, file: MediaFile) {
    if (shelf.id === ownId) return onPick(file.path);
    setBusy(true);
    try {
      const { path } = await api<{ path: string }>("POST", `/api/projects/${encodeURIComponent(ownId)}/import`, { kind: "video", fromProject: shelf.id, path: file.path });
      onPick(path);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "영상을 가져오지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" style={{ zIndex: 70 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(1000px, 100%)" }} role="dialog" aria-modal="true" aria-label="Lib에서 영상 가져오기">
        <div className="modal-head">
          <h2>Lib에서 영상 가져오기</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>영상을 두 번 누르면 바로 가져옵니다.</p>
          {error && <p className="error">{error}</p>}
          {!shelves && !error && <p className="muted">불러오는 중입니다...</p>}
          {shelves?.length === 0 && <p className="muted">영상이 없습니다.</p>}
          {shelves?.map((shelf) => (
            <section key={shelf.id} style={{ marginBottom: 18 }}>
              <h3 style={{ margin: "0 0 8px" }}>
                {shelf.title} <span className="count">{shelf.videos.length}</span>
              </h3>
              {shelf.videos.length === 0 ? (
                <p className="muted">영상이 없습니다.</p>
              ) : (
                <div className="pl-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                  {ascending(shelf.videos, (file) => file.path).map((file) => (
                    <button key={file.path} className="pl-card" type="button" disabled={busy} title={file.path} onDoubleClick={() => void pick(shelf, file)} style={{ textAlign: "left", cursor: "pointer" }}>
                      <video src={mediaUrl(shelf.id, file.path, file.mtimeMs)} muted preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000", pointerEvents: "none" }} />
                      <strong style={{ display: "block", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{file.path.replace(/^(assets|renders)\//, "")}</strong>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
