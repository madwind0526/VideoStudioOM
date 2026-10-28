import { Play, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, mediaUrl, type MediaFile, type Settings } from "../api";
import { baseName, getVersions, makeItem, recipeOf, saveDraft, selectVersion, sentOf, startItems, stamp, type Recipe, type VersionEntry } from "../sections/mediaJobs";

interface Props {
  projectId: string;
  /** The shown file (always the chosen version). */
  file: MediaFile;
  kind: "image" | "video";
  settings: Settings | undefined;
  /** Another job is running, so a new one cannot start now. */
  running: boolean;
  startTab: "prompt" | "versions";
  notify: (text: string) => void;
  /** The files changed (a version was chosen, a job was started): reload the lists. */
  onChanged: () => void;
  onClose: () => void;
}

const when = (ms: number) => new Date(ms).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const LOG_LABEL = { saved: "프롬프트 저장", remade: "다시 만듦", selected: "버전 선택" };
const POLL_MS = 3000;
const POLL_LIMIT_MS = 20 * 60 * 1000;

/**
 * Pop-up of one image or video: the prompt it was made from (to read, edit and save, or to make again from) and every
 * version of it side by side. A re-made file becomes another version; the chosen one is shown, the others are kept.
 */
export default function VersionDialog({ projectId, file, kind, settings, running, startTab, notify, onChanged, onClose }: Props) {
  const [entry, setEntry] = useState<VersionEntry | null>(null);
  const [tab, setTab] = useState(startTab);
  const [text, setText] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ count: number; since: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const videos = useRef<HTMLDivElement>(null);

  const recipe = recipeOf(file.record);
  // A picture that was not made by this app can still be made again from a new description.
  const base: Recipe | null = recipe ?? (kind === "image" ? { kind: "image", prompt: "" } : null);
  const saved = entry?.draft?.prompt ?? recipe?.prompt ?? "";
  const shown = text ?? saved;

  const load = () => getVersions(projectId, file.path).then(setEntry).catch(() => notify("버전을 불러오지 못했습니다."));
  useEffect(() => {
    void load();
  }, [file.path, file.mtimeMs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // After "다시 만들기": wait for the new version to appear, then show it next to the old one.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (Date.now() - waiting.since > POLL_LIMIT_MS) return setWaiting(null);
      getVersions(projectId, file.path)
        .then((next) => {
          if (next.versions.length <= waiting.count) return;
          setEntry(next);
          setWaiting(null);
          setTab("versions");
          onChanged();
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, fallback: string) => notify(e instanceof ApiError ? e.message : fallback);

  async function keep() {
    setBusy(true);
    try {
      setEntry(await saveDraft(projectId, file.path, shown));
      setText(null);
      notify("프롬프트를 저장했습니다.");
    } catch (e) {
      fail(e, "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function remake() {
    if (!settings || !base) return;
    // The new file goes next to the old ones; it is shown only if it is chosen afterwards.
    const ext = file.path.slice(file.path.lastIndexOf("."));
    const item = makeItem(settings, { ...base, prompt: shown }, `assets/versions/${baseName(file.path)}-${stamp()}${ext}`);
    if (typeof item === "string") return notify(item);
    setBusy(true);
    try {
      await startItems(projectId, [{ ...item, candidateOf: file.path }]);
      setWaiting({ count: Math.max(1, entry?.versions.length ?? 0), since: Date.now() });
      notify("다시 만들기를 시작했습니다. 끝나면 이전 것과 나란히 보여 줍니다.");
      onChanged();
    } catch (e) {
      fail(e, "다시 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function choose(id: string) {
    setBusy(true);
    try {
      setEntry(await selectVersion(projectId, file.path, id));
      notify("선택한 버전으로 바꿨습니다. 이전 것은 버전 목록에 남아 있습니다.");
      onChanged();
    } catch (e) {
      fail(e, "버전을 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const versions = entry?.versions ?? [];
  const playAll = () => {
    for (const video of videos.current?.querySelectorAll("video") ?? []) {
      video.muted = true;
      video.currentTime = 0;
      void video.play().catch(() => {});
    }
  };

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(1100px, 100%)" }} role="dialog" aria-modal="true" aria-label="프롬프트와 버전">
        <div className="modal-head">
          <h2 title={file.path}>{file.path.replace(/^assets\//, "")}</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "prompt"} onClick={() => setTab("prompt")}>
            프롬프트
          </button>
          <button className="tab" role="tab" aria-selected={tab === "versions"} onClick={() => setTab("versions")}>
            버전<span className="count">{Math.max(1, versions.length)}</span>
          </button>
        </div>

        <div className="modal-body">
          {tab === "prompt" && (
            <>
              <div className="field">
                <label htmlFor="version-prompt">{kind === "image" ? "이미지 프롬프트" : "영상 프롬프트"}</label>
                <textarea id="version-prompt" rows={10} value={shown} maxLength={7000} disabled={!base} onChange={(event) => setText(event.target.value)} placeholder={base ? "만들 내용을 적으세요." : "만든 방법이 기록되지 않은 파일이라 다시 만들 수 없습니다."} />
                <span className="hint">{shown.length.toLocaleString()}자 · "저장"은 이 글을 기록만 하고, "수정한 것으로 다시 만들기"는 새 버전을 만듭니다. 원래 파일은 그대로 남습니다.</span>
              </div>
              {sentOf(file.record).length > 0 && (
                <details className="textblock" style={{ marginTop: 16 }}>
                  <summary className="muted">모델에 실제로 보낸 프롬프트 (이 버전)</summary>
                  {sentOf(file.record).map((sent, index) => (
                    <div className="field" key={index} style={{ marginTop: 10 }}>
                      <label>
                        {sent.node} · {sent.key}
                      </label>
                      <textarea readOnly rows={Math.min(12, Math.max(3, sent.text.split("\n").length + 1))} value={sent.text} />
                    </div>
                  ))}
                </details>
              )}
              <div className="textblock" style={{ marginTop: 16 }}>
                <h3>변경 이력</h3>
                {(entry?.log ?? []).length === 0 ? (
                  <p className="muted" style={{ fontSize: 12 }}>
                    아직 기록이 없습니다. 저장하거나 다시 만들면 여기에 남습니다.
                  </p>
                ) : (
                  <ul className="version-log">
                    {[...(entry?.log ?? [])].reverse().map((item, index) => (
                      <li key={index}>
                        <span className="when">{when(item.at)}</span>
                        <strong>{LOG_LABEL[item.type]}</strong>
                        {item.version && <span className="chip">{item.version}</span>}
                        {item.prompt && (
                          <>
                            <span className="snippet" title={item.prompt}>
                              {item.prompt}
                            </span>
                            <button className="link" type="button" onClick={() => setText(item.prompt ?? "")}>
                              불러오기
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {tab === "versions" && (
            <>
              <div className="row between" style={{ marginBottom: 14 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {waiting ? "새 버전을 만드는 중입니다. 끝나면 여기에 나타납니다..." : versions.length > 1 ? "마음에 드는 버전을 골라 \"이것으로 바꾸기\"를 누르세요. 고르지 않은 것도 지워지지 않고 남습니다." : "아직 다시 만든 버전이 없습니다. 프롬프트 탭에서 다시 만들어 보세요."}
                </span>
                {kind === "video" && versions.length > 1 && (
                  <button className="btn" type="button" onClick={playAll}>
                    <Play size={14} /> 모두 함께 재생 (소리 없음)
                  </button>
                )}
              </div>
              <div className="version-grid" ref={videos}>
                {(versions.length > 0 ? versions : [{ id: "v1", file: file.path, record: file.record, createdAt: file.mtimeMs }]).map((version) => {
                  const current = version.id === (entry?.selected ?? "v1");
                  const url = mediaUrl(projectId, version.file, current ? file.mtimeMs : version.createdAt);
                  const prompt = typeof version.record?.prompt === "string" ? version.record.prompt : "";
                  return (
                    <article key={version.id} className={`version-card${current ? " current" : ""}`}>
                      <div className="version-media">{kind === "image" ? <img src={url} alt={version.id} loading="lazy" /> : <video src={url} controls preload="metadata" playsInline />}</div>
                      <div className="version-info">
                        <strong>{version.id}</strong>
                        <span className="muted">{when(version.createdAt)}</span>
                        {current && <span className="chip">지금 쓰는 것</span>}
                      </div>
                      {prompt && (
                        <p className="version-prompt" title={prompt}>
                          {prompt}
                        </p>
                      )}
                      <button className={current ? "btn" : "btn primary"} type="button" disabled={current || busy} onClick={() => void choose(version.id)}>
                        {current ? "선택됨" : "이것으로 바꾸기"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            닫기
          </button>
          {tab === "prompt" && (
            <>
              <button className="btn" type="button" disabled={busy || !base || shown === saved} onClick={() => void keep()}>
                <Save size={15} /> 저장
              </button>
              <button className="btn primary" type="button" disabled={busy || !base || running || waiting !== null} title={running ? "다른 작업이 끝난 뒤에 할 수 있습니다." : undefined} onClick={() => void remake()}>
                <RefreshCw size={15} /> {waiting ? "만드는 중..." : "수정한 것으로 다시 만들기"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
