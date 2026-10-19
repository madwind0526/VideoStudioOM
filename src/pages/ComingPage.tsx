import type { LucideIcon } from "lucide-react";

interface Props {
  title: string;
  kicker: string;
  icon: LucideIcon;
  projectTitle: string | null;
}

export default function ComingPage({ title, kicker, icon: Icon, projectTitle }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">{kicker}</div>
          <h1>{title}</h1>
          <p className="sub">{projectTitle ? `현재 프로젝트: ${projectTitle}` : "시작 화면에서 프로젝트를 선택하세요."}</p>
        </div>
      </div>
      <div className="empty">
        <div className="tile">
          <Icon size={30} />
        </div>
        <strong>이 화면은 다음 단계에서 만들어져요</strong>
        <span>시나리오, 스토리보드, 영상 화면은 순서대로 열립니다.</span>
      </div>
    </div>
  );
}
