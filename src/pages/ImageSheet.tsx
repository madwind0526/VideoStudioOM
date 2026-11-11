import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, type MediaFile } from "../api";
import { ascending } from "../sortOptions";
import ImageSlot from "../components/ImageSlot";
import type { Favorites, SortOrder } from "../components/LibraryBrowser";
import { samplingInputs, useModelChoice } from "../components/ModelPicker";
import SizePicker from "../components/SizePicker";
import { CUSTOM_SIZE_ID, resolveSize } from "../../shared/settings.mjs";
import { SHEET_TYPES } from "../../shared/sheetPrompts.mjs";
import type { ImageSize } from "../imageSizes";
import { startItems, stamp, type MakeItem } from "../sections/mediaJobs";
import type { SectionProps } from "../sections/types";

type Way = "model" | "h3";

/** How the sheet prompts name the reference picture; replaced by the wording of the chosen model. */
const REF = "the attached reference photo";

/** Models that can draw a sheet from a reference picture: the edit models (Qwen Image Edit, Krea 2 Identity, Flux.2 klein), not the ControlNets. */
const CAN_DRAW_SHEET = (model: { tool: string; input?: unknown }) => (model.tool === "comfyui_edit_model" || model.tool === "comfyui_image_edit") && !(model.input as { control?: string } | undefined)?.control;

/** The size a sheet type starts with: the shape its layout was written for, as typed-in numbers (the lists still work). */
const sheetSize = (type: { size: number[] }): ImageSize => ({ megapixels: 1, aspect: CUSTOM_SIZE_ID, orientation: "landscape", custom: { generate: type.size } });

/** Character sheet: one picture of a character in, a sheet of the same character out. */
export default function ImageSheet({ props, images, favorites, order, onOrder }: { props: SectionProps; images: MediaFile[]; favorites: Favorites; order: SortOrder; onOrder: (order: SortOrder) => void }) {
  const { project, jobs, notify, onJobsChanged } = props;
  const model = useModelChoice("r2i", CAN_DRAW_SHEET);
  const [way, setWay] = useState<Way>("model");
  const [type, setType] = useState(SHEET_TYPES[0].id);
  const [source, setSource] = useState<string[]>([]);
  const [style, setStyle] = useState("");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sheet = SHEET_TYPES.find((item) => item.id === type) ?? SHEET_TYPES[0];
  // The prompt of the chosen sheet, open to edits (the profile sheet has [fields] to fill in); the wording for the picture is put in when making.
  const [text, setText] = useState(sheet.text);
  useEffect(() => setText(sheet.text), [sheet]);
  const [sizeValue, setSizeValue] = useState<ImageSize>(() => sheetSize(SHEET_TYPES[0]));
  useEffect(() => setSizeValue(sheetSize(sheet)), [sheet]);
  const chosen = resolveSize({ defaults: { sizeMegapixels: sizeValue.megapixels, aspect: sizeValue.aspect, orientation: sizeValue.orientation, customSize: sizeValue.custom } } as Parameters<typeof resolveSize>[0]).generate as unknown;

  async function make() {
    setError("");
    if (!source[0]) return setError("캐릭터 그림을 고르세요.");
    const number = Number(count);
    if (!Number.isInteger(number) || number < 1 || number > (way === "h3" ? 6 : 12)) return setError(`장수는 1~${way === "h3" ? 6 : 12} 사이로 입력하세요.`);
    const id = stamp();
    const file = (index: number) => `assets/images/sheet-${id}-${String(index + 1).padStart(2, "0")}.png`;
    let items: MakeItem[];
    if (way === "h3") {
      items = Array.from({ length: number }, (_, index) => ({
        tool: "h3_character_sheet",
        label: "캐릭터 시트 (H3 컷 전환)",
        record: { kind: "image", prompt: style.trim() || "캐릭터 시트 (H3 컷 전환)", sheetFrom: source[0] } as never,
        inputs: { reference_image_path: source[0], style: style.trim(), output_path: file(index) },
      }));
    } else {
      if (!Array.isArray(chosen) || chosen.length !== 2 || !chosen.every((value) => Number.isFinite(value) && value >= 256)) return setError("이미지 크기를 확인하세요 (가로·세로 256 이상).");
      const [width, height] = chosen as [number, number];
      const blankCanvas = model.tool === "comfyui_image_edit";
      // Qwen Image Edit draws a new picture on an empty canvas (<image1>) with the reference as <image2>; the other models edit the first picture.
      const prompt = blankCanvas ? `Fill <image1> with a completely new picture. ${text.replaceAll(REF, "<image2>")}` : text.replaceAll(REF, "the first picture");
      items = Array.from({ length: number }, (_, index) => ({
        tool: model.tool,
        label: sheet.title,
        record: { kind: "image", prompt, idea: sheet.title, editFrom: [source[0]], imageModel: model.id, sheetType: sheet.id, ...(Object.keys(model.sampling).length ? { sampling: model.sampling } : {}) } as never,
        inputs: blankCanvas
          ? { prompt, blank_canvas: true, reference_image_paths: [source[0]], width, height, ...samplingInputs(model, index), output_path: file(index) }
          : { prompt, reference_image_path: source[0], reference_image_paths: [], width, height, ...samplingInputs(model, index), output_path: file(index) },
      }));
    }
    setBusy(true);
    try {
      await startItems(project.id, items);
      notify(`캐릭터 시트 ${number}장을 차례로 만듭니다.`);
      onJobsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "작업을 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const running = jobs.current !== null;
  return (
    <section className="gen-card">
      <h3>캐릭터 시트</h3>
      <span className="hint">캐릭터 그림 한 장으로 같은 인물의 시트를 만듭니다. 결과는 이미지 보관함에 저장됩니다.</span>
      <div className="row" style={{ gap: 8, margin: "10px 0" }} role="group" aria-label="만드는 방식">
        <button className={`btn${way === "model" ? " primary" : ""}`} type="button" aria-pressed={way === "model"} onClick={() => setWay("model")} title="이미지 모델이 시트 한 장을 한 번에 그립니다 (얼굴 + 좌·정·후, 카메라 뷰, 머리 모양, 감정, 프로필).">
          이미지 모델로 시트 그리기
        </button>
        <button className={`btn${way === "h3" ? " primary" : ""}`} type="button" aria-pressed={way === "h3"} onClick={() => setWay("h3")} title="MiniMax H3 영상으로 여러 각도를 만들고 장면을 뽑아 시트로 모읍니다.">
          다각도 사진 (H3 컷 전환)
        </button>
      </div>
      {way === "model" ? (
        <>
          <div className="field" style={{ marginTop: 6 }}>
            <label htmlFor="sheet-type">1. 시트 종류 (프롬프트)</label>
            <select id="sheet-type" value={type} onChange={(event) => setType(event.target.value)}>
              {ascending(SHEET_TYPES, (item) => item.label).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="hint">{sheet.note}</span>
          </div>
          <div className="field wide" style={{ marginTop: 10 }}>
            <label htmlFor="sheet-prompt">프롬프트 (직접 고칠 수 있습니다)</label>
            <textarea id="sheet-prompt" rows={7} value={text} maxLength={7000} onChange={(event) => setText(event.target.value)} />
            <span className="hint">"the attached reference photo"는 고른 모델에 맞게 자동으로 바뀌어 들어갑니다. 같은 프롬프트가 프롬프트 라이브러리(이미지-API)에도 있습니다.</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 12, color: "var(--muted-fg)" }}>2. 모델</label>
            {model.picker}
          </div>
        </>
      ) : (
        <span className="hint">8컷(뒷모습, 좌우 옆모습, 3/4 3컷, 얼굴 정면과 옆모습)과 원본을 3열 시트로 만듭니다. 한 장에 1~2분 걸립니다.</span>
      )}
      <ImageSlot props={props} images={images} favorites={favorites} order={order} onOrder={onOrder} label={way === "model" ? "3. 입력 그림 (얼굴이 잘 보이는 캐릭터 그림)" : "1. 캐릭터 그림 (얼굴이 잘 보이는 그림)"} value={source} max={1} onChange={setSource} />
      <div className="fields" style={{ marginTop: 14 }}>
        {way === "h3" && (
          <div className="field wide">
            <label htmlFor="sheet-style">2. 화풍 (선택, 영어)</label>
            <input id="sheet-style" type="text" value={style} maxLength={400} onChange={(event) => setStyle(event.target.value)} placeholder="예: flat 2D anime, crisp lineart, cel shading" />
            <span className="hint">비워 두면 그림의 화풍을 그대로 따릅니다.</span>
          </div>
        )}
        {way === "model" ? (
          <div className="field wide">
            <SizePicker
              label="이미지 크기"
              megapixels={sizeValue.megapixels}
              aspect={sizeValue.aspect}
              orientation={sizeValue.orientation}
              custom={sizeValue.custom}
              onMegapixels={(megapixels) => setSizeValue((current) => ({ ...current, megapixels }))}
              onAspect={(aspect) => setSizeValue((current) => ({ ...current, aspect }))}
              onOrientation={(orientation) => setSizeValue((current) => ({ ...current, orientation }))}
              onCustom={(custom) => setSizeValue((current) => ({ ...current, custom: { generate: custom } }))}
            >
              <div className="field">
                <label htmlFor="sheet-count">장수</label>
                <input id="sheet-count" type="number" min={1} max={12} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
              </div>
            </SizePicker>
            <span className="hint">처음 값은 시트 종류의 칸 배치에 맞춘 크기(직접 입력)입니다. 비율을 바꾸면 칸 배치가 달라지거나 일부 칸이 빠질 수 있으니 같은 비율로 키우거나 줄이는 것을 권합니다.</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="sheet-count">장수</label>
            <input id="sheet-count" type="number" min={1} max={6} step={1} value={count} onChange={(event) => setCount(event.target.value)} />
          </div>
        )}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" type="button" disabled={busy || running} onClick={() => void make()} title={running ? "다른 작업이 끝난 뒤에 시작할 수 있습니다." : undefined}>
          <Sparkles size={16} /> {running ? "다른 작업 진행 중" : "시트 만들기"}
        </button>
      </div>
    </section>
  );
}
