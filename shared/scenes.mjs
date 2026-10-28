// Scene-centred rules shared by the screens and the tests: which clip belongs to a scene, whether a scene continues the
// one before it, where its piece of the song is, and whether a made clip is out of date.

/** A file-name safe form of an id (scene and section ids can hold anything the user typed). */
export const safeName = (id) => String(id).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "item";

/** The clip of a scene. One scene, one clip: the name does not depend on pictures any more. */
export const clipPathOf = (sceneId) => `assets/video/clip-${safeName(sceneId)}.mp4`;

/** The picture made for a scene (images tab, "빠진 이미지 모두 만들기"). */
export const imagePathOf = (sceneId) => `assets/images/${safeName(sceneId)}.png`;

/** A scene continues the one before it (its first frame is the last frame of that clip) unless it is switched off; the first scene never does. */
export const continuesPrevious = (opts, scene, index) => index > 0 && opts?.[scene.id]?.continuePrevious !== false;

/** The song is the guide of a scene when there is one and the scene shows people (or the user switched it on or off). */
export const usesSong = (opts, scene, songFile, hasPeople) => Boolean(songFile) && (opts?.[scene.id]?.song ?? hasPeople);

/** [start, length] of the piece of the song a scene sounds with. */
export const songRange = (scene, seconds) => [Math.max(0, Number(scene.start_seconds) || 0), seconds];

/**
 * State of the clip of one scene. `videos` are the project's video files ({ path, mtimeMs, record, versions }).
 * - "none": no clip yet
 * - "stale": made, but the scene changed since (its time moved, or the clip before it was made again)
 * - "ready"
 */
export function clipStatus({ scene, index, scenes, opts, videos }) {
  const clip = videos.find((file) => file.path === clipPathOf(scene.id));
  if (!clip) return { state: "none", reasons: [], versions: 0 };
  const reasons = [];
  const record = clip.record ?? {};
  // Only clips made with a song depend on where the scene sits in time.
  if (Array.isArray(record.audioRange) && Math.abs(record.audioRange[0] - Number(scene.start_seconds)) > 0.01) reasons.push("시간대가 바뀌어 노래 구간이 달라졌습니다");
  if (continuesPrevious(opts, scene, index) && record.continuedFrom) {
    const before = videos.find((file) => file.path === clipPathOf(scenes[index - 1].id));
    // The clip before was made again after this one was made (a new version was chosen or the clip was replaced).
    if (before && Number(record.createdAt) && before.mtimeMs > Number(record.createdAt)) reasons.push("앞 장면 영상이 바뀌었습니다");
  }
  return { state: reasons.length ? "stale" : "ready", reasons, versions: clip.versions ?? 0 };
}

/**
 * The scenes whose clips have to be made again when scene `index` is made again: the scene itself and every following scene
 * that continues the one before it (the chain ends at the next scene that starts anew).
 */
export function chainFrom(scenes, opts, index) {
  const chain = [index];
  for (let i = index + 1; i < scenes.length && continuesPrevious(opts, scenes[i], i); i += 1) chain.push(i);
  return chain;
}
