import { Check } from "lucide-react";
import type { Stage } from "../api";

export type StepTarget = "scenario" | "storyboard" | "video";

const STEPS: { id: Stage["id"]; label: string; target: StepTarget }[] = [
  { id: "synopsis", label: "줄거리", target: "scenario" },
  { id: "scenario", label: "시나리오", target: "scenario" },
  { id: "script", label: "대본", target: "scenario" },
  { id: "images", label: "이미지", target: "storyboard" },
  { id: "video", label: "영상", target: "video" },
  { id: "final", label: "합성", target: "video" },
];

interface Props {
  stages: Stage[] | null;
  onGo: (target: StepTarget) => void;
}

/** Work steps of the selected project. Done steps come from the files on disk; the first open one is "current". */
export default function WorkSteps({ stages, onGo }: Props) {
  const done = new Map(stages?.map((stage) => [stage.id, stage.done]));
  const currentId = stages ? STEPS.find((step) => !done.get(step.id))?.id : undefined;
  return (
    <ol className="steps" aria-label="작업 단계">
      {STEPS.map((step) => {
        const isDone = done.get(step.id) === true;
        const state = isDone ? "done" : step.id === currentId ? "current" : "todo";
        return (
          <li key={step.id}>
            <button
              type="button"
              className={`step ${state}`}
              disabled={!stages}
              title={isDone ? `${step.label} 완료` : step.id === currentId ? `${step.label}: 지금 할 단계` : step.label}
              aria-current={state === "current" ? "step" : undefined}
              onClick={() => onGo(step.target)}
            >
              {isDone && <Check size={12} />} {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
