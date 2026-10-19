import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { formatDate } from "../format";
import { useTextFile } from "../useFile";
import type { SectionProps } from "./types";

/** Title (stored in studio/meta.json, the folder name never changes) and the topic (studio/topic.md). */
export default function TitleSection({ project, onChanged, notify }: SectionProps) {
  const [title, setTitle] = useState(project.title);
  const [titleError, setTitleError] = useState("");
  const topic = useTextFile(project.id, "studio/topic.md", notify);

  useEffect(() => setTitle(project.title), [project.title]);

  async function saveTitle() {
    setTitleError("");
    try {
      await api("PUT", `/api/projects/${encodeURIComponent(project.id)}/meta`, { title });
      onChanged();
      notify("제목을 저장했습니다.");
    } catch (e) {
      setTitleError(e instanceof ApiError ? e.message : "제목을 저장하지 못했습니다.");
    }
  }

  return (
    <div className="section">
      <h2>제목과 주제</h2>
      <div className="fields one">
        <div className="field">
          <label htmlFor="proj-title">제목</label>
          <div className="row">
            <input id="proj-title" style={{ flex: 1 }} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} />
            <button className="btn primary" type="button" disabled={title.trim() === project.title || !title.trim()} onClick={() => void saveTitle()}>
              <Save size={15} /> 저장
            </button>
          </div>
          {titleError ? <span className="error">{titleError}</span> : <span className="hint">폴더 이름({project.id})은 바뀌지 않습니다.</span>}
        </div>
        <div className="field">
          <label htmlFor="proj-topic">주제</label>
          <textarea id="proj-topic" rows={4} disabled={!topic.ready} value={topic.text} maxLength={2000} onChange={(event) => topic.setText(event.target.value)} placeholder="어떤 영상을 만들까요?" />
          <div className="row">
            <button className="btn primary" type="button" disabled={!topic.dirty || topic.saving} onClick={() => void topic.save()}>
              <Save size={15} /> 주제 저장
            </button>
            <span className="hint">파일: studio/topic.md</span>
          </div>
        </div>
        <div className="field">
          <label>정보</label>
          <span className="hint">수정일 {formatDate(project.updatedAt)} · {project.hasFinal ? "완성본 있음" : "완성본 없음"}</span>
        </div>
      </div>
    </div>
  );
}
