/** Sizes offered by the image menu (Krea 2 Turbo, every side a multiple of 32). */
export const IMAGE_SIZES = [
  { id: "wide", label: "가로 16:9 (1536×864)", size: [1536, 864] },
  { id: "tall", label: "세로 9:16 (864×1536)", size: [864, 1536] },
  { id: "square", label: "정사각 1:1 (1024×1024)", size: [1024, 1024] },
  { id: "photo", label: "가로 4:3 (1152×864)", size: [1152, 864] },
  { id: "portrait", label: "세로 3:4 (864×1152)", size: [864, 1152] },
] as const;

export type ImageSizeId = (typeof IMAGE_SIZES)[number]["id"];
