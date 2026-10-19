import type { ReactNode } from "react";

export interface SortOption<T extends string> {
  key: T;
  label: string;
  icon: ReactNode;
}

/**
 * Icon-only sort buttons in one rounded group (same bar as MemoReader and SongYUE2). Each button
 * explains itself on hover and the chosen order is filled in.
 */
export default function SortBar<T extends string>({ options, value, onChange, label = "정렬" }: { options: SortOption<T>[]; value: T; onChange: (key: T) => void; label?: string }) {
  return (
    <span className="sortbar" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.key} type="button" className={value === option.key ? "active" : ""} aria-label={option.label} aria-pressed={value === option.key} title={option.label} onClick={() => onChange(option.key)}>
          {option.icon}
        </button>
      ))}
    </span>
  );
}
