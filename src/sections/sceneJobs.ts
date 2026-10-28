import { clipPathOf, continuesPrevious, imagePathOf, songRange, usesSong } from "../../shared/scenes.mjs";
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

/** Reference pictures of a scene: the ones chosen for it, else a sheet (or photo) of every person its text names. */
export function refsOfScene(ctx: Pick<Context, "bible" | "images" | "opts">, scene: SceneInput): string[] {
  const chosen = ctx.opts?.[scene.id]?.refs?.filter((path) => ctx.images.some((file) => file.path === path));
  if (chosen && chosen.length > 0) return chosen.slice(0, 9);
  return referencesFor(charactersIn(ctx.bible, scene.description ?? ""), ctx.images, 8);
}

/**
 * The clip jobs of a scenario, one per scene and in scene order. Scenes that already have a clip are left out, or, with
 * `asVersions`, made again as another version of their clip (nothing is replaced until one is chosen).
 * `only` limits it to some scenes (by index). A scene with people goes to R2V with their sheets; the song and the clip before it
 * are given when they apply. A scene without people but with its own picture goes picture to picture as before.
 */
export function sceneItems(ctx: Context, { only, asVersions = false }: { only?: number[]; asVersions?: boolean } = {}): MakeItem[] {
  const { settings, scenes, opts, bible, images, videos } = ctx;
  const has = (path: string) => videos.some((file) => file.path === path);
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
    const refs = refsOfScene({ bible, images, opts }, scene);
    const loras = opts?.[scene.id]?.loras?.filter((lora) => lora.name);
    const output = existing && asVersions ? `assets/versions/clip-${clip.slice("assets/video/clip-".length, -4)}-${stamp()}.mp4` : clip;
    let recipe: Recipe | null = null;
    if (refs.length > 0) {
      const people = charactersIn(bible, scene.description ?? "").length > 0;
      const song = settings.defaults.songFile;
      const before = scenes[index - 1];
      const previous = before ? (outputs.get(before.id) ?? (has(clipPathOf(before.id)) ? clipPathOf(before.id) : undefined)) : undefined;
      recipe = {
        kind: "r2v",
        prompt,
        refs,
        duration: seconds,
        source: scene.id,
        loras,
        ...(usesSong(opts, scene, song, people) ? { audio: song, audioRange: songRange(scene, seconds) as [number, number] } : {}),
        ...(continuesPrevious(opts, scene, index) && previous ? { continuedFrom: previous } : {}),
      };
    } else {
      // No people: a picture made for the scene (and the next scene's picture, if any) is what is animated.
      const first = images.find((file) => file.path === imagePathOf(scene.id));
      const next = scenes[index + 1] ? images.find((file) => file.path === imagePathOf(scenes[index + 1].id)) : undefined;
      if (first) recipe = next ? { kind: "fl2v", prompt, first: first.path, last: next.path, duration: seconds, source: scene.id, loras } : { kind: "i2v", prompt, first: first.path, duration: seconds, source: scene.id, loras };
    }
    if (!recipe) return;
    const item = makeItem(settings, recipe, output);
    if (typeof item === "string") return;
    outputs.set(scene.id, output);
    items.push({ ...item, final: Boolean(saved || kept), ...(existing && asVersions ? { candidateOf: clip } : {}) });
  });
  return items;
}
