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
