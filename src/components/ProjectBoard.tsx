import { Film, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { ProjectSummary } from "../api";
import ProjectCard from "./ProjectCard";
import { compareProjects, DEFAULT_SORT, nextSort, sortOptions, type SortState } from "./projectSort";
import SortBar from "./SortBar";

type TabId = "all" | "done" | "draft" | "favorite";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "done", label: "완성본" },
  { id: "draft", label: "작업 중" },
  { id: "favorite", label: "즐겨찾기" },
];

interface Props {
  kicker: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  projects: ProjectSummary[];
  currentId: string | null;
  /** Which tabs to offer (default all four). With one tab or none, the tab buttons are hidden. */
  tabIds?: TabId[];
  onWork: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
}

const matchesTab = (project: ProjectSummary, tab: TabId) =>
  tab === "all" || (tab === "done" && project.hasFinal) || (tab === "draft" && !project.hasFinal) || (tab === "favorite" && project.favorite);

/** A page of project cards in a grid: header, tabs with search and the sort bar. */
export default function ProjectBoard({ kicker, title, subtitle, action, projects, currentId, tabIds, onWork, onOpenDetail, onFavorite }: Props) {
  const [tab, setTab] = useState<TabId>("all");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const tabs = TABS.filter((item) => !tabIds || tabIds.includes(item.id));
  const counts = useMemo(() => Object.fromEntries(TABS.map(({ id }) => [id, projects.filter((project) => matchesTab(project, id)).length])), [projects]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = projects.filter((project) => matchesTab(project, tab) && (!needle || `${project.title} ${project.description}`.toLowerCase().includes(needle)));
    return [...list].sort(compareProjects(sort));
  }, [projects, tab, sort, query]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">{kicker}</div>
          <h1>
            {title}
            <span className="count">{projects.length}</span>
          </h1>
          <p className="sub">{subtitle}</p>
        </div>
        {action}
      </div>

      <div className="tabs" role="tablist">
        {tabs.length > 1 &&
          tabs.map(({ id, label }) => (
            <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              <span className="count">{counts[id]}</span>
            </button>
          ))}
        <span className="spacer" />
        <label className="search">
          <Search size={14} />
          <input value={query} placeholder="프로젝트 검색" aria-label="프로젝트 검색" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <SortBar options={sortOptions(sort)} value={sort.group} onChange={(group) => setSort((current) => nextSort(current, group))} />
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <div className="tile">
            <Film size={30} />
          </div>
          <strong>{projects.length === 0 ? "아직 프로젝트가 없어요" : "조건에 맞는 프로젝트가 없어요"}</strong>
          <span>{projects.length === 0 ? "왼쪽에서 새 프로젝트를 만들어 보세요." : "탭이나 검색어를 바꿔 보세요."}</span>
        </div>
      ) : (
        <div className="grid">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCurrent={project.id === currentId}
              playing={playingId === project.id}
              onPlay={setPlayingId}
              onOpenDetail={onOpenDetail}
              onWork={onWork}
              onFavorite={onFavorite}
            />
          ))}
        </div>
      )}
    </>
  );
}
