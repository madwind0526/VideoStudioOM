import { BookOpen, Check, Clapperboard, Film, Image as ImageIcon, Mic, ScrollText, Type, UserRound, type LucideIcon } from "lucide-react";
import type { ProjectSettingsView, ProjectSummary } from "../api";
import ProjectPicker from "../components/ProjectPicker";
import { AudioSection, ImagesSection, VideosSection } from "../sections/MediaSections";
import CharactersSection from "../sections/CharactersSection";
import ScenarioSection from "../sections/ScenarioSection";
import ScriptSection from "../sections/ScriptSection";
import SynopsisSection from "../sections/SynopsisSection";
import TitleSection from "../sections/TitleSection";
import type { SectionId, SectionProps } from "../sections/types";
import { useJobs, useProjectDetail } from "../useProject";

export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "title", label: "제목", icon: Type },
  { id: "synopsis", label: "줄거리", icon: BookOpen },
  { id: "scenario", label: "시나리오", icon: Clapperboard },
  { id: "script", label: "대본", icon: ScrollText },
  { id: "characters", label: "등장인물", icon: UserRound },
  { id: "images", label: "이미지", icon: ImageIcon },
  { id: "audio", label: "오디오", icon: Mic },
  { id: "videos", label: "동영상", icon: Film },
];

interface PaneProps {
  project: ProjectSummary;
  section: SectionId;
  view: ProjectSettingsView | null;
  jobTick: number;
  refreshKey: number;
  onSection: (section: SectionId) => void;
  onChanged: () => void;
  notify: (text: string) => void;
}

/** One project: its parts as a row of tabs on top and the chosen part below, to read and edit. */
function ProjectPane({ project, section, view, jobTick, refreshKey, onSection, onChanged, notify }: PaneProps) {
  const { detail, reload: reloadDetail } = useProjectDetail(project.id, refreshKey, jobTick);
  const jobs = useJobs(jobTick);

  const stage = (name: string) => project.stages.find((item) => item.id === name)?.done === true;
  // Right of each tab: a check when the part exists, a number for media files.
  const badge = (key: SectionId): string | boolean => {
    switch (key) {
      case "synopsis":
      case "scenario":
      case "script":
        return stage(key);
      case "images":
        return detail ? String(detail.media.images.length) : false;
      case "audio":
        return detail ? String(detail.media.audio.length) : false;
      case "videos":
        return detail ? String(detail.media.videos.length) : false;
      default:
        return false;
    }
  };

  const props: SectionProps = {
    project,
    detail,
    view,
    jobs: { current: jobs.current, history: jobs.history, pending: jobs.pending, paused: jobs.paused },
    onJobsChanged: () => {
      void jobs.reload();
      void reloadDetail();
    },
    onChanged,
    notify,
  };

  const body = {
    title: <TitleSection {...props} />,
    synopsis: <SynopsisSection {...props} />,
    scenario: <ScenarioSection {...props} />,
    script: <ScriptSection {...props} />,
    characters: <CharactersSection {...props} />,
    images: <ImagesSection {...props} />,
    audio: <AudioSection {...props} />,
    videos: <VideosSection {...props} />,
  }[section];

  return (
    <>
      <div className="tabs proj-tabs" role="tablist" aria-label="프로젝트 구성">
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const value = badge(id);
          return (
            <button key={id} className="tab" role="tab" aria-selected={id === section} onClick={() => onSection(id)}>
              <Icon size={15} />
              {label}
              {value === true ? <Check size={13} className="done" /> : typeof value === "string" && value !== "0" ? <span className="count">{value}</span> : null}
            </button>
          );
        })}
      </div>
      {/* key: switching parts starts each editor from its own file, with nothing left over from the previous one */}
      <div className="proj-main" key={`${project.id}/${section}`}>
        {body}
      </div>
    </>
  );
}

interface Props {
  projects: ProjectSummary[];
  projectsLoaded: boolean;
  /** The project chosen in the list (from the address), or null when none is chosen. */
  selectedId: string | null;
  section: SectionId;
  view: ProjectSettingsView | null;
  jobTick: number;
  refreshKey: number;
  onSelect: (id: string) => void;
  onSection: (section: SectionId) => void;
  onNew: () => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onChanged: () => void;
  notify: (text: string) => void;
}

/** The project screen: a scrolling list of project cards in the middle, the chosen project's parts on the right. */
export default function ProjectsScreen({ projects, projectsLoaded, selectedId, section, view, jobTick, refreshKey, onSelect, onSection, onNew, onFavorite, onChanged, notify }: Props) {
  const project = projects.find((item) => item.id === selectedId);
  return (
    <div className="proj-layout">
      <ProjectPicker projects={projects} selectedId={selectedId} onSelect={onSelect} onFavorite={onFavorite} onNew={onNew} />
      <div className="proj-detail">
        {!selectedId ? (
          <div className="empty fill">
            <div className="tile">
              <Film size={30} />
            </div>
            <strong>프로젝트를 선택하세요</strong>
            <span>왼쪽 목록에서 카드를 누르면 줄거리, 시나리오, 대본, 이미지, 오디오, 동영상을 확인하고 고칠 수 있어요.</span>
          </div>
        ) : project ? (
          <ProjectPane key={project.id} project={project} section={section} view={view} jobTick={jobTick} refreshKey={refreshKey} onSection={onSection} onChanged={onChanged} notify={notify} />
        ) : (
          <p className="muted" style={{ padding: 40 }}>
            {projectsLoaded ? "이 프로젝트를 찾을 수 없습니다. 폴더가 지워졌거나 옮겨졌을 수 있어요." : "불러오는 중..."}
          </p>
        )}
      </div>
    </div>
  );
}
