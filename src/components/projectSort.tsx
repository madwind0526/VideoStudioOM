import { ArrowDownAZ, ArrowDownZA, Clock, Star, Timer } from "lucide-react";
import type { ProjectSummary } from "../api";
import type { SortOption } from "./SortBar";

export type SortGroup = "date" | "az" | "za" | "length" | "favorite";
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
      return (a, b) => a.title.localeCompare(b.title, "ko");
    case "za":
      return (a, b) => b.title.localeCompare(a.title, "ko");
    case "length":
      return (a, b) => (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1) || newestFirst(a, b);
    case "favorite":
      return (a, b) => Number(b.favorite) - Number(a.favorite) || newestFirst(a, b);
  }
}

/** The date button starts newest first and flips on every click after; the others just pick their order. */
export const nextSort = (current: SortState, group: SortGroup): SortState => (group === "date" && current.group === "date" ? { group, asc: !current.asc } : { group, asc: false });

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
    { key: "az", label: "제목 가나다순", icon: <ArrowDownAZ size={15} /> },
    { key: "za", label: "제목 역순", icon: <ArrowDownZA size={15} /> },
    { key: "length", label: "긴 영상 먼저", icon: <Timer size={15} /> },
    { key: "favorite", label: "즐겨찾기 먼저", icon: <Star size={15} /> },
  ];
}
