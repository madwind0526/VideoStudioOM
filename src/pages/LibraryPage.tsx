import { useEffect, useState } from "react";
import { api, mediaUrl, type ProjectDetail, type ProjectSummary } from "../api";
import ProjectList from "../components/ProjectList";

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  refreshKey: number;
}

export default function LibraryPage({ projects, currentId, onSelect, refreshKey }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);

  useEffect(() => {
    if (!currentId) {
      setDetail(null);
      return;
    }
    let stale = false;
    api<{ project: ProjectDetail }>("GET", `/api/projects/${encodeURIComponent(currentId)}`)
      .then((data) => !stale && setDetail(data.project))
      .catch(() => !stale && setDetail(null));
    return () => {
      stale = true;
    };
  }, [currentId, refreshKey]);

  return (
    <>
      <h1>라이브러리</h1>
      <ProjectList projects={projects} selectedId={currentId} onSelect={onSelect} />
      {detail && (
        <section className="detail">
          <h2 style={{ marginTop: 0 }}>{detail.title}</h2>
          {detail.hasFinal ? (
            <video
              key={detail.id}
              controls
              preload="metadata"
              poster={detail.poster ? mediaUrl(detail.id, detail.poster) : undefined}
              src={mediaUrl(detail.id, "renders/final.mp4")}
            />
          ) : (
            <p className="muted">아직 완성된 영상이 없습니다.</p>
          )}
          <h2>작업 파일</h2>
          {detail.files.length === 0 ? (
            <p className="muted">studio/, artifacts/ 폴더에 파일이 없습니다.</p>
          ) : (
            <ul className="files">
              {detail.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
