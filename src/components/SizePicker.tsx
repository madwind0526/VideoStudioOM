import { ASPECTS, CUSTOM_SIZE_ID, resolveSize, SIZE_MEGAPIXELS } from "../../shared/settings.mjs";
import { FIELDS } from "../fields";
import SettingField from "./SettingField";

interface Props {
  megapixels: number;
  aspect: string;
  orientation: string;
  custom: { generate: unknown };
  onMegapixels: (value: number) => void;
  onAspect: (id: string) => void;
  onOrientation: (value: string) => void;
  onCustom: (value: unknown) => void;
  errors?: Record<string, string | undefined>;
}

/**
 * Video size (the size the model renders): a pixel budget (0.5M ... 4M), one aspect ratio and wide or tall; the width and height follow from them.
 * "직접 입력" in the ratio list lets the size be typed instead. Controlled; the parent decides when typed values are saved.
 */
export default function SizePicker({ megapixels, aspect, orientation, custom, onMegapixels, onAspect, onOrientation, onCustom, errors = {} }: Props) {
  const isCustom = aspect === CUSTOM_SIZE_ID;
  const isSquare = aspect === "1x1";
  // resolveSize only needs these keys, so a minimal settings-shaped object is enough here.
  const sizeOf = (mp: number) => resolveSize({ defaults: { sizeMegapixels: mp, aspect, orientation, customSize: custom } } as Parameters<typeof resolveSize>[0]);
  const size = sizeOf(megapixels);
  const valid = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(n));
  const sizesKnown = valid(size.generate);

  return (
    <div className="field">
      <div className="size-row">
        <div className="field">
          <label htmlFor="size-mp">영상 크기</label>
          <select id="size-mp" value={megapixels} disabled={isCustom} onChange={(event) => onMegapixels(Number(event.target.value))}>
            {SIZE_MEGAPIXELS.map((mp) => {
              const [width, height] = sizeOf(mp).generate;
              return (
                <option key={mp} value={mp}>
                  {isCustom ? `${mp}M` : `${mp}M (${width}×${height})`}
                </option>
              );
            })}
          </select>
        </div>
        <div className="field">
          <label htmlFor="size-aspect">비율</label>
          <select id="size-aspect" value={aspect} onChange={(event) => onAspect(event.target.value)}>
            {ASPECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            <option value={CUSTOM_SIZE_ID}>직접 입력…</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="size-orientation">방향</label>
          <select id="size-orientation" value={orientation} disabled={isCustom || isSquare} onChange={(event) => onOrientation(event.target.value)}>
            <option value="landscape">가로</option>
            <option value="portrait">세로</option>
          </select>
        </div>
      </div>

      {isCustom && (
        <div className="size-custom">
          <SettingField field={{ ...FIELDS["defaults.customSize.generate"], hint: undefined }} value={custom.generate} error={errors.generate} onChange={onCustom} />
        </div>
      )}

      {errors.size ? (
        <span className="error">{errors.size}</span>
      ) : (
        sizesKnown && (
          <span className="hint">생성 크기 {size.generate.join("×")}</span>
        )
      )}
    </div>
  );
}
