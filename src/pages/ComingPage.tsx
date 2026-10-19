import type { LucideIcon } from "lucide-react";

interface Props {
  title: string;
  icon: LucideIcon;
  projectTitle: string | null;
}

export default function ComingPage({ title, icon: Icon, projectTitle }: Props) {
  return (
    <>
      <h1>{title}</h1>
      <div className="empty">
        <Icon size={36} />
        <div>이 화면은 다음 단계에서 만들어집니다.</div>
        <div>{projectTitle ? `현재 프로젝트: ${projectTitle}` : "시작 화면에서 프로젝트를 선택하세요."}</div>
      </div>
    </>
  );
}
