import { BookmarkPlus, RefreshCw, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, mediaUrl, type MediaFile } from "../api";
import { ascending } from "../sortOptions";
import ItemToolbar, { compareItems, DEFAULT_ITEM_SORT, type ItemSort } from "../components/itemSort";
import { LibraryCard, useFavorites } from "../components/LibraryBrowser";
import { useProjectDetail } from "../useProject";
import { useModelChoice } from "../components/ModelPicker";
import type { Handoff } from "../handoff";
import { deleteMedia } from "../sections/mediaJobs";
import { IMAGE_LIBRARY, makePictures, PromptViewer } from "./PromptLibrary";

const GROUPS = [
  { id: "image-local", label: "이미지-Local" },
  { id: "image-api", label: "이미지-API" },
];

/** The pictures of the image menu as cards; a click shows the picture with the prompt it was made from (and keeps it in the prompt library). */
export default function LibraryImages({ jobTick, notify, onSend }: { jobTick: number; notify: (text: string) => void; onSend: (handoff: Handoff) => void }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<ItemSort>(DEFAULT_ITEM_SORT);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<MediaFile | null>(null);
  const [group, setGroup] = useState(GROUPS[0].id);
  const favorites = useFavorites(IMAGE_LIBRARY);
  const model = useModelChoice("t2i");

  useEffect(() => {
    api("POST", "/api/images/ensure", {})
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof ApiError ? e.message : "이미지 보관함을 열지 못했습니다."));
  }, []);
  const { detail, reload } = useProjectDetail(IMAGE_LIBRARY, jobTick);

  if (error) return <p className="error" style={{ padding: 24 }}>{error}</p>;
  if (!ready || !detail) return <p className="muted" style={{ padding: 24 }}>이미지 보관함을 여는 중입니다...</p>;
  const needle = query.trim().toLowerCase();
  const nameOf = (file: MediaFile) => file.path.slice(file.path.lastIndexOf("/") + 1);
  // The search looks at the file name and at the prompt the picture was made from.
  const images = detail.media.images
    .filter((file) => !needle || `${nameOf(file)} ${typeof file.record?.prompt === "string" ? file.record.prompt : ""}`.toLowerCase().includes(needle))
    .sort(compareItems<MediaFile>(sort, { date: (file) => file.mtimeMs, name: nameOf, starred: (file) => favorites.has(file.path) }));
  const prompt = typeof open?.record?.prompt === "string" ? open.record.prompt : "";
  const promptOf = (file: MediaFile) => (typeof file.record?.prompt === "string" ? file.record.prompt : "");

  const tools = (file: MediaFile) => {
    const text = promptOf(file);
    return (
      <div className="item-tools">
        <button className="icon-btn" type="button" disabled={!text} title={text ? "같은 프롬프트로 새로 만듭니다 (T2I, 새 그림이 추가됩니다)." : "프롬프트 기록이 없습니다."} aria-label="다시 만들기" onClick={() => void again(file, text)}>
          <RefreshCw size={14} />
        </button>
        <button className="icon-btn" type="button" title="이미지 메뉴로 보내기 (이 그림과 프롬프트)" aria-label="보내기" onClick={() => onSend({ kind: "image", tab: "make", prompt: text, image: file.path })}>
          <Send size={14} />
        </button>
        <button className="icon-btn" type="button" title="삭제" aria-label="삭제" onClick={() => void remove(file)}>
          <Trash2 size={14} />
        </button>
      </div>
    );
  };
  const again = (file: MediaFile, text: string) =>
    makePictures([{ id: file.path.split("/").pop()!.replace(/\.[^.]+$/, ""), title: text.slice(0, 40), text }], model)
      .then(() => notify("다시 만듭니다. 끝나면 목록에 나타납니다."))
      .catch((e) => notify(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다."));
  const remove = (file: MediaFile) => {
    if (!window.confirm(`${file.path.split("/").pop()} 그림을 지울까요?`)) return;
    deleteMedia(IMAGE_LIBRARY, file.path)
      .then(() => {
        notify("지웠습니다.");
        reload();
      })
      .catch((e) => notify(e instanceof ApiError ? e.message : "지우지 못했습니다."));
  };

  return (
    <div className="page">
      <div className="page-head tight">
        <div>
          <div className="kicker">나의 그림을 한곳에</div>
          <h1>
            이미지
            <span className="count">{detail.media.images.length}</span>
          </h1>
        </div>
      </div>
      <div className="sub-row">
        <p className="sub">이미지 메뉴에서 만든 그림입니다. 그림을 누르면 만들 때 쓴 프롬프트를 볼 수 있어요.</p>
        <ItemToolbar query={query} onQuery={setQuery} placeholder="파일명·프롬프트 검색" sort={sort} onSort={setSort} />
      </div>
      {images.length === 0 ? (
        <p className="muted">{detail.media.images.length === 0 ? "아직 만든 그림이 없습니다. 이미지 메뉴에서 만들어 보세요." : "조건에 맞는 그림이 없습니다. 검색어를 바꿔 보세요."}</p>
      ) : (
        <div className="thumbs square lib-grid">
          {images.map((file) => (
            <LibraryCard key={file.path} projectId={IMAGE_LIBRARY} file={file} favorites={favorites} onClick={() => setOpen(file)} tools={tools(file)} />
          ))}
        </div>
      )}
      {open && (
        <PromptViewer
          title={open.path.split("/").pop() ?? open.path}
          src={mediaUrl(IMAGE_LIBRARY, open.path, open.mtimeMs)}
          text={prompt || "(이 그림은 프롬프트 기록이 없습니다.)"}
          onClose={() => setOpen(null)}
          actions={
            prompt ? (
              <>
                <select aria-label="담을 분류" value={group} onChange={(event) => setGroup(event.target.value)}>
                  {ascending(GROUPS, (item) => item.label).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    api<{ added: number }>("POST", "/api/prompt-library", { group, title: prompt.slice(0, 40), text: prompt, thumb: open.path })
                      .then((result) => notify(result.added ? "프롬프트 라이브러리에 담았습니다." : "이미 라이브러리에 있는 프롬프트입니다."))
                      .catch((e) => notify(e instanceof ApiError ? e.message : "담지 못했습니다."))
                  }
                >
                  <BookmarkPlus size={15} /> 프롬프트 라이브러리에 담기
                </button>
              </>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
