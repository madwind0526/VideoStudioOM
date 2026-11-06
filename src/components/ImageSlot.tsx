import { FolderOpen, Images, X } from "lucide-react";
import { useState } from "react";
import { ApiError, mediaUrl, type MediaFile } from "../api";
import Lightbox from "./Lightbox";
import type { SectionProps } from "../sections/types";
import { importImage } from "../sections/mediaJobs";
import FileNavigator from "./FileNavigator";
import LibraryBrowser, { type Favorites, type SortOrder } from "./LibraryBrowser";

const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`);

/** One chosen picture: a small picture (click: big view), its file name and size beside it, and X to take it out. */
function Chosen({ projectId, path, file, number, onOpen, onRemove }: { projectId: string; path: string; file?: MediaFile; number?: number; onOpen: () => void; onRemove: () => void }) {
  const [pixels, setPixels] = useState("");
  return (
    <div className="slot-item">
      <button type="button" className="slot-thumb" title="크게 보기" onClick={onOpen}>
        <img src={mediaUrl(projectId, path, file?.mtimeMs)} alt={path} onLoad={(event) => setPixels(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)} />
      </button>
      <div className="slot-info">
        <strong title={path}>{number ? `그림${number} · ` : ""}{path.slice(path.lastIndexOf("/") + 1)}</strong>
        <span className="muted">{[pixels, file ? sizeLabel(file.size) : ""].filter(Boolean).join(" · ")}</span>
      </div>
      <button className="icon-btn" type="button" aria-label="빼기" title="빼기" onClick={onRemove}>
        <X size={15} />
      </button>
    </div>
  );
}

interface Props {
  props: SectionProps;
  images: MediaFile[];
  favorites: Favorites;
  order: SortOrder;
  onOrder: (order: SortOrder) => void;
  label: string;
  /** The chosen pictures (project-relative paths) and how many may be chosen. */
  value: string[];
  max: number;
  /** Show "그림1", "그림2", ... in front of the names (the prompt points at the pictures by these numbers). */
  numbered?: boolean;
  onChange: (paths: string[]) => void;
}

/** Pictures chosen from a file on disk (explorer) or from the library (pop-up with cards); the chosen ones are shown small. */
export default function ImageSlot({ props, images, favorites, order, onOrder, label, value, max, numbered, onChange }: Props) {
  const { project, notify, onJobsChanged } = props;
  const [files, setFiles] = useState(false);
  const [library, setLibrary] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const add = (path: string) => onChange(max === 1 ? [path] : value.includes(path) || value.length >= max ? value : [...value, path]);

  return (
    <div className="field wide" style={{ marginTop: 14 }}>
      <label>{label}</label>
      {value.length > 0 && (
        <div className="slot-list">
          {value.map((path, index) => (
            <Chosen key={path} projectId={project.id} path={path} number={numbered ? index + 1 : undefined} file={images.find((item) => item.path === path)} onOpen={() => setViewing(path)} onRemove={() => onChange(value.filter((item) => item !== path))} />
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" onClick={() => setFiles(true)}>
          <FolderOpen size={15} /> 파일에서 가져오기
        </button>
        <button className="btn" type="button" onClick={() => setLibrary(true)}>
          <Images size={15} /> Lib에서 가져오기
        </button>
      </div>
      {viewing && <Lightbox src={mediaUrl(project.id, viewing, images.find((item) => item.path === viewing)?.mtimeMs)} alt={viewing} onClose={() => setViewing(null)} />}
      {library && (
        <LibraryBrowser
          projectId={project.id}
          images={images}
          favorites={favorites}
          order={order}
          onOrder={onOrder}
          title="Lib에서 가져오기"
          onClose={() => setLibrary(false)}
          pick={{ selected: value, max, onPick: onChange }}
        />
      )}
      {files && (
        <FileNavigator
          title="이미지 가져오기"
          accept={[".png", ".jpg", ".jpeg", ".webp"]}
          projectId={project.id}
          onClose={() => setFiles(false)}
          onPick={(from) => {
            setFiles(false);
            importImage(project.id, from)
              .then((path) => {
                add(path);
                onJobsChanged();
                notify("그림을 보관함에 가져왔습니다.");
              })
              .catch((e) => notify(e instanceof ApiError ? e.message : "그림을 가져오지 못했습니다."));
          }}
        />
      )}
    </div>
  );
}
