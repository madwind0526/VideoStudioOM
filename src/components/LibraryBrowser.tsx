import { ArrowDownAZ, Check, Clock, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, mediaUrl, type MediaFile } from "../api";

const FAVORITES_FILE = "studio/favorites.json";
const fileUrl = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/file`;

export type SortOrder = "time" | "name";

export interface Favorites {
  has: (path: string) => boolean;
  toggle: (path: string) => void;
}

/** The starred pictures of the library, kept in studio/favorites.json of the library project. */
export function useFavorites(projectId: string): Favorites {
  const [paths, setPaths] = useState<string[]>([]);
  // The file API wants the modified time of the file it replaces; saves go one after another so each one sees the last one's time.
  const mtime = useRef<number | null>(null);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<string[]>([]);

  useEffect(() => {
    api<{ content: string | null; mtimeMs: number | null }>("GET", `${fileUrl(projectId)}?path=${encodeURIComponent(FAVORITES_FILE)}&optional=1`)
      .then((data) => {
        mtime.current = data.mtimeMs;
        try {
          const list = data.content ? (JSON.parse(data.content) as { paths?: unknown }).paths : [];
          latest.current = Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
        } catch {
          latest.current = [];
        }
        setPaths(latest.current);
      })
      .catch(() => undefined);
  }, [projectId]);

  const toggle = useCallback(
    (path: string) => {
      const next = latest.current.includes(path) ? latest.current.filter((item) => item !== path) : [...latest.current, path];
      latest.current = next;
      setPaths(next);
      saving.current = saving.current.then(() =>
        api<{ mtimeMs: number }>("PUT", fileUrl(projectId), { path: FAVORITES_FILE, content: `${JSON.stringify({ paths: next }, null, 2)}\n`, expectedMtimeMs: mtime.current })
          .then((saved) => {
            mtime.current = saved.mtimeMs;
          })
          .catch(() => undefined),
      );
    },
    [projectId],
  );

  return useMemo(() => ({ has: (path: string) => paths.includes(path), toggle }), [paths, toggle]);
}

/** Starred pictures first, then newest first or A to Z. */
export function sortImages(images: MediaFile[], favorites: Favorites, order: SortOrder): MediaFile[] {
  const name = (file: MediaFile) => file.path.slice(file.path.lastIndexOf("/") + 1);
  return [...images].sort((a, b) => Number(favorites.has(b.path)) - Number(favorites.has(a.path)) || (order === "time" ? b.mtimeMs - a.mtimeMs : name(a).localeCompare(name(b), "ko", { numeric: true })));
}

/** Two icon buttons: newest first, A to Z. */
export function SortButtons({ order, onChange }: { order: SortOrder; onChange: (order: SortOrder) => void }) {
  return (
    <div className="row" style={{ gap: 4 }} role="group" aria-label="정렬">
      <button className="icon-btn" type="button" aria-pressed={order === "time"} title="시간순 (새 그림 먼저)" aria-label="시간순" onClick={() => onChange("time")} style={order === "time" ? { color: "var(--primary, #2f9e7e)" } : undefined}>
        <Clock size={16} />
      </button>
      <button className="icon-btn" type="button" aria-pressed={order === "name"} title="이름순 (A-Z)" aria-label="이름순" onClick={() => onChange("name")} style={order === "name" ? { color: "var(--primary, #2f9e7e)" } : undefined}>
        <ArrowDownAZ size={16} />
      </button>
    </div>
  );
}

/** A square card of a picture: star at the top left, the tools (if any) at the top right. */
export function LibraryCard({ projectId, file, favorites, picked, onClick, onDoubleClick, tools }: { projectId: string; file: MediaFile; favorites: Favorites; picked?: boolean; onClick: () => void; onDoubleClick?: () => void; tools?: ReactNode }) {
  const starred = favorites.has(file.path);
  return (
    <div className="media-item">
      <button type="button" title={file.path} aria-pressed={picked} className={picked ? "picked" : undefined} onClick={onClick} onDoubleClick={onDoubleClick}>
        <img src={mediaUrl(projectId, file.path, file.mtimeMs)} alt={file.path} loading="lazy" />
      </button>
      <button className={`fav-star${starred ? " on" : ""}`} type="button" aria-label={starred ? "즐겨찾기 빼기" : "즐겨찾기"} aria-pressed={starred} title={starred ? "즐겨찾기 빼기" : "즐겨찾기"} onClick={() => favorites.toggle(file.path)}>
        <Star size={15} fill={starred ? "currentColor" : "none"} />
      </button>
      {picked && (
        <span className="pick-mark" aria-hidden="true">
          <Check size={14} />
        </span>
      )}
      {tools}
    </div>
  );
}

interface Props {
  projectId: string;
  images: MediaFile[];
  favorites: Favorites;
  order: SortOrder;
  onOrder: (order: SortOrder) => void;
  title: string;
  onClose: () => void;
  /** Viewing: a click opens the picture and `tools` are shown on every card. */
  onOpen?: (path: string) => void;
  tools?: (file: MediaFile) => ReactNode;
  /** Picking: cards are chosen (`max` of them) and handed over with the button. */
  pick?: { selected: string[]; max: number; onPick: (paths: string[]) => void };
}

/** The library as cards in a pop-up: starred first, sortable, either to look at (and work on) or to pick pictures from. */
export default function LibraryBrowser({ projectId, images, favorites, order, onOrder, title, onClose, onOpen, tools, pick }: Props) {
  const [chosen, setChosen] = useState<string[]>(pick?.selected ?? []);
  const sorted = useMemo(() => sortImages(images, favorites, order), [images, favorites, order]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (path: string) => setChosen((list) => (list.includes(path) ? list.filter((item) => item !== path) : pick && pick.max === 1 ? [path] : pick && list.length >= pick.max ? list : [...list, path]));

  return (
    <div className="backdrop" style={{ zIndex: 50 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(1100px, 100%)" }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>
            {title} <span className="count">{images.length}</span>
          </h2>
          <SortButtons order={order} onChange={onOrder} />
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {sorted.length === 0 ? (
            <p className="muted">보관함에 그림이 없습니다.</p>
          ) : (
            <div className="thumbs big square">
              {sorted.map((file) => (
                <LibraryCard
                  key={file.path}
                  projectId={projectId}
                  file={file}
                  favorites={favorites}
                  picked={pick ? chosen.includes(file.path) : undefined}
                  onClick={() => (pick ? toggle(file.path) : onOpen?.(file.path))}
                  onDoubleClick={
                    pick
                      ? () => {
                          // Double click takes this picture alone (plus the ones already chosen when several are allowed).
                          pick.onPick(pick.max === 1 ? [file.path] : [...new Set([...chosen, file.path])].slice(0, pick.max));
                          onClose();
                        }
                      : undefined
                  }
                  tools={tools?.(file)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          {pick && <span className="muted">{pick.max > 1 ? `${chosen.length}/${pick.max}장 선택` : chosen.length ? "1장 선택" : "그림을 고르세요"}</span>}
          <button className="btn" type="button" onClick={onClose}>
            {pick ? "취소" : "닫기"}
          </button>
          {pick && (
            <button
              className="btn primary"
              type="button"
              disabled={chosen.length === 0}
              onClick={() => {
                pick.onPick(chosen);
                onClose();
              }}
            >
              가져오기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
