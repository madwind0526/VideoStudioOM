import { Dices, FileText, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { parsePromptFile } from "../../shared/promptFile.mjs";
import { api, ApiError } from "../api";
import FileNavigator from "../components/FileNavigator";

/** The prompts of the last file that was loaded stay for the rest of the session, so the pop-up does not ask for the file again. */
let remembered: { name: string; prompts: string[] } | null = null;
/** The file that was loaded last: the file browser opens next to it. */
let lastFile = "";

const SHOWN = 100;
/** A prompt of the list is shown up to this many characters, then "..."; the whole text is in the tooltip. */
const LIST_CHARS = 220;
const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);

/**
 * Pop-up of the make screen: load a prompt file (see shared/promptFile.mjs), pick one of its prompts (by hand or at random) and save it.
 * The make screen then makes the number of pictures it is set to from this one prompt.
 */
export default function PromptPick({ onSave, onClose }: { onSave: (prompts: string[]) => void; onClose: () => void }) {
  const [file, setFile] = useState(remembered);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(-1);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const prompts = file?.prompts ?? [];
  const needle = query.trim().toLowerCase();
  // Indexes into `prompts`, so a pick survives a change of the search.
  const matching = useMemo(() => prompts.map((_, index) => index).filter((index) => !needle || prompts[index].toLowerCase().includes(needle)), [prompts, needle]);

  async function load(path: string) {
    setError("");
    let read: { name: string; text: string };
    try {
      read = await api<{ name: string; text: string }>("GET", `/api/fs/text?path=${encodeURIComponent(path)}`);
    } catch (e) {
      return setError(e instanceof ApiError ? e.message : "파일을 읽지 못했습니다.");
    }
    const list = parsePromptFile(read.text, read.name) as string[];
    if (list.length === 0) return setError("프롬프트를 찾지 못했습니다. 프롬프트를 ----- 줄로 나눈 텍스트 파일이나 프롬프트 목록 JSON 파일을 고르세요.");
    lastFile = path;
    remembered = { name: read.name, prompts: list };
    setFile(remembered);
    setQuery("");
    setChosen(-1);
    setText("");
  }

  const choose = (index: number) => {
    setChosen(index);
    setText(prompts[index] ?? "");
  };
  const random = () => {
    if (matching.length === 0) return setError("조건에 맞는 프롬프트가 없습니다.");
    setError("");
    choose(matching[Math.floor(Math.random() * matching.length)]);
  };

  return (
    <div className="backdrop" style={{ zIndex: 60 }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(900px, 100%)" }} role="dialog" aria-modal="true" aria-label="프롬프트에서 골라서 만들기">
        <div className="modal-head">
          <h2>프롬프트에서 임의로 골라서 만들기</h2>
          <button className="icon-btn" type="button" title="닫기" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <span className="hint">프롬프트가 들어 있는 파일을 불러와 그중 하나를 고릅니다. 저장하면 이 프롬프트로 이미지 생성 화면에 설정한 장수만큼 만들 수 있습니다(장마다 시드가 다릅니다).</span>
          <div className="row" style={{ gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => setBrowsing(true)} title="프롬프트를 ----- 줄로 나눈 텍스트(.txt, .md) 또는 프롬프트 목록 JSON(.json) 파일">
              <FileText size={15} /> {file ? "다른 프롬프트 파일 불러오기" : "프롬프트 파일 불러오기"}
            </button>
            {file && (
              <span className="hint">
                {file.name} · 프롬프트 {file.prompts.length.toLocaleString()}개
              </span>
            )}
          </div>

          {file && (
            <>
              <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
                <input type="text" aria-label="프롬프트 검색" placeholder="프롬프트 검색" value={query} onChange={(event) => setQuery(event.target.value)} style={{ flex: 1, minWidth: 0 }} />
                <button className="btn" type="button" onClick={random} title="검색된 프롬프트 중에서 무작위로 하나를 고릅니다.">
                  <Dices size={15} /> 임의로 고르기
                </button>
              </div>
              <span className="hint" style={{ display: "block", marginTop: 6 }}>
                {matching.length.toLocaleString()}개{matching.length > SHOWN ? ` 중 앞의 ${SHOWN}개를 보여 줍니다. 검색으로 좁히거나 "임의로 고르기"를 누르세요.` : ""}
              </span>
              <div role="listbox" aria-label="프롬프트 목록" style={{ marginTop: 6, maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                {matching.slice(0, SHOWN).map((index) => (
                  <button
                    key={index}
                    type="button"
                    role="option"
                    aria-selected={index === chosen}
                    title={prompts[index]}
                    onClick={() => choose(index)}
                    style={{ width: "100%", padding: "8px 12px", border: 0, borderBottom: "1px solid var(--border)", background: index === chosen ? "rgba(47, 158, 126, 0.25)" : "transparent", color: "inherit", textAlign: "left", cursor: "pointer", fontSize: 12, lineHeight: 1.5, }}
                  >
                    <span style={{ opacity: 0.6 }}>{index + 1}. </span>
                    {shorten(prompts[index], LIST_CHARS)}
                  </button>
                ))}
              </div>
              <div className="field wide" style={{ marginTop: 12 }}>
                <label htmlFor="pick-text">고른 프롬프트 (고칠 수 있습니다)</label>
                <textarea id="pick-text" rows={6} value={text} maxLength={7000} placeholder="위 목록에서 프롬프트를 누르거나 '임의로 고르기'를 누르세요." onChange={(event) => setText(event.target.value)} />
              </div>
            </>
          )}
          {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        </div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" type="button" disabled={!text.trim()} title={!text.trim() ? "먼저 프롬프트를 고르세요." : undefined} onClick={() => onSave([text.trim()])}>
            <Save size={15} /> 저장
          </button>
        </div>
      </div>
      {browsing && (
        <FileNavigator
          title="프롬프트 파일 불러오기"
          accept={[".txt", ".md", ".json"]}
          start={lastFile || undefined}
          onClose={() => setBrowsing(false)}
          onPick={(path) => {
            setBrowsing(false);
            void load(path);
          }}
        />
      )}
    </div>
  );
}
