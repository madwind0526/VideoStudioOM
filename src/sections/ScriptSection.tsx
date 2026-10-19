import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { formatTime } from "../format";
import { useJsonFile } from "../useFile";
import type { SectionProps } from "./types";

// Measured with Qwen3-TTS (voice Sohee): 33 characters took 5.04 s, about 6.5 characters per second.
const KOREAN_CHARS_PER_SECOND = 6.5;

interface ScriptPart {
  id: string;
  label?: string;
  text: string;
  start_seconds: number;
  end_seconds: number;
  [key: string]: unknown;
}

interface Script {
  version: string;
  title: string;
  total_duration_seconds: number;
  sections: ScriptPart[];
  [key: string]: unknown;
}

function nextId(parts: ScriptPart[]): string {
  let n = parts.length + 1;
  while (parts.some((part) => part.id === `section-${n}`)) n += 1;
  return `section-${n}`;
}

function newPart(parts: ScriptPart[]): ScriptPart {
  const start = parts.at(-1)?.end_seconds ?? 0;
  return { id: nextId(parts), text: "", start_seconds: start, end_seconds: start + 5 };
}

const longest = (parts: ScriptPart[]) => parts.reduce((max, part) => (Number.isFinite(part.end_seconds) ? Math.max(max, part.end_seconds) : max), 0);

function check(parts: ScriptPart[]): { problems: string[]; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  parts.forEach((part, index) => {
    const name = `${index + 1}번 구간`;
    if (!part.id.trim()) problems.push(`${name}: 이름(id)이 비어 있습니다.`);
    else if (parts.findIndex((other) => other.id === part.id) !== index) problems.push(`${name}: 이름(id) "${part.id}"이 겹칩니다.`);
    if (!Number.isFinite(part.start_seconds) || !Number.isFinite(part.end_seconds)) problems.push(`${name}: 시작과 끝 시간을 숫자로 입력하세요.`);
    else if (part.end_seconds <= part.start_seconds) problems.push(`${name}: 끝이 시작보다 커야 합니다.`);
    else if (part.text.length / KOREAN_CHARS_PER_SECOND > (part.end_seconds - part.start_seconds) * 1.15) {
      warnings.push(`${name}: 대사가 구간보다 깁니다. 읽는 데 약 ${(part.text.length / KOREAN_CHARS_PER_SECOND).toFixed(1)}초가 걸려요.`);
    }
  });
  return { problems, warnings };
}

const num = (value: number) => (Number.isFinite(value) ? value : "");

/** View and edit the script (artifacts/script.json): what is said and when. */
export default function ScriptSection({ project, onChanged, notify }: SectionProps) {
  const file = useJsonFile<Script>(project.id, "artifacts/script.json", notify);
  const script = file.data;
  const parts = script?.sections ?? [];
  const { problems, warnings } = check(parts);

  // The total length always follows the last end time, so the file stays consistent.
  const setParts = (next: ScriptPart[]) => script && file.setData({ ...script, sections: next, total_duration_seconds: longest(next) });
  const update = (index: number, patch: Partial<ScriptPart>) => setParts(parts.map((part, i) => (i === index ? { ...part, ...patch } : part)));

  async function save() {
    if (await file.save()) onChanged();
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>대본</h2>
        {script && (
          <div className="row">
            <span className="muted">
              {parts.length}구간 · 총 {formatTime(longest(parts))}
            </span>
            <button className="btn" type="button" onClick={() => setParts([...parts, newPart(parts)])}>
              <Plus size={15} /> 구간 추가
            </button>
            <button className="btn" type="button" disabled={!file.dirty} onClick={file.revert}>
              <RotateCcw size={15} /> 되돌리기
            </button>
            <button className="btn primary" type="button" disabled={!file.dirty || problems.length > 0 || file.saving} onClick={() => void save()}>
              <Save size={15} /> 저장
            </button>
          </div>
        )}
      </div>
      <p className="muted section-note">시간대별로 읽을 대사입니다. 한국어는 1초에 약 6~7글자를 읽어서, 구간보다 긴 대사는 알려 드려요. 자동으로 만들어 주는 기능은 다음 단계에서 추가됩니다.</p>

      {!file.ready ? (
        <p className="muted">불러오는 중...</p>
      ) : file.invalid ? (
        <div className="textblock">
          <p className="error">script.json을 읽을 수 없습니다(JSON 형식 오류). 파일을 직접 고친 뒤 다시 열어 주세요.</p>
          <pre>{file.raw}</pre>
        </div>
      ) : !script ? (
        <div className="empty">
          <strong>아직 대본이 없어요</strong>
          <span>구간을 직접 하나씩 만들어 볼 수 있어요.</span>
          <button className="btn primary" type="button" onClick={() => file.setData({ version: "1.0", title: project.title, total_duration_seconds: 5, sections: [newPart([])] })}>
            <Plus size={15} /> 직접 만들기
          </button>
        </div>
      ) : (
        <>
          {problems.length > 0 && (
            <ul className="problems error">
              {problems.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="problems warn">
              {warnings.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          )}
          <div className="edit-list">
            {parts.map((part, index) => (
              <article className="edit-row" key={index}>
                <span className="no">{index + 1}</span>
                <div className="edit-body">
                  <div className="edit-line">
                    <label>
                      <span>이름(선택)</span>
                      <input type="text" value={part.label ?? ""} maxLength={60} onChange={(event) => update(index, { label: event.target.value || undefined })} />
                    </label>
                    <label>
                      <span>시작(초)</span>
                      <input type="number" min={0} step={0.5} value={num(part.start_seconds)} onChange={(event) => update(index, { start_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                    <label>
                      <span>끝(초)</span>
                      <input type="number" min={0} step={0.5} value={num(part.end_seconds)} onChange={(event) => update(index, { end_seconds: event.target.value === "" ? NaN : Number(event.target.value) })} />
                    </label>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {part.text.length}자 · 약 {(part.text.length / KOREAN_CHARS_PER_SECOND).toFixed(1)}초
                    </span>
                    <button className="icon-btn danger" type="button" title="구간 지우기" aria-label={`${index + 1}번 구간 지우기`} onClick={() => setParts(parts.filter((_, i) => i !== index))}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <textarea rows={3} value={part.text} placeholder="이 구간에서 읽을 대사를 적어 주세요." onChange={(event) => update(index, { text: event.target.value })} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
