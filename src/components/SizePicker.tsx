import { CUSTOM_SIZE_ID, resolveSize, shapeGap, SIZE_PRESETS } from "../../shared/settings.mjs";
import { FIELDS } from "../fields";
import SettingField from "./SettingField";

interface Props {
  sizeId: string;
  custom: { generate: unknown; final: unknown };
  onSizeId: (id: string) => void;
  onCustom: (which: "generate" | "final", value: unknown) => void;
  errors?: Record<string, string | undefined>;
  /** Shown next to the label, e.g. "기본값 따름" / "이 프로젝트만". */
  badge?: string;
  onReset?: () => void;
}

const GROUPS = [...new Set(SIZE_PRESETS.map((preset) => preset.group))];

/**
 * Video size: pick a preset from the drop-down, or "직접 입력" to type any generate/final size.
 * Controlled; the parent decides when typed values are saved.
 */
export default function SizePicker({ sizeId, custom, onSizeId, onCustom, errors = {}, badge, onReset }: Props) {
  const isCustom = sizeId === CUSTOM_SIZE_ID;
  // resolveSize only needs these two keys, so a minimal settings-shaped object is enough here.
  const size = resolveSize({ defaults: { sizeId, customSize: custom } } as Parameters<typeof resolveSize>[0]);
  const valid = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(n));
  const sizesKnown = valid(size.generate) && valid(size.final);
  const mismatch = sizesKnown && shapeGap(size.generate, size.final) > 0.03;

  return (
    <div className="field">
      <label htmlFor="size-preset">
        영상 크기
        {badge && <span className="tag">{badge}</span>}
        {onReset && (
          <button type="button" className="link" onClick={onReset}>
            기본값으로
          </button>
        )}
      </label>
      <select id="size-preset" value={sizeId} onChange={(event) => onSizeId(event.target.value)}>
        {GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {SIZE_PRESETS.filter((preset) => preset.group === group).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
                {preset.tested ? "" : " · 시험 전"}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="직접">
          <option value={CUSTOM_SIZE_ID}>직접 입력…</option>
        </optgroup>
      </select>

      {isCustom && (
        <div className="size-custom">
          <SettingField field={{ ...FIELDS["defaults.customSize.generate"], hint: undefined }} value={custom.generate} error={errors.generate} onChange={(value) => onCustom("generate", value)} />
          <SettingField field={{ ...FIELDS["defaults.customSize.final"], hint: undefined }} value={custom.final} error={errors.final} onChange={(value) => onCustom("final", value)} />
        </div>
      )}

      {errors.sizeId ? (
        <span className="error">{errors.sizeId}</span>
      ) : (
        sizesKnown && (
          <span className="hint">
            생성 {size.generate.join("×")} → 최종 {size.final.join("×")}
            {mismatch && " · 생성과 최종의 모양이 달라 가장자리가 잘립니다."}
            {!size.tested && !isCustom && " · 이 크기는 아직 시험하지 않았습니다."}
          </span>
        )
      )}
    </div>
  );
}
