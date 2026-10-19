import { ArrowDownAZ, ArrowDownZA, Clock, Film, Search, Star, Timer } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { ProjectSummary } from "../api";
import ProjectCard from "./ProjectCard";
import SortBar, { type SortOption } from "./SortBar";

type TabId = "all" | "done" | "draft" | "favorite";
type SortGroup = "date" | "az" | "za" | "length" | "favorite";
type SortState = { group: SortGroup; asc: boolean };

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
  onWork: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
}

const matchesTab = (project: ProjectSummary, tab: TabId) =>
  tab === "all" || (tab === "done" && project.hasFinal) || (tab === "draft" && !project.hasFinal) || (tab === "favorite" && project.favorite);

const newestFirst = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt - a.updatedAt;

function compare({ group, asc }: SortState): (a: ProjectSummary, b: ProjectSummary) => number {
  switch (group) {
    case "date":
      return asc ? (a, b) => a.updatedAt - b.updatedAt : newestFirst;
    case "az":
      return (a, b) => a.title.localeCompare(b.title, "ko");
    case "za":
      return (a, b) => b.title.localeCompare(a.title, "ko");
    case "length":
      return (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1) || newestFirst(a, b);
    case "favorite":
      return (a, b) => Number(b.favorite) - Number(a.favorite) || newestFirst(a, b);
  }
}

/** The "내 작업" area: header, tabs with search and the sort bar, and the card grid. */
export default function ProjectBoard({ kicker, title, subtitle, action, projects, currentId, onWork, onOpenDetail, onFavorite }: Props) {
  const [tab, setTab] = useState<TabId>("all");
  const [sort, setSort] = useState<SortState>({ group: "date", asc: false });
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(TABS.map(({ id }) => [id, projects.filter((project) => matchesTab(project, id)).length])), [projects]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = projects.filter((project) => matchesTab(project, tab) && (!needle || `${project.title} ${project.description}`.toLowerCase().includes(needle)));
    return [...list].sort(compare(sort));
  }, [projects, tab, sort, query]);

  // The date button starts newest first and flips on every click after; the others just pick their order.
  const pick = (group: SortGroup) => setSort((current) => (group === "date" && current.group === "date" ? { group, asc: !current.asc } : { group, asc: false }));

  const dateOn = sort.group === "date";
  const options: SortOption<SortGroup>[] = [
    {
      key: "date",
      label: `수정 날짜 순 (${dateOn ? (sort.asc ? "오름차순, 오래된 것 먼저" : "내림차순, 최근 것 먼저") : "클릭하면 최근 것 먼저"})`,
      icon: (
        <span className="sort-dir">
          <Clock size={15} />
          {dateOn && <small>{sort.asc ? "↑" : "↓"}</small>}
        </span>
      ),
    },
    { key: "az", label: "제목 가나다순", icon: <ArrowDownAZ size={15} /> },
    { key: "za", label: "제목 역순", icon: <ArrowDownZA size={15} /> },
    { key: "length", label: "긴 영상 먼저", icon: <Timer size={15} /> },
    { key: "favorite", label: "즐겨찾기 먼저", icon: <Star size={15} /> },
  ];

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
        {TABS.map(({ id, label }) => (
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
        <SortBar options={options} value={sort.group} onChange={pick} />
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
