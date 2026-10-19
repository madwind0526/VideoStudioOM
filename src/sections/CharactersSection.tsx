import { Plus, RotateCcw, Save, Trash2, UserRound, Wand2 } from "lucide-react";
import { useState } from "react";
import { mediaUrl } from "../api";
import { BIBLE_FILE, emptyBible, sheetPath, type Bible, type Character } from "../bible";
import Lightbox from "../components/Lightbox";
import { useJsonFile } from "../useFile";
import { deleteMedia, makeItem, makePrompt, startItems } from "./mediaJobs";
import type { SectionProps } from "./types";

const nextId = (characters: Character[]) => {
  let n = characters.length + 1;
  while (characters.some((character) => character.id === `c${n}`)) n += 1;
  return `c${n}`;
};

/**
 * The people of the video. Every character gets a description and her or his own character sheet (one image with the
 * person from the front, the side and the back plus face close-ups). Videos then take the sheets as reference pictures,
 * so each person looks the same in every scene. The look of the whole video and its places are kept here too.
 */
export default function CharactersSection({ project, detail, view, jobs, onJobsChanged, onChanged, notify }: SectionProps) {
  const file = useJsonFile<Bible>(project.id, BIBLE_FILE, notify);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState<string | null>(null);
  const bible = file.data;
  const images = detail?.media.images ?? [];
  const running = jobs.current !== null;
  const set = (patch: Partial<Bible>) => bible && file.setData({ ...bible, ...patch });
  const update = (index: number, patch: Partial<Character>) => bible && set({ characters: bible.characters.map((character, i) => (i === index ? { ...character, ...patch } : character)) });

  async function save() {
    if (await file.save()) onChanged();
  }

  /** The prompt maker writes a sheet prompt from the description; the image goes to assets/images/sheet-<id>.png. */
  async function makeSheet(character: Character) {
    if (!view) return;
    const idea = `${character.name}: ${character.description}`.trim();
    if (!character.description.trim()) return notify("먼저 인물을 설명해 주세요. 나이, 얼굴, 머리, 옷차림을 적을수록 좋아요.");
    setMaking(character.id);
    try {
      // The style of the whole video is part of the bible; the server adds it.
      const prompt = await makePrompt(project.id, { target: "sheet", text: idea }).catch(() => idea);
      const item = makeItem(view.effective, { kind: "sheet", prompt, idea, source: character.id }, sheetPath(character));
      if (typeof item === "string") return notify(item);
      await startItems(project.id, [item]);
      notify(`${character.name || "인물"}의 캐릭터 시트를 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "시트를 만들지 못했습니다.");
    } finally {
      setMaking(null);
    }
  }

  async function removeSheet(character: Character) {
    try {
      await deleteMedia(project.id, sheetPath(character));
      onJobsChanged();
    } catch {
      notify("시트를 지우지 못했습니다.");
    }
  }

  return (
    <div className="section">
      <div className="section-head">
        <h2>
          등장인물<span className="count">{bible?.characters.length ?? 0}</span>
        </h2>
        {bible && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" type="button" onClick={() => set({ characters: [...bible.characters, { id: nextId(bible.characters), name: "", description: "" }] })}>
              <Plus size={15} /> 인물 추가
            </button>
            <button className="btn" type="button" disabled={!file.dirty} onClick={file.revert}>
              <RotateCcw size={15} /> 되돌리기
            </button>
            <button className="btn primary" type="button" disabled={!file.dirty || file.saving} onClick={() => void save()}>
              <Save size={15} /> 저장
            </button>
          </div>
        )}
      </div>
      <p className="muted section-note">
        인물마다 캐릭터 시트를 먼저 만들어 두면, 영상을 만들 때 시트를 참조 그림으로 넣어 장면이 바뀌어도 같은 얼굴과 옷차림을 유지합니다. 인물이 여럿이면 각자 시트가 필요해요. 장면 설명에 인물 이름이 들어 있으면 그 인물의 시트가 자동으로 쓰입니다.
      </p>

      {!file.ready ? (
        <p className="muted">불러오는 중...</p>
      ) : file.invalid ? (
        <div className="textblock">
          <p className="error">bible.json을 읽을 수 없습니다(JSON 형식 오류). 파일을 직접 고친 뒤 다시 열어 주세요.</p>
          <pre>{file.raw}</pre>
        </div>
      ) : !bible ? (
        <div className="empty">
          <div className="tile">
            <UserRound size={28} />
          </div>
          <strong>아직 등장인물이 없습니다</strong>
          <button className="btn primary" type="button" onClick={() => file.setData({ ...emptyBible(), characters: [{ id: "c1", name: "", description: "" }] })}>
            <Plus size={15} /> 인물 추가
          </button>
        </div>
      ) : (
        <>
          <div className="gen-card" style={{ maxWidth: 900 }}>
            <label className="field wide">
              <span>영상 전체의 화풍 (선택)</span>
              <textarea rows={2} value={bible.style} maxLength={500} placeholder="예: 따뜻한 필름 느낌의 실사, 부드러운 자연광" onChange={(event) => set({ style: event.target.value })} />
              <span className="hint">모든 이미지와 영상 프롬프트에 그대로 들어갑니다.</span>
            </label>
          </div>

          <div className="edit-list">
            {bible.characters.map((character, index) => {
              const sheet = images.find((image) => image.path === sheetPath(character));
              const busy = making === character.id;
              return (
                <article className="edit-row" key={character.id}>
                  <span className="no">{index + 1}</span>
                  <div className="edit-body">
                    <div className="edit-line">
                      <label>
                        <span>이름 (장면 설명에 쓰는 이름 그대로)</span>
                        <input type="text" value={character.name} maxLength={60} onChange={(event) => update(index, { name: event.target.value })} />
                      </label>
                      <button className="icon-btn danger" type="button" title="인물 지우기" aria-label={`${character.name || index + 1}번 인물 지우기`} onClick={() => bible && set({ characters: bible.characters.filter((_, i) => i !== index) })}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <textarea rows={3} value={character.description} maxLength={1500} placeholder="나이, 체격, 얼굴, 머리, 한 벌의 옷차림(색과 소재)을 구체적으로 적어 주세요. 이 글이 모든 프롬프트에 그대로 들어갑니다." onChange={(event) => update(index, { description: event.target.value })} />
                    <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                      {sheet ? (
                        <button type="button" className="sheet-thumb" onClick={() => setOpen(sheet.path)} title="크게 보기">
                          <img src={mediaUrl(project.id, sheet.path, sheet.mtimeMs)} alt={`${character.name} 캐릭터 시트`} loading="lazy" />
                        </button>
                      ) : (
                        <div className="sheet-thumb empty">시트 없음</div>
                      )}
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn primary" type="button" disabled={busy || running || file.dirty} title={file.dirty ? "먼저 저장하세요." : running ? "다른 작업이 끝난 뒤에 할 수 있습니다." : undefined} onClick={() => void makeSheet(character)}>
                          <Wand2 size={15} /> {busy ? "프롬프트 만드는 중..." : sheet ? "시트 다시 만들기" : "캐릭터 시트 만들기"}
                        </button>
                        {sheet && (
                          <button className="btn" type="button" onClick={() => void removeSheet(character)}>
                            <Trash2 size={15} /> 시트 지우기
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <h3 className="sub-head">장소 (선택)</h3>
          <div className="edit-list">
            {bible.places.map((place, index) => (
              <article className="edit-row" key={index}>
                <div className="edit-body">
                  <div className="edit-line">
                    <label>
                      <span>장소 이름</span>
                      <input type="text" value={place.name} maxLength={60} onChange={(event) => set({ places: bible.places.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)) })} />
                    </label>
                    <button className="icon-btn danger" type="button" title="장소 지우기" aria-label="장소 지우기" onClick={() => set({ places: bible.places.filter((_, i) => i !== index) })}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <textarea rows={2} value={place.description} maxLength={1000} placeholder="벽, 조명, 소품을 구체적으로 적어 주세요. 장면 설명에 장소 이름이 있으면 그대로 프롬프트에 들어갑니다." onChange={(event) => set({ places: bible.places.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)) })} />
                </div>
              </article>
            ))}
            <div>
              <button className="btn" type="button" onClick={() => set({ places: [...bible.places, { name: "", description: "" }] })}>
                <Plus size={15} /> 장소 추가
              </button>
            </div>
          </div>
        </>
      )}
      {open && <Lightbox src={mediaUrl(project.id, open, images.find((image) => image.path === open)?.mtimeMs)} alt={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
