import { ChevronLeft, ChevronRight, Combine, X } from "lucide-react";
import { useEffect, useState } from "react";
import { mediaUrl, type MediaFile } from "../api";
import type { JoinOptions } from "../sections/mediaJobs";

interface Props {
  projectId: string;
  /** The checked clips, in the order they are shown on the screen. */
  files: MediaFile[];
  /** Joining is running: the dialog stays open and cannot start another. */
  busy: boolean;
  onStart: (order: string[], options: JoinOptions) => void;
  /** A clip was taken out of this join (the screen unchecks it too). */
  onRemove: (path: string) => void;
  onClose: () => void;
}

/** Pop-up for joining clips: the checked clips as thumbnails to put in order (drag and drop, or the arrows), the join options, then 시작. */
export default function JoinDialog({ projectId, files, busy, onStart, onRemove, onClose }: Props) {
  const [order, setOrder] = useState(() => files.map((file) => file.path));
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [colorMatch, setColorMatch] = useState(false);
  const [overlapAuto, setOverlapAuto] = useState(true);
  const [overlap, setOverlap] = useState(0.7);
  const [seamColor, setSeamColor] = useState(true);
  const byPath = new Map(files.map((file) => [file.path, file]));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return;
    setOrder((list) => {
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };

  /** Takes a clip out of this join and unchecks it on the screen; the file stays in the project. */
  const leave = (path: string) => {
    setOrder((list) => list.filter((item) => item !== path));
    onRemove(path);
  };

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div className="modal" style={{ width: "min(1000px, 100%)" }} role="dialog" aria-modal="true" aria-label="이어 붙이기">
        <div className="modal-head">
          <h2>이어 붙이기 순서</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="opts">
            <label>
              <input type="checkbox" checked={colorMatch} disabled={busy} onChange={(event) => setColorMatch(event.target.checked)} /> 이어 붙일 때 구간마다 색을 맞추기
            </label>
            <label title="다음 구간이 앞 구간의 끝에서 앞선 장면에서 시작할 때, 앞 구간의 그 뒤를 잘라 냅니다. 자동은 다음 구간의 첫 장면과 같은 장면을 앞 구간 끝에서 찾아 그 뒤를 자릅니다.">
              이음새 겹침 시간
              <select value={overlapAuto ? "auto" : "manual"} disabled={busy} onChange={(event) => setOverlapAuto(event.target.value === "auto")}>
                <option value="auto">시스템 결정</option>
                <option value="manual">직접 입력</option>
              </select>
              {!overlapAuto && <input type="number" min={0} max={5} step={0.1} value={overlap} disabled={busy} onChange={(event) => setOverlap(Math.min(5, Math.max(0, Number(event.target.value) || 0)))} style={{ width: 72 }} />}
              {!overlapAuto && "초"}
            </label>
            <label title="각 구간의 시작 색을 앞 구간의 끝 색에 맞추고, 설정의 '이음새 색 보정 구간' 시간에 걸쳐 원래 색으로 되돌립니다.">
              <input type="checkbox" checked={seamColor} disabled={busy} onChange={(event) => setSeamColor(event.target.checked)} /> 이음새 색 보정
            </label>
          </div>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
            끌어서 놓거나 화살표로 순서를 바꾸세요. 왼쪽 위의 번호 순서대로 이어 붙입니다. 오른쪽 위의 ×는 이어 붙이기에서 빼고 체크도 풉니다(파일은 지워지지 않아요). ({order.length}개)
          </p>
          <div className="join-grid">
            {order.map((path, index) => {
              const file = byPath.get(path);
              return (
                <div
                  key={path}
                  className={`join-tile${dragging === index ? " dragging" : ""}${over === index && dragging !== index ? " over" : ""}`}
                  draggable={!busy}
                  onDragStart={() => setDragging(index)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setOver(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging !== null) move(dragging, index);
                    setDragging(null);
                    setOver(null);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                >
                  <span className="vthumb">
                    <video src={`${mediaUrl(projectId, path, file?.mtimeMs)}#t=0.1`} preload="metadata" muted playsInline />
                    <span className="join-no">{index + 1}</span>
                    <button className="join-remove" type="button" title="이어 붙이기에서 빼기, 체크 해제 (파일은 그대로 남습니다)" aria-label="이어 붙이기에서 빼기" disabled={busy} onClick={() => leave(path)}>
                      <X size={14} />
                    </button>
                  </span>
                  <span className="vname" title={path}>
                    {path.replace(/^assets\/video\//, "")}
                  </span>
                  <span className="join-arrows">
                    <button className="icon-btn small" type="button" aria-label="앞으로" disabled={busy || index === 0} onClick={() => move(index, index - 1)}>
                      <ChevronLeft size={14} />
                    </button>
                    <button className="icon-btn small" type="button" aria-label="뒤로" disabled={busy || index === order.length - 1} onClick={() => move(index, index + 1)}>
                      <ChevronRight size={14} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="btn primary" type="button" disabled={busy || order.length === 0} onClick={() => onStart(order, { colorMatch, overlapSeconds: overlapAuto ? "auto" : overlap, seamColor })}>
            <Combine size={15} /> {busy ? "이어 붙이는 중..." : `시작 (${order.length}개)`}
          </button>
        </div>
      </div>
    </div>
  );
}
