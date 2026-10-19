import { ChevronRight, FileText, Film, House, LayoutGrid, Library, Moon, Settings as SettingsIcon, Sun, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, mediaUrl, type ProjectSettingsView, type ProjectSummary } from "./api";
import { BRAND } from "./brand";
import Logo from "./components/Logo";
import ProjectModal from "./components/ProjectModal";
import ResourceBar from "./components/ResourceBar";
import WorkSteps, { type StepTarget } from "./components/WorkSteps";
import { setIn } from "./fields";
import ComingPage from "./pages/ComingPage";
import LibraryPage from "./pages/LibraryPage";
import SettingsPage from "./pages/SettingsPage";
import StartPage from "./pages/StartPage";
import { useEvents } from "./useEvents";

type PageId = "start" | "scenario" | "storyboard" | "video" | "library" | "settings";

const PAGES: { id: PageId; label: string; icon: LucideIcon }[] = [
  { id: "start", label: "시작", icon: House },
  { id: "scenario", label: "시나리오", icon: FileText },
  { id: "storyboard", label: "스토리보드", icon: LayoutGrid },
  { id: "video", label: "영상", icon: Film },
  { id: "library", label: "내 라이브러리", icon: Library },
  { id: "settings", label: "설정", icon: SettingsIcon },
];

const RECENT_LIMIT = 6;

// localStorage can throw (private window, blocked site data); the app must work without it.
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembering is fine.
  }
}

function rememberedList(key: string): string[] {
  try {
    const list = JSON.parse(remembered(key) ?? "[]");
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function pageFromHash(): PageId {
  const id = window.location.hash.replace("#/", "");
  return PAGES.some((page) => page.id === id) ? (id as PageId) : "start";
}

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => remembered("currentProject"));
  const [recentIds, setRecentIds] = useState<string[]>(() => rememberedList("recentProjects"));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [projectView, setProjectView] = useState<ProjectSettingsView | null>(null);
  const [message, setMessage] = useState("준비됨");
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = remembered("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("theme", theme);
  }, [theme]);

  // A details window belongs to the page it was opened on.
  useEffect(() => setDetailId(null), [page]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);

  const connected = useEvents(
    useCallback(
      (change) => {
        setMessage(`${change.project}/${change.path} 변경됨`);
        reload();
      },
      [reload],
    ),
  );

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("GET", "/api/projects")
      .then((data) => {
        setProjects(data.projects);
        // Forget a remembered project that no longer exists.
        setCurrentId((id) => (id && data.projects.some((p) => p.id === id) ? id : null));
      })
      .catch(() => setMessage("프로젝트 목록을 불러오지 못했습니다."));
  }, [refreshKey]);

  useEffect(() => {
    if (!currentId) {
      setProjectView(null);
      return;
    }
    api<ProjectSettingsView>("GET", `/api/projects/${encodeURIComponent(currentId)}/settings`)
      .then(setProjectView)
      .catch(() => setProjectView(null));
  }, [currentId, refreshKey]);

  const go = (id: PageId) => {
    window.location.hash = `#/${id}`;
  };

  /** Makes a project the one being worked on and moves it to the front of the recent list. */
  const select = (id: string) => {
    setCurrentId(id);
    remember("currentProject", id);
    setRecentIds((list) => {
      const next = [id, ...list.filter((item) => item !== id)].slice(0, RECENT_LIMIT);
      remember("recentProjects", JSON.stringify(next));
      return next;
    });
  };

  const work = (id: string) => {
    select(id);
    setDetailId(null);
    go("start");
  };

  async function toggleFavorite(id: string, favorite: boolean) {
    try {
      await api("PUT", `/api/projects/${encodeURIComponent(id)}/meta`, { favorite });
      reload();
    } catch {
      setMessage("즐겨찾기를 바꾸지 못했습니다.");
    }
  }

  /** Saves a change to the selected project's own settings. Returns an error text, or null on success. */
  async function updateProject(body: { set?: Record<string, unknown>; unset?: string[] }): Promise<string | null> {
    if (!currentId) return "프로젝트를 먼저 선택하세요.";
    try {
      setProjectView(await api<ProjectSettingsView>("PUT", `/api/projects/${encodeURIComponent(currentId)}/settings`, body));
      return null;
    } catch (e) {
      if (e instanceof ApiError) return [e.message, ...(e.errors ?? []).map((item) => item.message)].join(" ");
      return "저장하지 못했습니다.";
    }
  }

  const setProjectField = (path: string, value: unknown) => updateProject({ set: setIn({}, path, value) });
  const resetProjectField = (path: string) => updateProject({ unset: [path] });

  const current = projects.find((project) => project.id === currentId) ?? null;
  // Sidebar list: recently opened projects, or the most recently changed ones until something was opened.
  const recentProjects = (() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    const opened = recentIds.map((id) => byId.get(id)).filter((project): project is ProjectSummary => Boolean(project));
    return (opened.length > 0 ? opened : [...projects].sort((a, b) => b.updatedAt - a.updatedAt)).slice(0, 5);
  })();
  const active = PAGES.find((item) => item.id === page)!;
  const stepTargets: Record<StepTarget, PageId> = { scenario: "scenario", storyboard: "storyboard", video: "video" };

  return (
    <div className="app">
      <aside className="side">
        <div className="brand" title={`${BRAND.name} by ${BRAND.author}`}>
          <Logo size={34} />
          <div className="brand-text">
            <strong>
              VideoStudio<b>OM</b>
            </strong>
            <span>by {BRAND.author}</span>
          </div>
        </div>
        <nav className="nav" aria-label="메뉴">
          {PAGES.filter((item) => item.id !== "settings").map(({ id, label, icon: Icon }) => (
            <button key={id} className="nav-item" type="button" aria-current={id === page ? "page" : undefined} onClick={() => go(id)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
          <div className="nav-divider" role="separator" />
          <div className="nav-label">최근 프로젝트</div>
          {recentProjects.length === 0 ? (
            <p className="nav-empty">아직 프로젝트가 없어요</p>
          ) : (
            recentProjects.map((project) => (
              <button key={project.id} className="recent-row" type="button" title={project.title} aria-current={project.id === currentId ? "true" : undefined} onClick={() => work(project.id)}>
                <span className="mini">{project.poster ? <img src={mediaUrl(project.id, project.poster)} alt="" loading="lazy" /> : <Film size={13} />}</span>
                <span className="rname">{project.title}</span>
              </button>
            ))
          )}
        </nav>
        <button className="nav-item settings" type="button" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}>
          <SettingsIcon size={18} />
          설정
        </button>
      </aside>

      <header className="top">
        <div className="crumbs">
          <span>작업 공간</span>
          <ChevronRight size={14} />
          <strong>{active.label}</strong>
        </div>
        <div className="work">
          <WorkSteps stages={current?.stages ?? null} onGo={(target) => go(stepTargets[target])} />
        </div>
        <ResourceBar connected={connected} />
        <button className="icon-btn" type="button" title="라이트/다크 전환" aria-label="라이트/다크 전환" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <main className="main">
        {page === "start" && (
          <StartPage
            projects={projects}
            currentId={currentId}
            view={projectView}
            onWork={work}
            onOpenDetail={setDetailId}
            onFavorite={(id, favorite) => void toggleFavorite(id, favorite)}
            onCreated={(project) => {
              select(project.id);
              reload();
            }}
            onSet={setProjectField}
            onReset={resetProjectField}
            notify={setMessage}
          />
        )}
        {page === "library" && (
          <LibraryPage projects={projects} currentId={currentId} onWork={work} onOpenDetail={setDetailId} onFavorite={(id, favorite) => void toggleFavorite(id, favorite)} onNew={() => go("start")} />
        )}
        {page === "settings" && <SettingsPage notify={setMessage} onSaved={reload} />}
        {(page === "scenario" || page === "storyboard" || page === "video") && <ComingPage title={active.label} kicker="다음 단계에서" icon={active.icon} projectTitle={current?.title ?? null} />}
      </main>

      <footer className="status">
        <span className="msg">{connected ? message : "서버에 연결할 수 없습니다. 연결을 다시 시도합니다."}</span>
        <span>{projects.length}개 프로젝트</span>
      </footer>

      {detailId && <ProjectModal id={detailId} onClose={() => setDetailId(null)} onWork={work} />}
    </div>
  );
}
