import { ArrowRight, Film, Heart, MoreVertical, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mediaUrl, type ProjectSummary } from "../api";
import { formatDate, formatTime, stagesDone, stateOf } from "../format";

interface Props {
  project: ProjectSummary;
  isCurrent: boolean;
  playing: boolean;
  onPlay: (id: string | null) => void;
  onOpenDetail: (id: string) => void;
  onWork: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  /** Makes this project the one whose settings are shown (start page only). */
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Opens the pop-up player instead of playing in the card (library pages). */
  onPlayPopup?: (id: string) => void;
}

/** SongYUE2-style card: thumbnail (click = play, click again = stop), title and info (click = details), actions, play time. */
export default function ProjectCard({ project, isCurrent, playing, onPlay, onOpenDetail, onWork, onFavorite, onSelect, onDelete, onPlayPopup }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const state = stateOf(project);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  // A video exists (the finished one or the newest clip): click plays it (pop-up, or in the card where there is none), a second click stops it. Otherwise the details window is the useful next step.
  const onThumb = () => (project.video ? (onPlayPopup ? onPlayPopup(project.id) : onPlay(playing ? null : project.id)) : onOpenDetail(project.id));
  const videoUrl = project.video ? mediaUrl(project.id, project.video) : undefined;
  const poster = project.poster ? mediaUrl(project.id, project.poster) : undefined;

  function remove() {
    if (window.confirm(`"${project.title}" 프로젝트를 지울까요?\n파일은 projects/.trash 폴더로 옮겨지며, 목록에서만 사라집니다.`)) onDelete?.(project.id);
  }

  return (
    <article className={`pcard ${state}${isCurrent ? " current" : ""}`} onClick={() => onSelect?.(project.id)}>
      {onDelete && (
        <button className="pdelete" type="button" title="프로젝트 지우기" aria-label="프로젝트 지우기" onClick={(event) => { event.stopPropagation(); remove(); }}>
          <Trash2 size={14} />
        </button>
      )}
      <div className="pthumb">
        <button className="pthumb-btn" type="button" title={project.video ? (playing ? "눌러서 정지" : "눌러서 재생") : "눌러서 자세히 보기"} aria-label={`${project.title} ${project.video ? (playing ? "정지" : "재생") : "자세히 보기"}`} onClick={onThumb}>
          {playing ? (
            <video src={videoUrl} poster={poster} autoPlay playsInline onEnded={() => onPlay(null)} />
          ) : poster ? (
            <img src={poster} alt="" loading="lazy" />
          ) : videoUrl ? (
            // No picture: the first frame of the video stands in as the thumbnail.
            <video src={`${videoUrl}#t=0.1`} preload="metadata" muted playsInline />
          ) : (
            <Film size={30} />
          )}
          {!playing && <span className="play">{project.video && <Play size={34} fill="currentColor" />}</span>}
          {!playing && project.hasFinal && project.durationSeconds !== null && <span className="pbadge">{formatTime(project.durationSeconds)}</span>}
        </button>
      </div>

      <button className="pinfo" type="button" title="자세한 정보 보기" onClick={() => onOpenDetail(project.id)}>
        <span className="ptitle" title={project.title}>
          {project.title}
        </span>
        <span className="pdesc">{project.description || "주제가 아직 없습니다."}</span>
        <span className="chips">
          <span className="chip">{state === "done" ? "완성" : "작업 중"}</span>
          <span className="chip">{stagesDone(project)}/6 단계</span>
          <span className="chip">{formatDate(project.updatedAt)}</span>
        </span>
      </button>

      <div className="pacts">
        <button className={project.favorite ? "act-btn on" : "act-btn"} type="button" title={project.favorite ? "즐겨찾기 해제" : "즐겨찾기"} aria-pressed={project.favorite} onClick={() => onFavorite(project.id, !project.favorite)}>
          <Heart size={15} fill={project.favorite ? "currentColor" : "none"} />
        </button>
        <button className="act-btn" type="button" title="프로젝트 열기" aria-label="프로젝트 열기" onClick={() => onWork(project.id)}>
          <ArrowRight size={15} />
        </button>
        <div ref={menuRef}>
          <button className="act-btn" type="button" title="더 보기" aria-label="더 보기" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <MoreVertical size={15} />
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onOpenDetail(project.id); }}>
                자세히 보기
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onWork(project.id); }}>
                프로젝트 열기
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onFavorite(project.id, !project.favorite); }}>
                {project.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
              </button>
              {onDelete && (
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); remove(); }}>
                  삭제
                </button>
              )}
            </div>
          )}
        </div>
        <span className="ptime" title="완성본 재생 시간">
          {project.hasFinal ? formatTime(project.durationSeconds) : "—:——"}
        </span>
      </div>
    </article>
  );
}
