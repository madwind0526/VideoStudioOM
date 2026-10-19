import { Film, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { snapFrames } from "../../shared/settings.mjs";
import { api, ApiError, type ProjectSettingsView, type ProjectSummary } from "../api";
import ProjectBoard from "../components/ProjectBoard";
import SettingField from "../components/SettingField";
import SizePicker from "../components/SizePicker";
import { FIELDS, getIn, PROJECT_ONLY_PATHS } from "../fields";

type Update = (path: string, value: unknown) => Promise<string | null>;

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  view: ProjectSettingsView | null;
  onWork: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onCreated: (project: ProjectSummary) => void;
  onSet: Update;
  onReset: (path: string) => Promise<string | null>;
  notify: (text: string) => void;
}

// Fields on the start page, in the order they are used (docs/design.md 4.2). The LLM is chosen in Settings.
const START_PATHS = ["defaults.durationSeconds", "defaults.videoMode", "defaults.audioSource", "defaults.imageModel"];
const SIZE_PATHS = ["defaults.sizeId", "defaults.customSize.generate", "defaults.customSize.final"];

/** One setting of the selected project: shows whether it follows the global default and saves on change. */
function ProjectField({ path, view, onSet, onReset, note }: { path: string; view: ProjectSettingsView; onSet: Update; onReset: Props["onReset"]; note?: string }) {
  const def = FIELDS[path];
  const saved = getIn(view.effective, path);
  const [local, setLocal] = useState<unknown>(saved);
  const [error, setError] = useState("");
  const savedKey = JSON.stringify(saved);
  useEffect(() => setLocal(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const overridden = view.overridden.includes(path);

  const commit = async (value: unknown) => {
    setError((await onSet(path, value)) ?? "");
  };
  // Pickers save at once; typed values save when the field loses focus, so half-typed numbers are never sent.
  const typed = def.kind === "number" || def.kind === "text" || def.kind === "size";
  return (
    <div
      onBlur={() => {
        if (typed && JSON.stringify(local) !== savedKey) void commit(local);
      }}
    >
      <SettingField
        field={def}
        value={local}
        badge={overridden ? "이 프로젝트만" : "기본값 따름"}
        error={error}
        onReset={overridden ? () => void onReset(path).then((e) => setError(e ?? "")) : undefined}
        onChange={(value) => {
          setLocal(value);
          if (!typed) void commit(value);
        }}
      />
      {note && !error && <span className="hint">{note}</span>}
    </div>
  );
}

/** Video size of the selected project: a preset from the drop-down, or any custom size typed in. */
function ProjectSize({ view, onSet, onReset }: { view: ProjectSettingsView; onSet: Update; onReset: Props["onReset"] }) {
  const saved = view.effective.defaults;
  const [custom, setCustom] = useState({ generate: saved.customSize.generate as unknown, final: saved.customSize.final as unknown });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const savedKey = JSON.stringify([saved.sizeId, saved.customSize]);
  useEffect(() => setCustom({ generate: saved.customSize.generate, final: saved.customSize.final }), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const overridden = SIZE_PATHS.some((path) => view.overridden.includes(path));

  // Typed sizes are saved when the focus leaves the size fields, so a half-typed number is never sent.
  const commitCustom = async () => {
    for (const which of ["generate", "final"] as const) {
      if (JSON.stringify(custom[which]) === JSON.stringify(saved.customSize[which])) continue;
      const error = await onSet(`defaults.customSize.${which}`, custom[which]);
      setErrors((current) => ({ ...current, [which]: error ?? undefined }));
    }
  };

  return (
    <div onBlur={() => void commitCustom()}>
      <SizePicker
        sizeId={saved.sizeId}
        custom={custom}
        errors={errors}
        badge={overridden ? "이 프로젝트만" : "기본값 따름"}
        onReset={overridden ? () => void Promise.all(SIZE_PATHS.map((path) => onReset(path))).then(() => setErrors({})) : undefined}
        onSizeId={(id) => void onSet("defaults.sizeId", id).then((error) => setErrors({ sizeId: error ?? undefined }))}
        onCustom={(which, value) => setCustom((current) => ({ ...current, [which]: value }))}
      />
    </div>
  );
}

/** The topic is a plain file (studio/topic.md) so it can also be edited in Explorer. */
function TopicEditor({ projectId, notify }: { projectId: string; notify: (text: string) => void }) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/file`;
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState("");
  const [mtime, setMtime] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  const load = () =>
    api<{ content: string | null; mtimeMs: number | null }>("GET", `${url}?path=${encodeURIComponent("studio/topic.md")}&optional=1`)
      .then((data) => {
        setText(data.content ?? "");
        setLoaded(data.content ?? "");
        setMtime(data.mtimeMs);
      })
      .catch(() => notify("주제를 불러오지 못했습니다."))
      .finally(() => setReady(true));

  useEffect(() => {
    setReady(false);
    void load();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (text === loaded) return;
    try {
      const saved = await api<{ mtimeMs: number }>("PUT", url, { path: "studio/topic.md", content: text, expectedMtimeMs: mtime });
      setLoaded(text);
      setMtime(saved.mtimeMs);
      notify("주제를 저장했습니다.");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        notify("주제가 다른 곳에서 바뀌어 다시 불러왔습니다. 고친 내용은 사라졌으니 다시 입력하세요.");
        await load();
      } else notify("주제를 저장하지 못했습니다.");
    }
  }

  return (
    <div className="field">
      <label htmlFor="topic">주제</label>
      <textarea id="topic" rows={4} disabled={!ready} value={text} maxLength={2000} placeholder="어떤 영상을 만들까요? 예: 벌은 어떻게 8자 춤으로 꽃밭의 위치를 알려줄까" onChange={(e) => setText(e.target.value)} onBlur={() => void save()} />
      <span className="hint">주제 제안과 자동 주제는 시나리오 단계에서 추가됩니다. (파일: studio/topic.md)</span>
    </div>
  );
}

/** Start page like SongYUE2's "만들기": the work settings panel sits between the menu and the project cards. */
export default function StartPage({ projects, currentId, view, onWork, onOpenDetail, onFavorite, onCreated, onSet, onReset, notify }: Props) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true);
    setError("");
    try {
      const { project } = await api<{ project: ProjectSummary }>("POST", "/api/projects", { title });
      setTitle("");
      onCreated(project);
      notify(`프로젝트 "${project.title}"를 만들었습니다.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const current = projects.find((project) => project.id === currentId) ?? null;
  const settings = view?.effective;
  const duration = settings?.defaults.durationSeconds;
  const snapped = typeof duration === "number" && Number.isFinite(duration) ? snapFrames(duration) : null;

  return (
    <div className="workspace">
      <section className="panel" aria-label="작업 설정">
        <div className="panel-body">
          <div className="panel-head">
            <h1>어떤 영상을 만들까요?</h1>
            <Film size={22} className="muted" />
          </div>

          <form
            className="newrow"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="새 프로젝트 제목" aria-label="새 프로젝트 제목" />
            <button className="btn primary" type="submit" disabled={busy || !title.trim()}>
              <Plus size={15} /> 만들기
            </button>
          </form>
          {error && <p className="error" style={{ marginTop: -14, marginBottom: 14 }}>{error}</p>}

          {current && view && settings ? (
            <>
              <p className="section-title">작업 설정 · {current.title}</p>
              <div className="fields">
                <TopicEditor projectId={current.id} notify={notify} />
                <ProjectSize view={view} onSet={onSet} onReset={onReset} />
                {START_PATHS.map((path) => (
                  <ProjectField
                    key={path}
                    path={path}
                    view={view}
                    onSet={onSet}
                    onReset={onReset}
                    note={path === "defaults.durationSeconds" && snapped ? `실제 길이 ${snapped.seconds.toFixed(1)}초 (${snapped.frames}프레임)` : undefined}
                  />
                ))}
              </div>
              <details className="advanced">
                <summary>고급 옵션 (Advanced)</summary>
                <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>평소에는 설정 화면의 기본값을 따릅니다. 이 프로젝트에서만 다르게 쓰고 싶은 것만 바꾸세요.</p>
                <div className="fields">
                  {PROJECT_ONLY_PATHS.map((path) => (
                    <ProjectField key={path} path={path} view={view} onSet={onSet} onReset={onReset} />
                  ))}
                </div>
              </details>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              프로젝트를 새로 만들거나 오른쪽 카드의 이름을 누르면 주제와 영상 설정이 여기에 나타납니다. 줄거리, 시나리오, 이미지 등은 &lsquo;프로젝트&rsquo; 메뉴에서 열어 볼 수 있어요.
            </p>
          )}
        </div>
        <div className="panel-foot">
          <button className="btn primary" type="button" disabled title="시나리오 단계에서 열립니다.">
            <Sparkles size={16} /> 시나리오 만들기
          </button>
        </div>
      </section>

      <section className="board">
        <ProjectBoard
          kicker="나의 영상을 한곳에"
          title="내 작업"
          subtitle="카드의 이름을 누르면 왼쪽에서 설정하고, 화살표를 누르면 프로젝트를 엽니다."
          projects={projects}
          currentId={currentId}
          onWork={onWork}
          onOpenDetail={onOpenDetail}
          onFavorite={onFavorite}
        />
      </section>
    </div>
  );
}
