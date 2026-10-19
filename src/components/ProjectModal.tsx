import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl, type ProjectDetail } from "../api";
import { formatDate, formatTime, stagesDone } from "../format";

type TabId = "story" | "scenario" | "script" | "images" | "videos";

const STEP_LABELS: Record<string, string> = { synopsis: "줄거리", scenario: "시나리오", script: "대본", images: "이미지", video: "영상", final: "합성" };

const TEXT_FILES = {
  topic: "studio/topic.md",
  synopsis: "studio/synopsis.md",
  scenario: "artifacts/scene_plan.json",
  script: "artifacts/script.json",
} as const;

interface Row {
  id?: string;
  type?: string;
  text?: string;
  description?: string;
  start_seconds?: number;
  end_seconds?: number;
}

/** Reads the array under `key` of a JSON document; null when it is not valid JSON of that shape. */
function rowsOf(text: string | null | undefined, key: string): Row[] | null {
  if (!text) return null;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return Array.isArray(data[key]) ? (data[key] as Row[]) : null;
  } catch {
    return null;
  }
}

const range = (row: Row) => `${formatTime(row.start_seconds)} – ${formatTime(row.end_seconds)}`;

function Empty({ children }: { children: string }) {
  return <p className="muted">{children}</p>;
}

interface Props {
  id: string;
  onClose: () => void;
  onWork: (id: string) => void;
}

/** Details window: synopsis, scenario, script, images and videos of one project. */
export default function ProjectModal({ id, onClose, onWork }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [texts, setTexts] = useState<Record<string, string | null>>({});
  const [tab, setTab] = useState<TabId>("story");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let stale = false;
    const url = `/api/projects/${encodeURIComponent(id)}`;
    api<{ project: ProjectDetail }>("GET", url)
      .then((data) => !stale && setDetail(data.project))
      .catch(() => !stale && setError("프로젝트 정보를 불러오지 못했습니다."));
    // "optional" answers { content: null } for a missing file, so nothing is logged as an error.
    for (const rel of Object.values(TEXT_FILES)) {
      api<{ content: string | null }>("GET", `${url}/file?path=${encodeURIComponent(rel)}&optional=1`)
        .then((data) => !stale && setTexts((current) => ({ ...current, [rel]: data.content })))
        .catch(() => !stale && setTexts((current) => ({ ...current, [rel]: null })));
    }
    return () => {
      stale = true;
    };
  }, [id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lightbox) setLightbox(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, onClose]);

  const scenes = rowsOf(texts[TEXT_FILES.scenario], "scenes");
  const sections = rowsOf(texts[TEXT_FILES.script], "sections");
  const images = detail?.media.images ?? [];
  const videos = detail?.media.videos ?? [];
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "story", label: "줄거리" },
    { id: "scenario", label: "시나리오", count: scenes?.length },
    { id: "script", label: "대본", count: sections?.length },
    { id: "images", label: "이미지", count: images.length },
    { id: "videos", label: "동영상", count: videos.length },
  ];

  const text = (rel: string) => texts[rel]?.trim() || null;

  return (
    <div className="backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={detail ? `${detail.title} 정보` : "프로젝트 정보"}>
        <div className="modal-head">
          <h2>{detail?.title ?? id}</h2>
          {detail && (
            <span className="chips">
              <span className="chip">{detail.hasFinal ? "완성" : "작업 중"}</span>
              <span className="chip">{stagesDone(detail)}/6 단계</span>
              {detail.durationSeconds !== null && <span className="chip">{formatTime(detail.durationSeconds)}</span>}
              <span className="chip">{formatDate(detail.updatedAt)}</span>
            </span>
          )}
          <button ref={closeRef} className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="tabs" role="tablist">
          {tabs.map((item) => (
            <button key={item.id} className="tab" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
              {item.count !== undefined && <span className="count">{item.count}</span>}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {error && <p className="error">{error}</p>}

          {tab === "story" && (
            <>
              <div className="textblock">
                <h3>주제</h3>
                {text(TEXT_FILES.topic) ? <p>{text(TEXT_FILES.topic)}</p> : <Empty>아직 주제가 없습니다. 시작 화면에서 입력하세요.</Empty>}
              </div>
              <div className="textblock">
                <h3>줄거리</h3>
                {text(TEXT_FILES.synopsis) ? <p>{text(TEXT_FILES.synopsis)}</p> : <Empty>아직 줄거리가 없습니다. 시나리오 단계에서 만들 수 있습니다.</Empty>}
              </div>
              {detail && (
                <div className="textblock">
                  <h3>진행 단계</h3>
                  <span className="chips">
                    {detail.stages.map((stage) => (
                      <span key={stage.id} className="chip">
                        {stage.done && <Check size={9} />} {STEP_LABELS[stage.id]}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </>
          )}

          {tab === "scenario" &&
            (scenes ? (
              scenes.map((scene, index) => (
                <div className="scene" key={scene.id ?? index}>
                  <span className="no">{index + 1}</span>
                  <div>
                    <div className="meta">
                      <span>{range(scene)}</span>
                      {scene.type && <span>{scene.type}</span>}
                    </div>
                    <p>{scene.description}</p>
                  </div>
                </div>
              ))
            ) : text(TEXT_FILES.scenario) ? (
              <div className="textblock">
                <h3>scene_plan.json을 장면 목록으로 읽을 수 없어 원문을 보여 줍니다.</h3>
                <pre>{text(TEXT_FILES.scenario)}</pre>
              </div>
            ) : (
              <Empty>아직 시나리오가 없습니다.</Empty>
            ))}

          {tab === "script" &&
            (sections ? (
              sections.map((section, index) => (
                <div className="scene" key={section.id ?? index}>
                  <span className="no">{index + 1}</span>
                  <div>
                    <div className="meta">
                      <span>{range(section)}</span>
                    </div>
                    <p>{section.text}</p>
                  </div>
                </div>
              ))
            ) : text(TEXT_FILES.script) ? (
              <div className="textblock">
                <h3>script.json을 대본 목록으로 읽을 수 없어 원문을 보여 줍니다.</h3>
                <pre>{text(TEXT_FILES.script)}</pre>
              </div>
            ) : (
              <Empty>아직 대본이 없습니다.</Empty>
            ))}

          {tab === "images" &&
            (images.length > 0 ? (
              <div className="thumbs">
                {images.map((file) => (
                  <button key={file.path} type="button" title={file.path} onClick={() => setLightbox(file.path)}>
                    <img src={mediaUrl(id, file.path)} alt={file.path} loading="lazy" />
                  </button>
                ))}
              </div>
            ) : (
              <Empty>아직 이미지가 없습니다.</Empty>
            ))}

          {tab === "videos" &&
            (videos.length > 0 ? (
              <div className="videos">
                {videos.map((file) => (
                  <div key={file.path}>
                    <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
                      {file.path}
                    </div>
                    <video controls preload="metadata" src={mediaUrl(id, file.path)} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty>아직 동영상이 없습니다.</Empty>
            ))}
        </div>

        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            닫기
          </button>
          <button className="btn primary" type="button" onClick={() => onWork(id)}>
            프로젝트 열기
          </button>
        </div>
      </div>

      {lightbox && (
        <button className="lightbox" type="button" aria-label="이미지 닫기" onClick={() => setLightbox(null)}>
          <img src={mediaUrl(id, lightbox)} alt={lightbox} />
        </button>
      )}
    </div>
  );
}
