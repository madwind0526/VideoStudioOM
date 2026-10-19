import { Save } from "lucide-react";
import { useTextFile } from "../useFile";
import type { SectionProps } from "./types";

/** The story in a few paragraphs (studio/synopsis.md). The scenario is written from it. */
export default function SynopsisSection({ project, onChanged, notify }: SectionProps) {
  const file = useTextFile(project.id, "studio/synopsis.md", notify);

  async function save() {
    if (await file.save()) onChanged();
  }

  return (
    <div className="section">
      <h2>줄거리</h2>
      <p className="muted section-note">주제를 바탕으로 한 전체 이야기입니다. 시나리오는 이 줄거리에서 만들어집니다. 직접 쓰거나, 다음 단계에서 LLM이 써 주는 글을 여기서 고칠 수 있어요.</p>
      <textarea className="big" rows={14} disabled={!file.ready} value={file.text} maxLength={20000} onChange={(event) => file.setText(event.target.value)} placeholder="아직 줄거리가 없습니다. 이야기를 적어 보세요." />
      <div className="row between" style={{ marginTop: 12 }}>
        <span className="hint">{file.text.length.toLocaleString()}자 · 파일: studio/synopsis.md</span>
        <button className="btn primary" type="button" disabled={!file.dirty || file.saving} onClick={() => void save()}>
          <Save size={15} /> 저장
        </button>
      </div>
    </div>
  );
}
