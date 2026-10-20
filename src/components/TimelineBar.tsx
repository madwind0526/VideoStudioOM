import { useRef } from "react";

export interface Segment {
  label: string;
  start: number;
  end: number;
}

interface Props {
  segments: Segment[];
  /** A boundary between segment `index` and `index + 1` moved to `seconds` (half-second steps; the total stays the same). */
  onBoundary: (index: number, seconds: number) => void;
}

const MIN_SECONDS = 1;
const COLORS = ["#2f6f62", "#3d5a80", "#7a4f8c", "#8c6a3a", "#4f7a3d", "#8c4a4a"];

/** The scenes as one bar. Drag a boundary to give one scene time from its neighbour; the total length is locked. */
export default function TimelineBar({ segments, onBoundary }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const total = segments.at(-1)?.end ?? 0;
  if (segments.length === 0 || !(total > 0)) return null;

  function drag(index: number, event: React.PointerEvent<HTMLButtonElement>) {
    const element = bar.current;
    if (!element) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const left = segments[index];
    const right = segments[index + 1];
    const move = (moveEvent: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const raw = ((moveEvent.clientX - rect.left) / rect.width) * total;
      const snapped = Math.round(raw * 2) / 2;
      onBoundary(index, Math.min(right.end - MIN_SECONDS, Math.max(left.start + MIN_SECONDS, snapped)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div className="timeline" ref={bar} aria-label="장면 타임라인">
      {segments.map((segment, index) => {
        const seconds = segment.end - segment.start;
        const joined = index < segments.length - 1 && Math.abs(segment.end - segments[index + 1].start) < 0.01;
        return (
          <div key={index} className="timeline-seg" style={{ flex: `${seconds} 0 0`, background: COLORS[index % COLORS.length] }} title={`${index + 1}번 · ${seconds}초`}>
            <span>
              {index + 1} · {seconds}초
            </span>
            {joined && <button type="button" className="timeline-handle" aria-label={`${index + 1}번과 ${index + 2}번 장면 경계 옮기기`} onPointerDown={(event) => drag(index, event)} />}
          </div>
        );
      })}
    </div>
  );
}
