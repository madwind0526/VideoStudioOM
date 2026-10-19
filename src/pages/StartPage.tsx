import { Plus } from "lucide-react";
import { useState } from "react";
import { api, ApiError, type ProjectSummary } from "../api";
import ProjectList from "../components/ProjectList";

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreated: (project: ProjectSummary) => void;
  notify: (text: string) => void;
}

export default function StartPage({ projects, currentId, onSelect, onCreated, notify }: Props) {
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

  return (
    <>
      <h1>시작</h1>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label htmlFor="new-title">새 프로젝트 제목</label>
          <input id="new-title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="예: 벌의 8자 춤" />
        </div>
        <button className="btn" type="submit" disabled={busy || !title.trim()}>
          <Plus size={16} /> 만들기
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="muted">주제, 화면 비율, 길이 같은 작업 설정은 다음 단계에서 이 화면에 추가됩니다.</p>

      <h2>최근 프로젝트</h2>
      <ProjectList projects={projects} selectedId={currentId} onSelect={onSelect} />
    </>
  );
}
