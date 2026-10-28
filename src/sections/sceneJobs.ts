import { clipPathOf, continuesPrevious, firstImagePath, lastImagePath, modeOf, slotImages, songRange, usesSong } from "../../shared/scenes.mjs";
import type { MediaFile, Settings } from "../api";
import { charactersIn, referencesFor, type Bible } from "../bible";
import { makeItem, recipeOf, stamp, type MakeItem, type Recipe, type SceneOpts } from "./mediaJobs";

export interface SceneInput {
  id: string;
  description?: string;
  start_seconds?: number;
  end_seconds?: number;
}

interface Context {
  settings: Settings;
  scenes: SceneInput[];
  opts: SceneOpts | null | undefined;
  bible: Bible | null | undefined;
  images: MediaFile[];
  videos: MediaFile[];
}

/** Clip length of a scene: its length snapped to half seconds, inside what H3 makes (2-15 s). */
export function sceneSeconds(scene: SceneInput): number {
  const seconds = scene.start_seconds != null && scene.end_seconds != null ? scene.end_seconds - scene.start_seconds : 5;
  return Math.min(15, Math.max(2, Math.round(seconds * 2) / 2));
}

/** Reference pictures of a scene (reference clips): the ones chosen for it, else a sheet (or photo) of every person its text names. */
export function refsOfScene(ctx: Pick<Context, "bible" | "images" | "opts">, scene: SceneInput): string[] {
  const chosen = ctx.opts?.[scene.id]?.refs?.filter((path) => ctx.images.some((file) => file.path === path));
  if (chosen && chosen.length > 0) return chosen.slice(0, 9);
  return referencesFor(charactersIn(ctx.bible, scene.description ?? ""), ctx.images, 8);
}

/** The text the prompt maker turns into the prompt of one first or last picture (a connected picture mentions both clips). */
export function slotText(scenes: SceneInput[], opts: SceneOpts | null | undefined, slot: { index: number; role: string; shared: boolean }): string {
  const scene = scenes[slot.index];
  const short = (text?: string) => (text ?? "").trim().slice(0, 700);
  if (slot.role === "first" && slot.shared) {
    return `한 장의 정지 이미지입니다. 앞 장면의 마지막 화면이면서 이 장면의 첫 화면입니다.\n앞 장면: ${short(scenes[slot.index - 1]?.description)}\n이 장면: ${short(scene.description)}`;
  }
  const where = slot.role === "first" ? "이 장면의 첫 화면" : "이 장면의 마지막 화면";
  return `한 장의 정지 이미지입니다. ${where}입니다.\n장면: ${short(scene.description)}`;
}

/** The pictures the FL2V clips still need: one job for each first/last picture that does not exist (name: clip number-1 and -2). */
export function slotImageItems(ctx: Context): MakeItem[] {
  const { settings, scenes, opts, images } = ctx;
  const items: MakeItem[] = [];
  for (const slot of slotImages(scenes, opts)) {
    if (images.some((file) => file.path === slot.path) || !scenes[slot.index].description?.trim()) continue;
    const item = makeItem(settings, { kind: "image", prompt: slotText(scenes, opts, slot), source: scenes[slot.index].id, loras: opts?.[scenes[slot.index].id]?.loras?.filter((lora) => lora.name) }, slot.path);
    if (typeof item !== "string") items.push(item);
  }
  return items;
}

/**
 * The clip jobs of a scenario, one per scene and in scene order. Scenes that already have a clip are left out, or, with
 * `asVersions`, made again as another version of their clip (nothing is replaced until one is chosen).
 * `only` limits it to some scenes (by index). A scene is made from its first and last picture (FL2V, the default: both must exist)
 * or, when set so, from reference pictures of its people (R2V, which can start from the last picture of the clip before).
 * The song of the project guides the mouth where it applies.
 */
export function sceneItems(ctx: Context, { only, asVersions = false }: { only?: number[]; asVersions?: boolean } = {}): MakeItem[] {
  const { settings, scenes, opts, bible, images, videos } = ctx;
  const has = (path: string) => videos.some((file) => file.path === path);
  const hasImage = (path: string) => images.some((file) => file.path === path);
  const items: MakeItem[] = [];
  // Where the clip of each scene is (or is going to be) when the one after it starts from its last picture.
  const outputs = new Map<string, string>();
  scenes.forEach((scene, index) => {
    if (only && !only.includes(index)) return;
    const clip = clipPathOf(scene.id);
    const existing = videos.find((file) => file.path === clip);
    if (existing && !asVersions) return;
    const seconds = sceneSeconds(scene);
    const saved = opts?.[scene.id]?.prompt?.trim();
    const kept = existing ? recipeOf(existing.record)?.prompt : undefined;
    const prompt = saved || kept || scene.description?.trim() || "부드러운 카메라 이동으로 다음 장면으로 이어진다.";
    const loras = opts?.[scene.id]?.loras?.filter((lora) => lora.name);
    const output = existing && asVersions ? `assets/versions/clip-${clip.slice("assets/video/clip-".length, -4)}-${stamp()}.mp4` : clip;
    const people = charactersIn(bible, scene.description ?? "").length > 0;
    const song = settings.defaults.songFile;
    const guide = usesSong(opts, scene, song, people) ? { audio: song, audioRange: songRange(scene, seconds) as [number, number] } : {};
    let recipe: Recipe | null = null;
    if (modeOf(opts, scene) === "r2v") {
      const refs = refsOfScene({ bible, images, opts }, scene);
      const before = scenes[index - 1];
      const previous = before ? (outputs.get(before.id) ?? (has(clipPathOf(before.id)) ? clipPathOf(before.id) : undefined)) : undefined;
      if (refs.length > 0) recipe = { kind: "r2v", prompt, refs, duration: seconds, source: scene.id, loras, ...guide, ...(continuesPrevious(opts, scene, index) && previous ? { continuedFrom: previous } : {}) };
    } else {
      // FL2V: a connected clip shares its first picture with the end of the clip before (see lastImagePath in shared/scenes.mjs).
      const first = firstImagePath(index);
      const last = lastImagePath(scenes, opts, index);
      if (hasImage(first) && hasImage(last)) recipe = { kind: "fl2v", prompt, first, last, duration: seconds, source: scene.id, loras, ...guide };
    }
    if (!recipe) return;
    const item = makeItem(settings, recipe, output);
    if (typeof item === "string") return;
    outputs.set(scene.id, output);
    items.push({ ...item, final: Boolean(saved || kept), ...(existing && asVersions ? { candidateOf: clip } : {}) });
  });
  return items;
}
