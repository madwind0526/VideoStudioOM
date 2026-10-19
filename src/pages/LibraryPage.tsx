import { Plus } from "lucide-react";
import type { ProjectSummary } from "../api";
import ProjectBoard from "../components/ProjectBoard";

interface Props {
  projects: ProjectSummary[];
  currentId: string | null;
  onWork: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onNew: () => void;
}

export default function LibraryPage({ projects, currentId, onWork, onOpenDetail, onFavorite, onNew }: Props) {
  return (
    <div className="page">
      <ProjectBoard
        kicker="나의 영상을 한곳에"
        title="내 라이브러리"
        subtitle="주제부터 시나리오, 이미지, 영상까지 함께 보관하는 나만의 컬렉션."
        action={
          <button className="btn primary" type="button" onClick={onNew}>
            <Plus size={15} /> 새 영상 만들기
          </button>
        }
        projects={projects}
        currentId={currentId}
        onWork={onWork}
        onOpenDetail={onOpenDetail}
        onFavorite={onFavorite}
      />
    </div>
  );
}
