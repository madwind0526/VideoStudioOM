import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectSummary } from "../api";
import ProjectCard from "./ProjectCard";
import { compareProjects, DEFAULT_SORT, nextSort, sortOptions, type SortState } from "./projectSort";
import SortBar from "./SortBar";

interface Props {
  projects: ProjectSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onNew: () => void;
}

/** The middle column of the project screen: project cards in one scrolling vertical list. */
export default function ProjectPicker({ projects, selectedId, onSelect, onFavorite, onNew }: Props) {
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = projects.filter((project) => !needle || `${project.title} ${project.description}`.toLowerCase().includes(needle));
    return [...list].sort(compareProjects(sort));
  }, [projects, sort, query]);

  return (
    <aside className="proj-list" aria-label="프로젝트 목록">
      <div className="proj-list-head">
        <h1>
          프로젝트<span className="count">{projects.length}</span>
        </h1>
        <button className="icon-btn" type="button" title="새 프로젝트" aria-label="새 프로젝트" onClick={onNew}>
          <Plus size={18} />
        </button>
      </div>
      <div className="proj-list-tools">
        <label className="search">
          <Search size={14} />
          <input value={query} placeholder="검색" aria-label="프로젝트 검색" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <SortBar options={sortOptions(sort)} value={sort.group} onChange={(group) => setSort((current) => nextSort(current, group))} />
      </div>
      <div className="proj-list-scroll">
        {visible.length === 0 ? (
          <p className="muted" style={{ padding: "8px 4px", fontSize: 12 }}>
            {projects.length === 0 ? "아직 프로젝트가 없어요." : "검색 결과가 없어요."}
          </p>
        ) : (
          visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCurrent={project.id === selectedId}
              playing={playingId === project.id}
              onPlay={setPlayingId}
              onOpenDetail={onSelect}
              onWork={onSelect}
              onFavorite={onFavorite}
            />
          ))
        )}
      </div>
    </aside>
  );
}
