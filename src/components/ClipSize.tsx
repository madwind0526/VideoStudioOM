import { useState, type ReactNode } from "react";
import type { Settings } from "../api";
import SizePicker from "./SizePicker";

interface SizeChoice {
  megapixels: number;
  aspect: string;
  orientation: string;
  custom: unknown;
}

/** The size of one clip: starts from the video size of the settings and can be changed for this clip only. */
export function useClipSize(settings: Settings | undefined) {
  const [own, setOwn] = useState<SizeChoice | null>(null);
  const base: SizeChoice | null = settings ? { megapixels: settings.defaults.sizeMegapixels, aspect: settings.defaults.aspect, orientation: settings.defaults.orientation, custom: settings.defaults.customSize.generate } : null;
  const size = own ?? base;
  /** The settings with the size of this clip in place of the video size of the settings. */
  const apply = (current: Settings): Settings =>
    own
      ? ({ ...current, defaults: { ...current.defaults, sizeMegapixels: own.megapixels, aspect: own.aspect, orientation: own.orientation, customSize: { ...current.defaults.customSize, generate: own.custom } } } as Settings)
      : current;
  return { size, setSize: setOwn, apply };
}

/** The size fields; `children` (the length) go on the same row, four equal columns. */
export default function ClipSize({ size, onChange, children }: { size: SizeChoice | null; onChange: (size: SizeChoice) => void; children?: ReactNode }) {
  if (!size) return null;
  return (
    <div className="field wide">
      <SizePicker
        megapixels={size.megapixels}
        aspect={size.aspect}
        orientation={size.orientation}
        custom={{ generate: size.custom }}
        label="크기"
        onMegapixels={(megapixels) => onChange({ ...size, megapixels })}
        onAspect={(aspect) => onChange({ ...size, aspect })}
        onOrientation={(orientation) => onChange({ ...size, orientation })}
        onCustom={(custom) => onChange({ ...size, custom })}
      >
        {children}
      </SizePicker>
    </div>
  );
}
