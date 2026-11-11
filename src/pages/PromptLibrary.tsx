import { Copy, FileText, Star, FolderInput, RefreshCw, Send, Sparkles, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, mediaUrl, type ProjectDetail, type ProjectSettingsView } from "../api";
import { ascending } from "../sortOptions";
import { useModelChoice, samplingInputs, type ModelChoice } from "../components/ModelPicker";
import { namesRatio, sizeFromPrompt, type ImageSize } from "../imageSizes";
import { makeItem, startItems, stamp, type MakeItem, type VideoMethod } from "../sections/mediaJobs";
import { CUSTOM_SIZE_ID, resolveSize } from "../../shared/settings.mjs";
import SizePicker from "../components/SizePicker";
import VideoMethodPicker from "../components/VideoMethodPicker";
import type { Handoff } from "../handoff";
import ItemToolbar, { compareItems, DEFAULT_ITEM_SORT, type ItemSort } from "../components/itemSort";
import LibraryBrowser, { useFavorites, type SortOrder } from "../components/LibraryBrowser";

/** The picture library the thumbnails come from (the hidden project of the image menu). */
export const IMAGE_LIBRARY = "_images";

export interface PromptItem {
  id: string;
  group: string;
  title: string;
  text: string;
  thumb?: string;
  note?: string;
  createdAt?: string;
}
interface Group {
  id: string;
  label: string;
}
interface LibraryData {
  groups: Group[];
  items: PromptItem[];
  defaultDir: string;
}

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Pop-up that shows a picture (or a placeholder) with its prompt; `actions` are the buttons of the footer. */
export function PromptViewer({ title, src, text, onClose, actions, children }: { title: ReactNode; src: string | null; text: string; onClose: () => void; actions?: ReactNode; children?: ReactNode }) {
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && (zoom ? setZoom(false) : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, zoom]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(720px, 100%)" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {src && isVideoFile(src.split("?")[0]) && <video src={src} controls preload="metadata" style={{ width: "100%", borderRadius: 8, background: "#000" }} />}
          {src && !isVideoFile(src.split("?")[0]) && (
            <div className="picture-view">
              <img src={src} alt="" style={{ cursor: "zoom-in" }} title="누르면 원본 크기로 봅니다." onClick={() => setZoom(true)} />
            </div>
          )}
          {zoom && src && <ZoomViewer src={src} onClose={() => setZoom(false)} />}
          {children}
          <textarea className="pl-text" readOnly rows={10} value={text} aria-label="프롬프트" />
        </div>
        <div className="modal-foot">
          <button
            className="btn"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => setCopied(true));
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy size={15} /> {copied ? "복사했습니다" : "프롬프트 복사"}
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}

/** A picture at its own size (1:1): the wheel zooms around the pointer, a drag moves it, a double click returns to 1:1. */
function ZoomViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const onWheel = (event: React.WheelEvent) => {
    const rect = box.current!.getBoundingClientRect();
    // Pointer position from the center of the box, where the picture sits at scale 1.
    const px = event.clientX - rect.left - rect.width / 2;
    const py = event.clientY - rect.top - rect.height / 2;
    setView((current) => {
      const scale = Math.min(16, Math.max(0.05, current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  };

  return (
    <div
      ref={box}
      style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", overflow: "hidden", background: "rgba(0,0,0,0.92)", cursor: grabbing ? "grabbing" : "grab", touchAction: "none" }}
      onWheel={onWheel}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY };
        setGrabbing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const [dx, dy] = [event.clientX - drag.current.x, event.clientY - drag.current.y];
        drag.current = { x: event.clientX, y: event.clientY };
        setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      }}
      onPointerUp={() => {
        drag.current = null;
        setGrabbing(false);
      }}
      onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
    >
      <img src={src} alt="" draggable={false} style={{ maxWidth: "none", maxHeight: "none", transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, userSelect: "none" }} />
      <button className="icon-btn" type="button" title="닫기 (Esc)" aria-label="닫기" style={{ position: "absolute", top: 14, right: 14 }} onPointerDown={(event) => event.stopPropagation()} onClick={onClose}>
        <X size={20} />
      </button>
      <span className="hint" style={{ position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center", color: "#ddd" }}>
        {Math.round(view.scale * 100)}% · 휠로 확대/축소 · 끌어서 이동 · 더블클릭으로 100%
      </span>
    </div>
  );
}

/** A card picture that may still be in the making: a failed load is tried again after a while. */
export function Thumb({ src }: { src: string }) {
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setTries((count) => count + 1);
    }, 8000);
    return () => clearTimeout(timer);
  }, [failed]);
  if (failed) return <FileText size={28} />;
  return <img src={`${src}&r=${tries}`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

/** Starts one T2I picture per prompt in the image library at 1 MP (the ratio of the prompt, else 4:3); returns the file of each. */
/**
 * [width, height] of a prompt's picture: the chosen resolution; the ratio and direction of the choice, unless the prompt names a ratio
 * (then that one). Without a choice: 1 MP at the ratio of the prompt (else 4:3).
 */
function sizeOfPrompt(text: string, choice?: ImageSize): [number, number] {
  const fromPrompt = sizeFromPrompt(text);
  const base = !choice ? fromPrompt : namesRatio(text) && choice.aspect !== CUSTOM_SIZE_ID ? { ...choice, aspect: fromPrompt.aspect, orientation: fromPrompt.orientation } : choice;
  return resolveSize({ defaults: { sizeMegapixels: base.megapixels, aspect: base.aspect, orientation: base.orientation, customSize: base.custom } } as Parameters<typeof resolveSize>[0]).generate as [number, number];
}

export async function makePictures(items: { id: string; title: string; text: string }[], model: ModelChoice, size?: ImageSize) {
  await api("POST", "/api/images/ensure", {});
  const id = stamp();
  const made = items.map((item) => {
    const [width, height] = sizeOfPrompt(item.text, size);
    const path = `assets/images/pl-${id}-${item.id}.png`;
    const job: MakeItem = {
      tool: model.tool,
      label: item.title,
      record: { kind: "image", prompt: item.text, imageModel: model.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) },
      inputs: { prompt: item.text, width, height, ...samplingInputs(model, 0), output_path: path },
    };
    return { job, item, path };
  });
  await startItems(IMAGE_LIBRARY, made.map((entry) => entry.job));
  return made.map(({ item, path }) => ({ item, path }));
}

const isVideoFile = (path: string) => /\.(mp4|webm|mov)$/i.test(path);

/** Starts one T2V clip (5 s, the video size of the library settings) per prompt in the library project; returns the file of each. */
export interface ClipOptions {
  seconds: number;
  /** The size to make the clips at; without one the video size of the library settings is used. */
  size?: ImageSize;
  /** How the clips are made (the local or the tiled R2V workflow, and the advanced options). */
  video?: VideoMethod;
}

async function makeClips(items: { id: string; title: string; text: string }[], options: ClipOptions) {
  await api("POST", "/api/images/ensure", {});
  const view = await api<ProjectSettingsView>("GET", `/api/projects/${IMAGE_LIBRARY}/settings`);
  const id = stamp();
  const made = items.map((item) => {
    const path = `assets/video/pl-${id}-${item.id}.mp4`;
    const job = makeItem(view.effective, { kind: "t2v", prompt: item.text, duration: options.seconds, video: options.video }, path);
    if (typeof job === "string") throw new ApiError(400, job);
    if (options.size) {
      // The chosen size is the size the clip is made at: no enlargement pass.
      const [width, height] = sizeOfPrompt(item.text, options.size);
      Object.assign(job.inputs, { width, height, upscale: false });
      delete job.inputs.final_size;
      delete job.inputs.upscale_scale;
    }
    return { job, item, path };
  });
  await startItems(IMAGE_LIBRARY, made.map((entry) => entry.job));
  return made.map(({ item, path }) => ({ item, path }));
}

/** Starts one T2I picture (or T2V clip for video prompts) per prompt and points each prompt's thumbnail at the file it will be saved to. */
async function makeThumbs(items: PromptItem[], model: ModelChoice, options: { size?: ImageSize; clip?: ClipOptions } = {}) {
  const made = items.length > 0 && items.every((item) => item.group.startsWith("video-")) ? await makeClips(items, options.clip ?? { seconds: 5 }) : await makePictures(items, model, options.size);
  for (const { item, path } of made) await api("PUT", `/api/prompt-library/${item.id}`, { thumb: path });
  return made.length;
}

/** The prompts of one shelf (image/video x Local/API) as cards with a thumbnail; a click shows the prompt. */
export default function PromptLibrary({ group, notify, onSend }: { group: string; notify: (text: string) => void; onSend: (handoff: Handoff) => void }) {
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PromptItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [sort, setSort] = useState<ItemSort>(DEFAULT_ITEM_SORT);
  const [query, setQuery] = useState("");
  const model = useModelChoice("t2i");
  const favorites = useFavorites(IMAGE_LIBRARY);

  const load = useCallback(() => {
    api<LibraryData>("GET", "/api/prompt-library")
      .then((loaded) => {
        setData(loaded);
        setOpen((current) => (current ? loaded.items.find((item) => item.id === current.id) ?? null : null));
      })
      .catch((e) => setError(errorText(e, "프롬프트 라이브러리를 열지 못했습니다.")));
  }, []);
  useEffect(load, [load]);

  const send = (item: PromptItem) => onSend(item.group.startsWith("image-") ? { kind: "image", tab: "make", prompt: item.text, image: item.thumb } : { kind: "clip", prompt: item.text });
  const remove = (item: PromptItem) => {
    if (window.confirm(`"${item.title}" 프롬프트를 지울까요?`)) api("DELETE", `/api/prompt-library/${item.id}`).then(load).catch((e) => notify(errorText(e, "지우지 못했습니다.")));
  };
  const regenerate = (item: PromptItem) =>
    makeThumbs([item], model)
      .then(() => {
        notify("다시 만듭니다. 끝나면 카드에 나타납니다.");
        load();
      })
      .catch((e) => notify(errorText(e, "작업을 시작하지 못했습니다.")));

  if (error) return <p className="error" style={{ padding: 24 }}>{error}</p>;
  if (!data) return <p className="muted" style={{ padding: 24 }}>불러오는 중입니다...</p>;
  const label = data.groups.find((item) => item.id === group)?.label ?? group;
  const inGroup = data.items.filter((item) => item.group === group);
  const needle = query.trim().toLowerCase();
  // A prompt counts as a favorite when its picture (or video) is starred; the search looks at its title and text.
  const items = inGroup
    .filter((item) => !needle || `${item.title} ${item.text}`.toLowerCase().includes(needle))
    .sort(compareItems<PromptItem>(sort, { date: (item) => Date.parse(item.createdAt ?? "") || 0, name: (item) => item.title, starred: (item) => Boolean(item.thumb && favorites.has(item.thumb)) }));

  return (
    <div className="page">
      <div className="page-head tight">
        <div>
          <div className="kicker">프롬프트 라이브러리</div>
          <h1>
            {label}
            <span className="count">{inGroup.length}</span>
          </h1>
        </div>
        <div className="pl-actions">
          <button className="btn" type="button" disabled={inGroup.every((item) => item.thumb)} onClick={() => setBulk(true)} title={group.startsWith("image-") ? "썸네일이 없는 프롬프트를 T2I로 한 장씩 만들어 썸네일로 붙입니다." : "영상이 없는 프롬프트를 T2V로 한 편씩 만들어 카드에 붙입니다."}>
            <Sparkles size={15} /> {group.startsWith("image-") ? "이미지 없는 것 만들기" : "동영상 없는 것 만들기"}
          </button>
          <button className="btn" type="button" onClick={() => setImporting(true)}>
            <FolderInput size={15} /> 폴더에서 가져오기
          </button>
          <button className="btn primary" type="button" onClick={() => setAdding(true)}>
            <Plus size={15} /> 프롬프트 추가
          </button>
        </div>
      </div>
      <div className="sub-row">
        <p className="sub">
          {group.endsWith("local") ? "ComfyUI(로컬)에서 만들 수 있는 프롬프트입니다." : "Nano Banana, Google 등 온라인 서비스(API)로 만드는 프롬프트입니다."} 카드를 누르면 프롬프트를 볼 수 있어요.
        </p>
        <ItemToolbar query={query} onQuery={setQuery} placeholder="제목·프롬프트 검색" sort={sort} onSort={setSort} />
      </div>

      {inGroup.length === 0 ? (
        <p className="muted">아직 이 분류에 프롬프트가 없습니다. "폴더에서 가져오기"로 모아 둔 프롬프트를 넣거나, "프롬프트 추가"로 직접 넣으세요.</p>
      ) : (
        <div className="pl-grid">
          {items.length === 0 && <p className="muted">조건에 맞는 프롬프트가 없습니다. 검색어를 바꿔 보세요.</p>}
          {items.map((item) => (
            <div key={item.id} className="pl-card">
              <button className="pl-main" type="button" title={item.title} onClick={() => setOpen(item)}>
                <span className="pl-thumb">{item.thumb ? isVideoFile(item.thumb) ? <video src={mediaUrl(IMAGE_LIBRARY, item.thumb)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Thumb src={mediaUrl(IMAGE_LIBRARY, item.thumb)} /> : <FileText size={28} />}</span>
                <strong>{item.title}</strong>
                <span className="pl-snippet">{item.text}</span>
              </button>
              <div className="pl-tools left">
                <button type="button" className={item.thumb && favorites.has(item.thumb) ? "on" : undefined} disabled={!item.thumb} title={item.thumb ? (favorites.has(item.thumb) ? "즐겨찾기 빼기" : "즐겨찾기") : "썸네일(그림이나 영상)이 있어야 즐겨찾기할 수 있습니다."} aria-label="즐겨찾기" onClick={() => item.thumb && favorites.toggle(item.thumb)}>
                  <Star size={14} fill={item.thumb && favorites.has(item.thumb) ? "currentColor" : "none"} />
                </button>
              </div>
              <div className="pl-tools">
                <button type="button" title={item.group.startsWith("image-") ? "이 프롬프트로 이미지를 다시 만듭니다 (T2I)." : "이 프롬프트로 영상을 다시 만듭니다 (T2V)."} aria-label="다시 만들기" onClick={() => void regenerate(item)}>
                  <RefreshCw size={14} />
                </button>
                <button type="button" title={item.group.startsWith("image-") ? "이미지로 보내기" : "영상 clip의 T2V로 보내기"} aria-label="보내기" onClick={() => send(item)}>
                  <Send size={14} />
                </button>
                <button type="button" title="삭제" aria-label="삭제" onClick={() => remove(item)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <ItemDialog item={open} onSend={onSend} groups={data.groups} onClose={() => setOpen(null)} onChanged={load} notify={notify} />}
      {adding && <AddDialog group={group} label={label} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
      {bulk && <BulkDialog video={group.startsWith("video-")} items={inGroup.filter((item) => !item.thumb)} onClose={() => setBulk(false)} onDone={load} notify={notify} />}
      {importing && <ImportDialog defaultDir={data.defaultDir} onClose={() => setImporting(false)} onDone={load} notify={notify} />}
    </div>
  );
}

/** One prompt: the picture and text, a thumbnail from the picture library, another shelf, delete. */
function ItemDialog({ item, onSend, groups, onClose, onChanged, notify }: { item: PromptItem; onSend: (handoff: Handoff) => void; groups: Group[]; onClose: () => void; onChanged: () => void; notify: (text: string) => void }) {
  const [picking, setPicking] = useState(false);
  const [images, setImages] = useState<ProjectDetail["media"]["images"]>([]);
  const [order, setOrder] = useState<SortOrder>("time");
  const favorites = useFavorites(IMAGE_LIBRARY);

  const patch = (body: Partial<PromptItem>, done?: string) =>
    api("PUT", `/api/prompt-library/${item.id}`, body)
      .then(() => {
        if (done) notify(done);
        onChanged();
      })
      .catch((e) => notify(errorText(e, "저장하지 못했습니다.")));

  async function openPicker() {
    try {
      await api("POST", "/api/images/ensure", {});
      setImages((await api<{ project: ProjectDetail }>("GET", `/api/projects/${IMAGE_LIBRARY}`)).project.media.images);
      setPicking(true);
    } catch (e) {
      notify(errorText(e, "이미지 보관함을 열지 못했습니다."));
    }
  }

  return (
    <>
      {!picking && (
      <PromptViewer
        title={item.title}
        src={item.thumb ? mediaUrl(IMAGE_LIBRARY, item.thumb) : null}
        text={item.text}
        onClose={onClose}
        actions={
          <>
            {item.group.startsWith("image-") && (
              <button className="btn primary" type="button" title="이미지 메뉴를 열어 T2I, I2I, R2I 모두에 프롬프트(와 썸네일 그림)를 채웁니다. 탭을 골라 만드세요." onClick={() => onSend({ kind: "image", tab: "make", prompt: item.text, image: item.thumb })}>
                <Send size={15} /> 이미지로 보내기
              </button>
            )}
            {item.group.startsWith("video-") && (
              <button className="btn primary" type="button" title="영상 clip의 T2V 화면에 프롬프트를 채웁니다." onClick={() => onSend({ kind: "clip", prompt: item.text })}>
                <Send size={15} /> T2V로 보내기
              </button>
            )}
            {item.group === "video-local" && (
              <button className="btn" type="button" title="현재 프로젝트의 영상 화면 R2V에 프롬프트를 채웁니다." onClick={() => onSend({ kind: "video", prompt: item.text })}>
                <Send size={15} /> R2V로 보내기
              </button>
            )}
            <button className="btn" type="button" onClick={() => void openPicker()}>
              <ImageIcon size={15} /> {item.thumb ? "썸네일 바꾸기" : "썸네일 고르기"}
            </button>
            {item.thumb && (
              <button className="btn" type="button" onClick={() => void patch({ thumb: "" })}>
                썸네일 빼기
              </button>
            )}
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (window.confirm("이 프롬프트를 지울까요?")) api("DELETE", `/api/prompt-library/${item.id}`).then(() => { onChanged(); onClose(); }).catch((e) => notify(errorText(e, "지우지 못했습니다.")));
              }}
            >
              <Trash2 size={15} /> 삭제
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="pl-group">분류</label>
          <select id="pl-group" value={item.group} onChange={(event) => void patch({ group: event.target.value }, "분류를 옮겼습니다.")}>
            {ascending(groups, (group) => group.label).map((group) => (
              <option key={group.id} value={group.id}>
                {group.label}
              </option>
            ))}
          </select>
        </div>
        {item.note && <p className="hint">{item.note}</p>}
      </PromptViewer>
      )}
      {picking && (
        <LibraryBrowser
          projectId={IMAGE_LIBRARY}
          images={images}
          favorites={favorites}
          order={order}
          onOrder={setOrder}
          title="썸네일로 쓸 그림 고르기"
          onClose={() => setPicking(false)}
          pick={{
            selected: item.thumb ? [item.thumb] : [],
            max: 1,
            onPick: (paths) => {
              setPicking(false);
              if (paths[0]) void patch({ thumb: paths[0] }, "썸네일을 정했습니다.");
            },
          }}
        />
      )}
    </>
  );
}

function AddDialog({ group, label, onClose, onAdded }: { group: string; label: string; onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(640px, 100%)" }} role="dialog" aria-modal="true" aria-label="프롬프트 추가">
        <div className="modal-head">
          <h2>프롬프트 추가 — {label}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="pl-title">제목</label>
            <input id="pl-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pl-new">프롬프트</label>
            <textarea id="pl-new" className="pl-text" rows={10} value={text} onChange={(event) => setText(event.target.value)} />
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button
            className="btn primary"
            type="button"
            onClick={() =>
              api<{ added: number }>("POST", "/api/prompt-library", { group, title, text })
                .then((result) => (result.added ? onAdded() : setError("같은 프롬프트가 이미 있습니다.")))
                .catch((e) => setError(errorText(e, "추가하지 못했습니다.")))
            }
          >
            추가
          </button>
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

/** Reads the .txt and .md files of a folder; the LLM sorts every block into a shelf (or leaves it out) and titles it. */
function ImportDialog({ defaultDir, onClose, onDone, notify }: { defaultDir: string; onClose: () => void; onDone: () => void; notify: (text: string) => void }) {
  const [dir, setDir] = useState(defaultDir);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ files: number; blocks: number; added: number; skipped: number } | null>(null);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const done = await api<{ files: number; blocks: number; added: number; skipped: number }>("POST", "/api/prompt-library/import", { dir });
      setResult(done);
      notify(`프롬프트 ${done.added}개를 가져왔습니다.`);
      onDone();
    } catch (e) {
      setError(errorText(e, "가져오지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => !busy && event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(640px, 100%)" }} role="dialog" aria-modal="true" aria-label="폴더에서 가져오기">
        <div className="modal-head">
          <h2>폴더에서 프롬프트 가져오기</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" disabled={busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="pl-dir">폴더 (.txt, .md 파일)</label>
            <input id="pl-dir" value={dir} disabled={busy} onChange={(event) => setDir(event.target.value)} />
          </div>
          <p className="hint">파일을 빈 줄 두 줄 이상으로 나눠 프롬프트로 읽고, LLM이 이미지/동영상, Local/API로 나눠 제목을 붙입니다. 프롬프트가 아닌 글(링크, 설치 메모 등)은 뺍니다. 이미 들어 있는 프롬프트는 다시 넣지 않습니다. 글이 많으면 몇 분 걸릴 수 있습니다.</p>
          {result && (
            <p className="hint">
              파일 {result.files}개, 글 덩어리 {result.blocks}개 중 {result.added}개를 넣었고 {result.skipped}개는 프롬프트가 아니라서 뺐습니다.
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn primary" type="button" disabled={busy || !dir.trim()} onClick={() => void run()}>
            {busy ? "분류하는 중..." : "가져오기"}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            {result ? "닫기" : "취소"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Makes one picture per prompt without a thumbnail with the T2I model and sets the picture as its thumbnail (the file name is fixed up front). */
function BulkDialog({ items, video, onClose, onDone, notify }: { items: PromptItem[]; video: boolean; onClose: () => void; onDone: () => void; notify: (text: string) => void }) {
  const model = useModelChoice("t2i");
  const [seconds, setSeconds] = useState("5");
  const [method, setMethod] = useState<VideoMethod>({ tiled: false });
  // Pictures start at 1 MP, 4:3; clips at 0.7 MP, 16:9 wide. A ratio named in a prompt still wins.
  const [size, setSize] = useState<ImageSize>(video ? { megapixels: 0.7, aspect: "16x9", orientation: "landscape", custom: { generate: [1280, 704] } } : { megapixels: 1, aspect: "4x3", orientation: "landscape", custom: { generate: [1024, 1024] } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError("");
    const length = Number(seconds);
    if (video && !(length >= 2 && length <= 15)) return setError("길이는 2~15초로 입력하세요.");
    setBusy(true);
    try {
      const count = await makeThumbs(items, model, { size, clip: { seconds: length, size, video: method } });
      notify(`${count}${video ? "편" : "장"}을 차례로 만듭니다. 끝나는 대로 카드에 나타납니다.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e, "작업을 시작하지 못했습니다."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(520px, 100%)" }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{video ? "동영상 없는 프롬프트 만들기" : "이미지 없는 프롬프트 만들기"}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          {video ? (
            <>
              <p>영상이 없는 프롬프트 {items.length}개를 글만으로(T2V) 한 편씩 만들어 보관함에 저장하고 카드에 붙입니다. 한 편에 몇 분 걸립니다.</p>
              <div className="fields">
                <div className="field">
                  <label>모델</label>
                  <input type="text" value="MiniMax H3 (로컬 T2V)" readOnly />
                </div>
                <div className="field">
                  <label htmlFor="bulk-seconds">길이(초)</label>
                  <input id="bulk-seconds" type="number" min={2} max={15} step={1} value={seconds} onChange={(event) => setSeconds(event.target.value)} />
                </div>
              </div>
              <SizePicker megapixels={size.megapixels} aspect={size.aspect} orientation={size.orientation} custom={size.custom} label="Resolution" onMegapixels={(megapixels) => setSize({ ...size, megapixels })} onAspect={(aspect) => setSize({ ...size, aspect })} onOrientation={(orientation) => setSize({ ...size, orientation })} onCustom={(custom) => setSize({ ...size, custom: { generate: custom } })} />
              <span className="hint">프롬프트에 비율이 적혀 있으면 그 프롬프트는 그 비율을 따릅니다.</span>
              <VideoMethodPicker value={method} fallback={false} onChange={setMethod} />
            </>
          ) : (
            <>
              <p>썸네일이 없는 프롬프트 {items.length}개를 한 장씩 만들어 이미지 보관함에 저장하고 썸네일로 붙입니다. 크기는 아래에서 고릅니다.</p>
              {model.picker}
              <SizePicker megapixels={size.megapixels} aspect={size.aspect} orientation={size.orientation} custom={size.custom} label="Resolution" onMegapixels={(megapixels) => setSize({ ...size, megapixels })} onAspect={(aspect) => setSize({ ...size, aspect })} onOrientation={(orientation) => setSize({ ...size, orientation })} onCustom={(custom) => setSize({ ...size, custom: { generate: custom } })} />
              <span className="hint">프롬프트에 비율이 적혀 있으면 그 프롬프트는 그 비율을 따릅니다. 없으면 위에서 고른 비율입니다.</span>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn primary" type="button" disabled={busy || items.length === 0} onClick={() => void start()}>
            <Sparkles size={15} /> {busy ? "시작하는 중..." : "만들기"}
          </button>
        </div>
      </div>
    </div>
  );
}
