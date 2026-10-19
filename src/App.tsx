import { FileText, Film, House, LayoutGrid, Library, Moon, Settings as SettingsIcon, Sun, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LLM_PROVIDERS } from "../shared/settings.mjs";
import { api, type ProjectSettingsView, type ProjectSummary } from "./api";
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
  { id: "library", label: "라이브러리", icon: Library },
  { id: "settings", label: "설정", icon: SettingsIcon },
];

const STEPS = ["줄거리", "시나리오", "대본", "이미지", "영상", "합성"];

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

function pageFromHash(): PageId {
  const id = window.location.hash.replace("#/", "");
  return PAGES.some((page) => page.id === id) ? (id as PageId) : "start";
}

export default function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => remembered("currentProject"));
  const [projectView, setProjectView] = useState<ProjectSettingsView | null>(null);
  const [message, setMessage] = useState("준비됨");
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = remembered("theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("theme", theme);
  }, [theme]);

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

  const select = (id: string) => {
    setCurrentId(id);
    remember("currentProject", id);
  };

  const go = (id: PageId) => {
    window.location.hash = `#/${id}`;
  };

  // "This run only" LLM choice: stored as a project override, so it never touches the global default.
  async function chooseProvider(provider: string) {
    if (!currentId) return;
    try {
      setProjectView(await api<ProjectSettingsView>("PUT", `/api/projects/${encodeURIComponent(currentId)}/settings`, { set: { llm: { provider } } }));
      setMessage(`이번 작업의 LLM을 ${provider}로 바꿨습니다.`);
    } catch {
      setMessage("LLM을 바꾸지 못했습니다.");
    }
  }

  const current = projects.find((project) => project.id === currentId) ?? null;
  const active = PAGES.find((item) => item.id === page)!;

  return (
    <div className="app">
      <nav className="side" aria-label="메뉴">
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button key={id} className="icon-btn" title={label} aria-label={label} aria-current={id === page ? "page" : undefined} onClick={() => go(id)}>
            <Icon size={20} />
          </button>
        ))}
        <div className="spacer" />
        <button className="icon-btn" title="라이트/다크 전환" aria-label="라이트/다크 전환" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </nav>

      <header className="top">
        <div className="title">{current?.title ?? "프로젝트 없음"}</div>
        <div className="steps" title="단계별 진행 표시는 시나리오 단계부터 연결됩니다.">
          {STEPS.map((step) => (
            <span key={step} className="step">
              {step}
            </span>
          ))}
        </div>
        <select
          aria-label="이번 작업의 LLM"
          title={current ? "이번 작업에서 쓸 LLM (전역 기본값은 설정 화면)" : "프로젝트를 선택하면 바꿀 수 있습니다."}
          disabled={!projectView}
          value={projectView?.effective.llm.provider ?? ""}
          onChange={(event) => void chooseProvider(event.target.value)}
        >
          {!projectView && <option value="">LLM</option>}
          {LLM_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </header>

      <main className="main">
        {page === "start" && <StartPage projects={projects} currentId={currentId} onSelect={select} onCreated={(project) => { select(project.id); reload(); }} notify={setMessage} />}
        {page === "library" && <LibraryPage projects={projects} currentId={currentId} onSelect={select} refreshKey={refreshKey} />}
        {page === "settings" && <SettingsPage notify={setMessage} onSaved={reload} />}
        {(page === "scenario" || page === "storyboard" || page === "video") && <ComingPage title={active.label} icon={active.icon} projectTitle={current?.title ?? null} />}
      </main>

      <footer className="status">
        <span className={connected ? "dot on" : "dot"} title={connected ? "서버 연결됨" : "서버 연결 끊김"} />
        <span className="msg">{connected ? message : "서버에 연결할 수 없습니다. 연결을 다시 시도합니다."}</span>
        <span>{projects.length}개 프로젝트</span>
      </footer>
    </div>
  );
}
