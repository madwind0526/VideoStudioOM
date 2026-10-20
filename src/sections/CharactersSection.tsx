import { ImagePlus, Plus, RotateCcw, Save, Trash2, UserRound, Wand2, X } from "lucide-react";
import { useState } from "react";
import { DIRECTION_PRESETS } from "../../shared/presets.mjs";
import { ApiError, mediaUrl } from "../api";
import { BIBLE_FILE, emptyBible, sheetPath, type Bible, type Character } from "../bible";
import FileNavigator from "../components/FileNavigator";
import Lightbox from "../components/Lightbox";
import { storyApi } from "../story";
import { useJsonFile } from "../useFile";
import { deleteMedia, importImage, makeItem, makePrompt, startItems } from "./mediaJobs";
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
  const [extracting, setExtracting] = useState(false);
  // The character that is getting a picture from this PC (the file browser is open).
  const [importing, setImporting] = useState<number | null>(null);
  const bible = file.data;
  const images = detail?.media.images ?? [];
  const running = jobs.current !== null;
  const set = (patch: Partial<Bible>) => bible && file.setData({ ...bible, ...patch });
  const update = (index: number, patch: Partial<Character>) => bible && set({ characters: bible.characters.map((character, i) => (i === index ? { ...character, ...patch } : character)) });

  async function save() {
    if (await file.save()) onChanged();
  }

  /** The LLM reads the saved synopsis and drafts the style, the people and the places (English descriptions, so prompts stay identical). */
  async function extract() {
    setExtracting(true);
    try {
      const drafted = await storyApi.bible(project.id);
      file.setData({ ...emptyBible(), ...(bible ?? {}), style: drafted.style, characters: drafted.characters, places: drafted.places });
      notify(`인물 ${drafted.characters.length}명, 장소 ${drafted.places.length}곳을 뽑았습니다. 확인하고 저장하세요.`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : "인물을 뽑지 못했습니다.");
    } finally {
      setExtracting(false);
    }
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
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="button" disabled={extracting} onClick={() => void extract()}>
              <Wand2 size={15} /> {extracting ? "뽑는 중..." : "줄거리에서 인물·장소 뽑기"}
            </button>
            <button className="btn" type="button" onClick={() => file.setData({ ...emptyBible(), characters: [{ id: "c1", name: "", description: "" }] })}>
              <Plus size={15} /> 직접 추가
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="gen-card" style={{ maxWidth: 900 }}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <button className="btn" type="button" disabled={extracting || file.dirty} title={file.dirty ? "먼저 저장하세요." : "저장된 줄거리에서 다시 뽑습니다. 지금 적은 인물은 바뀝니다."} onClick={() => void extract()}>
                <Wand2 size={15} /> {extracting ? "뽑는 중..." : "줄거리에서 인물·장소 다시 뽑기"}
              </button>
            </div>
            <label className="field">
              <span>연출 스타일 (영상 전체)</span>
              <select value={bible.preset ?? ""} onChange={(event) => set({ preset: event.target.value })}>
                <option value="">(정하지 않음)</option>
                {DIRECTION_PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="hint">촬영과 이야기 방식을 정하는 문구가 모든 프롬프트에 들어갑니다.</span>
            </label>
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
                    <div className="field wide">
                      <span className="hint">참고 사진 (실제 인물이나 설계한 얼굴 사진: 시트와 함께 영상의 참조로 쓰입니다)</span>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        {(character.photos ?? []).map((photo) => (
                          <span key={photo} className="photo-chip">
                            <img src={mediaUrl(project.id, photo, images.find((image) => image.path === photo)?.mtimeMs)} alt="" />
                            <button type="button" aria-label="사진 빼기" title="이 인물에서 빼기 (파일은 그대로)" onClick={() => update(index, { photos: (character.photos ?? []).filter((item) => item !== photo) })}>
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        <button className="btn" type="button" disabled={(character.photos ?? []).length >= 4} onClick={() => setImporting(index)}>
                          <ImagePlus size={15} /> 내 사진 가져오기
                        </button>
                        <select
                          aria-label="이미지에서 고르기"
                          value=""
                          onChange={(event) => event.target.value && update(index, { photos: [...(character.photos ?? []), event.target.value].slice(0, 4) })}
                        >
                          <option value="">프로젝트 이미지에서 고르기</option>
                          {images
                            .filter((image) => !image.path.includes("/sheet-") && !(character.photos ?? []).includes(image.path))
                            .map((image) => (
                              <option key={image.path} value={image.path}>
                                {image.path.replace("assets/images/", "")}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                    <div className="field wide">
                      <span className="hint">다른 옷차림 (장면 설명에 옷차림 이름을 쓰면 그 장면만 이 옷으로, 얼굴과 머리는 그대로)</span>
                      {(character.outfits ?? []).map((outfit, outfitIndex) => (
                        <div className="row" style={{ gap: 8, marginBottom: 6 }} key={outfitIndex}>
                          <input type="text" aria-label="옷차림 이름" value={outfit.name} maxLength={30} placeholder="이름 (예: 수영복)" style={{ width: 140 }} onChange={(event) => update(index, { outfits: (character.outfits ?? []).map((item, i) => (i === outfitIndex ? { ...item, name: event.target.value } : item)) })} />
                          <input type="text" aria-label="옷차림 설명" value={outfit.description} maxLength={400} placeholder="영어로: a navy one-piece swimsuit ..." style={{ flex: 1 }} onChange={(event) => update(index, { outfits: (character.outfits ?? []).map((item, i) => (i === outfitIndex ? { ...item, description: event.target.value } : item)) })} />
                          <button className="icon-btn" type="button" aria-label="옷차림 지우기" onClick={() => update(index, { outfits: (character.outfits ?? []).filter((_, i) => i !== outfitIndex) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <div>
                        <button className="btn" type="button" disabled={(character.outfits ?? []).length >= 6} onClick={() => update(index, { outfits: [...(character.outfits ?? []), { name: "", description: "" }] })}>
                          <Plus size={15} /> 옷차림 추가
                        </button>
                      </div>
                    </div>
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
      {importing !== null && (
        <FileNavigator
          title="사진 가져오기"
          accept={[".png", ".jpg", ".jpeg", ".webp"]}
          onClose={() => setImporting(null)}
          onPick={(from) => {
            const target = importing;
            setImporting(null);
            importImage(project.id, from)
              .then((path) => {
                if (bible) update(target, { photos: [...(bible.characters[target].photos ?? []), path].slice(0, 4) });
                onJobsChanged();
              })
              .catch((e) => notify(e instanceof ApiError ? e.message : "사진을 가져오지 못했습니다."));
          }}
        />
      )}
      {open && <Lightbox src={mediaUrl(project.id, open, images.find((image) => image.path === open)?.mtimeMs)} alt={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
