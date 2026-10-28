import { FolderOpen, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";

interface Props {
  title: string;
  /** The picture, or null while there is none ("No Image"). */
  src: string | null;
  /** Said under the picture, e.g. that it is shared with the next clip. */
  note?: string;
  /** The picture cannot be made now (another job is running, no scene text). */
  busy: boolean;
  onMake: () => void;
  onBrowse: () => void;
  onClose: () => void;
}

/** Viewer of one first or last picture of a clip: big, with the two ways to get a new one (make it, or read it from a file). */
export default function PictureDialog({ title, src, note, busy, onMake, onBrowse, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(560px, 100%)" }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="picture-view">{src ? <img src={src} alt={title} /> : <span className="slot-empty">No Image</span>}</div>
          {note && <p className="hint">{note}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" disabled={busy} onClick={onBrowse}>
            <FolderOpen size={15} /> 파일에서 읽기
          </button>
          <button className="btn primary" type="button" disabled={busy} title={src ? "새 이미지를 만들어 다음 버전으로 두기" : undefined} onClick={onMake}>
            <RefreshCw size={15} /> 새로 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
