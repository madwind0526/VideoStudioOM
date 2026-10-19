import { Film } from "lucide-react";
import { mediaUrl, type ProjectSummary } from "../api";

interface Props {
  projects: ProjectSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ProjectList({ projects, selectedId, onSelect }: Props) {
  if (projects.length === 0) return <p className="muted">아직 프로젝트가 없습니다.</p>;
  return (
    <div className="grid">
      {projects.map((project) => (
        <button key={project.id} className="card" aria-pressed={project.id === selectedId} onClick={() => onSelect(project.id)}>
          <div className="poster">
            {project.poster ? <img src={mediaUrl(project.id, project.poster)} alt="" loading="lazy" /> : <Film size={28} />}
          </div>
          <div className="body">
            <div className="name" title={project.title}>
              {project.title}
            </div>
            {project.hasFinal && <span className="badge">완성본</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
