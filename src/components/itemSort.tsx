import { ArrowDownAZ, Clock, Search, Star } from "lucide-react";
import SortBar, { type SortOption } from "./SortBar";

/** Sorting of the library lists (pictures, prompts): newest or oldest, A-Z or Z-A, starred first (the default, newest first within it). */
export type ItemSortGroup = "date" | "az" | "favorite";
export interface ItemSort {
  group: ItemSortGroup;
  asc: boolean;
}

export const DEFAULT_ITEM_SORT: ItemSort = { group: "favorite", asc: false };

/** Date and name flip their direction on every click after the first one (newest first, 가나다 first); favorites just pick their order. */
export const nextItemSort = (current: ItemSort, group: ItemSortGroup): ItemSort => {
  if (group === "favorite") return { group, asc: false };
  return current.group === group ? { group, asc: !current.asc } : { group, asc: group === "az" };
};

/** The comparison of two items; `date` is a time (ms), `name` the text to sort by, `starred` whether the item is a favorite. */
export function compareItems<T>(sort: ItemSort, get: { date: (item: T) => number; name: (item: T) => string; starred: (item: T) => boolean }): (a: T, b: T) => number {
  const newest = (a: T, b: T) => get.date(b) - get.date(a);
  switch (sort.group) {
    case "date":
      return sort.asc ? (a, b) => get.date(a) - get.date(b) : newest;
    case "az":
      return sort.asc ? (a, b) => get.name(a).localeCompare(get.name(b), "ko", { numeric: true }) : (a, b) => get.name(b).localeCompare(get.name(a), "ko", { numeric: true });
    case "favorite":
      return (a, b) => Number(get.starred(b)) - Number(get.starred(a)) || newest(a, b);
  }
}

function itemSortOptions(sort: ItemSort): SortOption<ItemSortGroup>[] {
  const arrow = (group: ItemSortGroup) => (sort.group === group ? <small>{sort.asc ? "↑" : "↓"}</small> : null);
  return [
    {
      key: "date",
      label: `만든 날짜 순 (${sort.group === "date" ? (sort.asc ? "오름차순, 오래된 것 먼저" : "내림차순, 최근 것 먼저") : "클릭하면 최근 것 먼저"})`,
      icon: (
        <span className="sort-dir">
          <Clock size={15} />
          {arrow("date")}
        </span>
      ),
    },
    {
      key: "az",
      label: `이름순 (${sort.group === "az" ? (sort.asc ? "가나다 오름차순" : "역순 내림차순") : "클릭하면 가나다순"})`,
      icon: (
        <span className="sort-dir">
          <ArrowDownAZ size={15} />
          {arrow("az")}
        </span>
      ),
    },
    { key: "favorite", label: "즐겨찾기 먼저 (그 안에서는 최근 것 먼저)", icon: <Star size={15} /> },
  ];
}

/** The search box and the sort buttons of a library page, in the row of its subtitle. */
export default function ItemToolbar({ query, onQuery, placeholder, sort, onSort }: { query: string; onQuery: (query: string) => void; placeholder: string; sort: ItemSort; onSort: (sort: ItemSort) => void }) {
  return (
    <div className="sub-tools">
      <label className="search">
        <Search size={14} />
        <input value={query} placeholder={placeholder} aria-label={placeholder} onChange={(event) => onQuery(event.target.value)} />
      </label>
      <SortBar options={itemSortOptions(sort)} value={sort.group} onChange={(group) => onSort(nextItemSort(sort, group))} />
    </div>
  );
}
