import { useState } from "react";
import { ASPECTS, resolveSize } from "../shared/settings.mjs";

/** The size of the pictures made in the image menu: a pixel budget, an aspect ratio and wide or tall, as for videos. */
export interface ImageSize {
  megapixels: number;
  aspect: string;
  orientation: string;
  custom: { generate: unknown };
}

export function useImageSize() {
  const [value, setValue] = useState<ImageSize>({ megapixels: 1, aspect: ASPECTS[0].id, orientation: "landscape", custom: { generate: [1024, 1024] } });
  const { generate } = resolveSize({ defaults: { sizeMegapixels: value.megapixels, aspect: value.aspect, orientation: value.orientation, customSize: value.custom } } as Parameters<typeof resolveSize>[0]);
  return { value, setValue, size: generate as [number, number] };
}

/** Ratios a prompt may name, wide side first; anything else is matched to the nearest ASPECTS entry. */
const NAMED_RATIOS = new Set(["16:9", "21:9", "4:3", "5:4", "1:1", "3:2"]);

/**
 * The size a library prompt is made at: 1 MP, the ratio the prompt names ("--ar 3:2", "aspect ratio 16:9", "9:16"), else 4:3
 * (3:4 when the prompt reads like a portrait).
 */
const RATIO_PATTERN = /(\d{1,2})\s*[:x×]\s*(\d{1,2})/gi;

/** The ratio a prompt names ("--ar 3:2", "aspect ratio 16:9", "9:16"), if it names a usual one. */
function namedRatio(prompt: string): [number, number] | null {
  for (const match of prompt.matchAll(RATIO_PATTERN)) {
    const [w, h] = [Number(match[1]), Number(match[2])];
    if (NAMED_RATIOS.has(`${Math.max(w, h)}:${Math.min(w, h)}`)) return [w, h];
  }
  return null;
}

export const namesRatio = (prompt: string) => namedRatio(prompt) !== null;

export function sizeFromPrompt(prompt: string): ImageSize {
  const ratio = namedRatio(prompt);
  const tall = ratio ? ratio[1] > ratio[0] : /portrait|vertical|full[- ]body|standing|세로/i.test(prompt);
  const wide = ratio ? Math.max(...ratio) / Math.min(...ratio) : 4 / 3;
  const aspect = ASPECTS.reduce((best, item) => (Math.abs(item.w / item.h - wide) < Math.abs(best.w / best.h - wide) ? item : best));
  return { megapixels: 1, aspect: aspect.id, orientation: tall ? "portrait" : "landscape", custom: { generate: [1024, 1024] } };
}
