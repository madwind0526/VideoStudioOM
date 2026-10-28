import { ChevronRight, Film, FolderOpen, Heart, Library, Moon, Plus, Settings as SettingsIcon, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, mediaUrl, type ProjectSettingsView, type ProjectSummary } from "./api";
import { BRAND } from "./brand";
import Logo from "./components/Logo";
import ErrorBoundary from "./components/ErrorBoundary";
import ProjectModal from "./components/ProjectModal";
import VideoPlayer from "./components/VideoPlayer";
import ResourceBar from "./components/ResourceBar";
import { setIn } from "./fields";
import { LibraryPage, LikesPage } from "./pages/LibraryPage";
import ProjectsScreen, { SECTIONS } from "./pages/ProjectWorkspace";
import SettingsPage from "./pages/SettingsPage";
import StartPage from "./pages/StartPage";
import type { SectionId } from "./sections/types";
import { useEvents } from "./useEvents";

// #/create  #/projects  #/projects/<id>/<section>  #/library  #/likes  #/settings
type Route = { page: "create" } | { page: "projects" } | { page: "project"; id: string; section: SectionId } | { page: "library" } | { page: "likes" } | { page: "settings" };

const SECTION_IDS = SECTIONS.map((section) => section.id);

function parseRoute(): Route {
  let parts: string[];
  try {
    parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { page: "create" };
  }
  const [head, id, section] = parts;
  if (head === "projects") return id ? { page: "project", id, section: SECTION_IDS.includes(section as SectionId) ? (section as SectionId) : "title" } : { page: "projects" };
  if (head === "library" || head === "likes" || head === "settings") return { page: head };
  return { page: "create" };
}

function hashOf(route: Route): string {
  if (route.page === "project") return `#/projects/${encodeURIComponent(route.id)}/${route.section}`;
  return `#/${route.page}`;
}

type NavKey = "create" | "projects" | "library" | "likes";
const NAV: { key: NavKey; label: string; icon: LucideIcon }[] = [
  { key: "create", label: "만들기", icon: Sparkles },
  { key: "projects", label: "프로젝트", icon: FolderOpen },
  { key: "library", label: "라이브러리", icon: Library },
  { key: "likes", label: "좋아요", icon: Heart },
];

const PAGE_LABELS: Record<Route["page"], string> = { create: "만들기", projects: "프로젝트", project: "프로젝트", library: "라이브러리", likes: "좋아요", settings: "설정" };
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

export default function App() {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(() => remembered("currentProject"));
  const [recentIds, setRecentIds] = useState<string[]>(() => rememberedList("recentProjects"));
  const [detailId, setDetailId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [projectView, setProjectView] = useState<ProjectSettingsView | null>(null);
  const [message, setMessage] = useState("준비됨");
  const [refreshKey, setRefreshKey] = useState(0);
  const [jobTick, setJobTick] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = remembered("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("theme", theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      setDetailId(null); // a details window belongs to the page it was opened on
      setPlayerId(null);
    };
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
    useCallback(() => setJobTick((tick) => tick + 1), []),
  );

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("GET", "/api/projects")
      .then((data) => {
        setProjects(data.projects);
        setProjectsLoaded(true);
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

  const go = (next: Route) => {
    window.location.hash = hashOf(next);
  };

  /** Makes a project the selected one and moves it to the front of the recent list. */
  const select = useCallback((id: string) => {
    setCurrentId(id);
    remember("currentProject", id);
    setRecentIds((list) => {
      const next = [id, ...list.filter((item) => item !== id)].slice(0, RECENT_LIMIT);
      remember("recentProjects", JSON.stringify(next));
      return next;
    });
  }, []);

  // Opening a project (from any link, including a pasted address) selects it.
  const openedId = route.page === "project" ? route.id : null;
  useEffect(() => {
    if (openedId) select(openedId);
  }, [openedId, select]);

  const playerProject = projects.find((project) => project.id === playerId);

  const openProject = (id: string, section: SectionId = "title") => go({ page: "project", id, section });

  async function deleteProject(id: string) {
    try {
      await api("DELETE", `/api/projects/${encodeURIComponent(id)}`);
      setMessage("프로젝트를 지웠습니다. (projects/.trash로 옮겨짐)");
      // The project that was open is gone: back to the list.
      if (route.page === "project" && route.id === id) go({ page: "projects" });
      reload();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "프로젝트를 지우지 못했습니다.");
    }
  }

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
  const onFavorite = (id: string, favorite: boolean) => void toggleFavorite(id, favorite);

  const current = projects.find((project) => project.id === currentId) ?? null;
  // Sidebar list: recently opened projects, or the most recently changed ones until something was opened.
  const recentProjects = (() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    const opened = recentIds.map((id) => byId.get(id)).filter((project): project is ProjectSummary => Boolean(project));
    return (opened.length > 0 ? opened : [...projects].sort((a, b) => b.updatedAt - a.updatedAt)).slice(0, 5);
  })();
  const activeNav: NavKey | null = route.page === "project" ? "projects" : route.page === "settings" ? null : route.page;
  const openedProject = route.page === "project" ? projects.find((project) => project.id === route.id) : undefined;

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
          {NAV.map(({ key, label, icon: Icon }) => (
            <button key={key} className="nav-item" type="button" aria-current={key === activeNav ? "page" : undefined} onClick={() => go({ page: key })}>
              <Icon size={18} />
              <span className="nav-text">{label}</span>
              {key === "create" && <Plus size={15} className="nav-plus" />}
            </button>
          ))}
          <div className="nav-divider" role="separator" />
          <div className="nav-label">최근 프로젝트</div>
          {recentProjects.length === 0 ? (
            <p className="nav-empty">아직 프로젝트가 없어요</p>
          ) : (
            recentProjects.map((project) => (
              <button key={project.id} className="recent-row" type="button" title={project.title} aria-current={openedId === project.id ? "true" : undefined} onClick={() => openProject(project.id)}>
                <span className="mini">{project.poster ? <img src={mediaUrl(project.id, project.poster)} alt="" loading="lazy" /> : <Film size={13} />}</span>
                <span className="rname">{project.title}</span>
              </button>
            ))
          )}
        </nav>
        <button className="nav-item settings" type="button" aria-current={route.page === "settings" ? "page" : undefined} onClick={() => go({ page: "settings" })}>
          <SettingsIcon size={18} />
          <span className="nav-text">설정</span>
        </button>
      </aside>

      <header className="top">
        <div className="crumbs">
          <span>작업 공간</span>
          <ChevronRight size={14} />
          <strong>{PAGE_LABELS[route.page]}</strong>
          {route.page === "project" && openedProject && (
            <>
              <ChevronRight size={14} />
              <strong className="crumb-title">{openedProject.title}</strong>
            </>
          )}
        </div>
        <div className="work" />
        <ResourceBar connected={connected} />
        <button className="icon-btn" type="button" title="라이트/다크 전환" aria-label="라이트/다크 전환" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <main className="main">
        {/* A crash inside one page keeps the menu and the status bar; moving to another page tries again. */}
        <ErrorBoundary resetKey={hashOf(route)}>
        {route.page === "create" && (
          <StartPage
            projects={projects}
            currentId={currentId}
            view={projectView}
            onWork={(id) => openProject(id)}
            onOpenDetail={setDetailId}
            onSelect={select}
            onDelete={deleteProject}
            onFavorite={onFavorite}
            onCreated={(project) => {
              select(project.id);
              reload();
            }}
            onSet={setProjectField}
            onReset={resetProjectField}
            notify={setMessage}
          />
        )}
        {(route.page === "projects" || route.page === "project") && (
          <ProjectsScreen
            projects={projects}
            projectsLoaded={projectsLoaded}
            selectedId={route.page === "project" ? route.id : null}
            section={route.page === "project" ? route.section : "title"}
            view={route.page === "project" && route.id === currentId ? projectView : null}
            jobTick={jobTick}
            refreshKey={refreshKey}
            onSelect={(id) => openProject(id, route.page === "project" ? route.section : "title")}
            onSection={(section) => route.page === "project" && openProject(route.id, section)}
            onNew={() => go({ page: "create" })}
            onFavorite={onFavorite}
            onDelete={deleteProject}
            onChanged={reload}
            notify={setMessage}
          />
        )}
        {route.page === "library" && <LibraryPage projects={projects} currentId={currentId} onOpen={(id) => openProject(id, "videos")} onOpenDetail={setDetailId} onFavorite={onFavorite} onDelete={deleteProject} onPlay={setPlayerId} onNew={() => go({ page: "create" })} />}
        {route.page === "likes" && <LikesPage projects={projects} currentId={currentId} onOpen={(id) => openProject(id, "videos")} onOpenDetail={setDetailId} onFavorite={onFavorite} onDelete={deleteProject} onPlay={setPlayerId} />}
        {route.page === "settings" && <SettingsPage notify={setMessage} onSaved={reload} />}
        </ErrorBoundary>
      </main>

      <footer className="status">
        <span className="msg">{connected ? message : "서버에 연결할 수 없습니다. 연결을 다시 시도합니다."}</span>
        <span>{projects.length}개 프로젝트</span>
      </footer>

      {playerProject?.video && <VideoPlayer src={mediaUrl(playerProject.id, playerProject.video)} poster={playerProject.poster ? mediaUrl(playerProject.id, playerProject.poster) : undefined} title={playerProject.title} onClose={() => setPlayerId(null)} />}

      {detailId && (
        <ProjectModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onWork={(id) => {
            setDetailId(null);
            openProject(id, "videos");
          }}
        />
      )}
    </div>
  );
}
