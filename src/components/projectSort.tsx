import { ArrowDownAZ, Clock, ListChecks, Star, Timer } from "lucide-react";
import type { ProjectSummary } from "../api";
import { stagesDone } from "../format";
import type { SortOption } from "./SortBar";

export type SortGroup = "date" | "az" | "stage" | "length" | "favorite";
export interface SortState {
  group: SortGroup;
  asc: boolean;
}

export const DEFAULT_SORT: SortState = { group: "date", asc: false };

const newestFirst = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt - a.updatedAt;

export function compareProjects({ group, asc }: SortState): (a: ProjectSummary, b: ProjectSummary) => number {
  switch (group) {
    case "date":
      return asc ? (a, b) => a.updatedAt - b.updatedAt : newestFirst;
    case "az":
      return asc ? (a, b) => a.title.localeCompare(b.title, "ko") : (a, b) => b.title.localeCompare(a.title, "ko");
    case "stage":
      // How far a project is (steps done of 6); the newest first within the same step.
      return (a, b) => (asc ? stagesDone(a) - stagesDone(b) : stagesDone(b) - stagesDone(a)) || newestFirst(a, b);
    case "length":
      return (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1) || newestFirst(a, b);
    case "favorite":
      return (a, b) => Number(b.favorite) - Number(a.favorite) || newestFirst(a, b);
  }
}

/**
 * Date, title and step buttons flip their direction on every click after the first one. The first click gives newest first,
 * 가나다 (ascending) and furthest first; length and favorites just pick their order.
 */
export const nextSort = (current: SortState, group: SortGroup): SortState => {
  if (group !== "date" && group !== "az" && group !== "stage") return { group, asc: false };
  return current.group === group ? { group, asc: !current.asc } : { group, asc: group === "az" };
};

/** Icon-only sort buttons (same icons as MemoReader) for SortBar. */
export function sortOptions(sort: SortState): SortOption<SortGroup>[] {
  const dateOn = sort.group === "date";
  return [
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
    {
      key: "az",
      label: `제목순 (${sort.group === "az" ? (sort.asc ? "가나다 오름차순" : "역순 내림차순") : "클릭하면 가나다순"})`,
      icon: (
        <span className="sort-dir">
          <ArrowDownAZ size={15} />
          {sort.group === "az" && <small>{sort.asc ? "↑" : "↓"}</small>}
        </span>
      ),
    },
    {
      key: "stage",
      label: `프로젝트 단계별 (${sort.group === "stage" ? (sort.asc ? "적게 진행된 것 먼저" : "많이 진행된 것 먼저") : "클릭하면 많이 진행된 것 먼저"})`,
      icon: (
        <span className="sort-dir">
          <ListChecks size={15} />
          {sort.group === "stage" && <small>{sort.asc ? "↑" : "↓"}</small>}
        </span>
      ),
    },
    { key: "length", label: "긴 영상 먼저", icon: <Timer size={15} /> },
    { key: "favorite", label: "즐겨찾기 먼저", icon: <Star size={15} /> },
  ];
}
