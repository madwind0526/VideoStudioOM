import { Plus } from "lucide-react";
import type { ProjectSummary } from "../api";
import ProjectBoard from "../components/ProjectBoard";

interface Props {
  /** All projects; only the ones with a finished video are shown. */
  projects: ProjectSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onNew: () => void;
}

/** Finished videos only. */
export function LibraryPage({ projects, currentId, onOpen, onOpenDetail, onFavorite, onNew }: Props) {
  return (
    <div className="page">
      <ProjectBoard
        kicker="나의 영상을 한곳에"
        title="라이브러리"
        subtitle="완성된 동영상만 모아 봅니다. 카드를 누르면 바로 재생돼요."
        action={
          <button className="btn primary" type="button" onClick={onNew}>
            <Plus size={15} /> 새 영상 만들기
          </button>
        }
        projects={projects.filter((project) => project.hasFinal)}
        currentId={currentId}
        tabIds={["all"]}
        onWork={onOpen}
        onOpenDetail={onOpenDetail}
        onFavorite={onFavorite}
      />
    </div>
  );
}

/** Finished videos marked as liked. */
export function LikesPage({ projects, currentId, onOpen, onOpenDetail, onFavorite }: Omit<Props, "onNew">) {
  return (
    <div className="page">
      <ProjectBoard
        kicker="내가 좋아하는 영상"
        title="좋아요"
        subtitle="하트를 누른 완성된 동영상만 모아 봅니다."
        projects={projects.filter((project) => project.hasFinal && project.favorite)}
        currentId={currentId}
        tabIds={["all"]}
        onWork={onOpen}
        onOpenDetail={onOpenDetail}
        onFavorite={onFavorite}
      />
    </div>
  );
}
