import { useTextFile } from "../useFile";

interface LlmCall {
  system: string;
  user: string;
  answer: string;
}

type PromptLogFile = Record<string, { at: string; calls: LlmCall[] } | undefined>;

const ignore = () => undefined;

/** The last prompts sent to the LLM for the given stages (studio/llm_prompts.json), folded away until asked for. `refreshKey` reloads it. */
export default function PromptLog({ projectId, stages, refreshKey = 0 }: { projectId: string; stages: string[]; refreshKey?: number }) {
  const file = useTextFile(projectId, "studio/llm_prompts.json", ignore, refreshKey);
  let log: PromptLogFile = {};
  try {
    log = file.text ? (JSON.parse(file.text) as PromptLogFile) : {};
  } catch {
    log = {};
  }
  const entries = stages.map((stage) => log[stage]).filter((entry) => entry !== undefined);
  if (entries.length === 0) return null;
  const latest = entries.reduce((a, b) => (a.at > b.at ? a : b));

  return (
    <details className="advanced prompt-log">
      <summary>사용한 프롬프트 보기 · {new Date(latest.at).toLocaleString("ko-KR")}</summary>
      {latest.calls.map((call, index) => (
        <div key={index}>
          {latest.calls.length > 1 && <strong className="muted">{index + 1}번째 요청 (앞선 답이 거절되면 다시 묻습니다)</strong>}
          {(
            [
              ["시스템 지침", call.system],
              ["보낸 내용", call.user],
              ["LLM의 답", call.answer],
            ] as const
          ).map(([label, body]) => (
            <label key={label} className="field wide">
              <span>{label}</span>
              <textarea readOnly rows={Math.min(14, Math.max(3, body.split("\n").length))} value={body} />
            </label>
          ))}
        </div>
      ))}
    </details>
  );
}
