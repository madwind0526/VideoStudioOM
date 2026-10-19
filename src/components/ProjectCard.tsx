import { ArrowRight, Film, Heart, MoreVertical, Play, X } from "lucide-react";
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
}

/** SongYUE2-style card: thumbnail (click = play), title and info (click = details), actions, play time. */
export default function ProjectCard({ project, isCurrent, playing, onPlay, onOpenDetail, onWork, onFavorite }: Props) {
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

  // A video exists: play it right here. Otherwise the details window is the useful next step.
  const onThumb = () => (project.hasFinal ? onPlay(project.id) : onOpenDetail(project.id));

  return (
    <article className={`pcard ${state}${isCurrent ? " current" : ""}`}>
      <div className="pthumb">
        {playing ? (
          <>
            <video src={mediaUrl(project.id, "renders/final.mp4")} poster={project.poster ? mediaUrl(project.id, project.poster) : undefined} autoPlay controls onEnded={() => onPlay(null)} />
            <button className="pclose" type="button" title="재생 닫기" aria-label="재생 닫기" onClick={() => onPlay(null)}>
              <X size={14} />
            </button>
          </>
        ) : (
          <button className="pthumb-btn" type="button" title={project.hasFinal ? "눌러서 재생" : "눌러서 자세히 보기"} aria-label={`${project.title} ${project.hasFinal ? "재생" : "자세히 보기"}`} onClick={onThumb}>
            {project.poster ? <img src={mediaUrl(project.id, project.poster)} alt="" loading="lazy" /> : <Film size={30} />}
            <span className="play">{project.hasFinal && <Play size={34} fill="currentColor" />}</span>
            {project.hasFinal && project.durationSeconds !== null && <span className="pbadge">{formatTime(project.durationSeconds)}</span>}
          </button>
        )}
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
        <button className="act-btn" type="button" title="이 프로젝트로 작업하기" aria-label="이 프로젝트로 작업하기" onClick={() => onWork(project.id)}>
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
                이 프로젝트로 작업하기
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onFavorite(project.id, !project.favorite); }}>
                {project.favorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
              </button>
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
