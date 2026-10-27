import { Save, Wand2 } from "lucide-react";
import { useState } from "react";
import { DIRECTION_PRESETS } from "../../shared/presets.mjs";
import { ApiError } from "../api";
import PromptLog from "../components/PromptLog";
import { BIBLE_FILE, type Bible } from "../bible";
import { storyApi, type SynopsisOption } from "../story";
import { useJsonFile, useTextFile } from "../useFile";
import type { SectionProps } from "./types";

/** The story in a few paragraphs (studio/synopsis.md). From an idea the LLM offers four options; the scenario is written from the one you keep. */
export default function SynopsisSection({ project, onChanged, notify }: SectionProps) {
  const file = useTextFile(project.id, "studio/synopsis.md", notify);
  const bible = useJsonFile<Bible>(project.id, BIBLE_FILE, notify).data;
  const [idea, setIdea] = useState("");
  const [preset, setPreset] = useState<string | null>(null);
  const [options, setOptions] = useState<SynopsisOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosenPreset = preset ?? bible?.preset ?? "";

  async function save() {
    if (await file.save()) onChanged();
  }

  async function suggest() {
    setError("");
    if (!idea.trim()) return setError("만들고 싶은 이야기를 한두 문장으로 적어 주세요.");
    setBusy(true);
    try {
      setOptions(await storyApi.synopses(project.id, idea, chosenPreset));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "줄거리를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <h2>줄거리</h2>
      <p className="muted section-note">주제를 바탕으로 한 전체 이야기입니다. 아이디어를 적으면 LLM이 서로 다른 줄거리 4가지를 제안하고, 마음에 드는 안을 골라 고쳐 쓸 수 있어요. 시나리오는 저장된 줄거리에서 만들어집니다.</p>

      <div className="gen-card" style={{ maxWidth: 900 }}>
        <div className="fields">
          <div className="field wide">
            <label htmlFor="story-idea">아이디어</label>
            <textarea id="story-idea" rows={3} value={idea} maxLength={4000} onChange={(event) => setIdea(event.target.value)} placeholder="예: 비 오는 날 우산을 두고 온 소녀가 낯선 사람과 같은 우산을 쓰게 된다" />
          </div>
          <div className="field">
            <label htmlFor="story-preset">연출 스타일</label>
            <select id="story-preset" value={chosenPreset} onChange={(event) => setPreset(event.target.value)}>
              <option value="">(정하지 않음)</option>
              {DIRECTION_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="hint">영상 전체에 적용하려면 등장인물 탭에서 같은 스타일을 고르고 저장하세요.</span>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" type="button" disabled={busy} onClick={() => void suggest()}>
            <Wand2 size={15} /> {busy ? "줄거리 만드는 중 (1~2분)..." : "줄거리 4안 만들기"}
          </button>
        </div>
        {options.length > 0 && (
          <div className="options">
            {options.map((option, index) => (
              <article key={index} className="option-card">
                <strong>
                  {index + 1}안 · {option.title}
                </strong>
                <span className="muted">{option.logline}</span>
                <p>{option.synopsis}</p>
                <button className="btn" type="button" onClick={() => file.setText(option.synopsis)}>
                  이 안으로 쓰기
                </button>
              </article>
            ))}
          </div>
        )}
        <PromptLog projectId={project.id} stages={["synopsis"]} refreshKey={busy ? 1 : 0} />
      </div>

      <textarea className="big" rows={14} disabled={!file.ready} value={file.text} maxLength={20000} onChange={(event) => file.setText(event.target.value)} placeholder="아직 줄거리가 없습니다. 이야기를 적거나 위에서 제안을 받아 보세요." />
      <div className="row between" style={{ marginTop: 12 }}>
        <span className="hint">{file.text.length.toLocaleString()}자 · 파일: studio/synopsis.md</span>
        <button className="btn primary" type="button" disabled={!file.dirty || file.saving} onClick={() => void save()}>
          <Save size={15} /> 저장
        </button>
      </div>
    </div>
  );
}
