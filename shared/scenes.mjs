// Scene-centred rules shared by the screens and the tests: which clip belongs to a scene, whether a scene continues the
// one before it, where its piece of the song is, and whether a made clip is out of date.

/** A file-name safe form of an id (scene and section ids can hold anything the user typed). */
export const safeName = (id) => String(id).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "item";

/** The clip of a scene. One scene, one clip: the name does not depend on pictures any more. */
export const clipPathOf = (sceneId) => `assets/video/clip-${safeName(sceneId)}.mp4`;

/** How the clip of a scene is made: "fl2v" from a first and a last picture (the default), or "r2v" from reference pictures of the people. */
export const modeOf = (opts, scene) => (opts?.[scene.id]?.mode === "r2v" ? "r2v" : "fl2v");

/** First picture of clip number `index + 1`: "<clip number>-1". */
export const firstImagePath = (index) => `assets/images/${index + 1}-1.png`;

/**
 * Last picture of a clip: the first picture of the next clip when the two are connected (one picture serves both),
 * else its own "<clip number>-2".
 */
export const lastImagePath = (scenes, opts, index) => {
  const next = scenes[index + 1];
  // Only a clip made from pictures has a first picture to share.
  return next && modeOf(opts, next) === "fl2v" && continuesPrevious(opts, next, index + 1) ? firstImagePath(index + 1) : `assets/images/${index + 1}-2.png`;
};

/**
 * Every picture the FL2V clips of a scenario need, once each, in clip order: { path, index, role, shared }.
 * `shared` is a picture that is the end of one clip and the start of the next. N clips, all connected: N + 1 pictures;
 * every connection that is cut adds one.
 */
export function slotImages(scenes, opts) {
  const slots = [];
  scenes.forEach((scene, index) => {
    if (modeOf(opts, scene) !== "fl2v") return;
    slots.push({ path: firstImagePath(index), index, role: "first", shared: false });
    const last = lastImagePath(scenes, opts, index);
    if (last !== firstImagePath(index + 1)) slots.push({ path: last, index, role: "last", shared: false });
  });
  // A picture shared with the clip before is the end of that clip as well.
  return slots.map((slot) => (slot.role === "first" && slot.index > 0 && lastImagePath(scenes, opts, slot.index - 1) === slot.path && modeOf(opts, scenes[slot.index - 1]) === "fl2v" ? { ...slot, shared: true } : slot));
}

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
export function clipStatus({ scene, index, scenes, opts, videos, images = /** @type {{ path: string, mtimeMs: number }[]} */ ([]) }) {
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
  // A first or last picture that was made or replaced after the clip was made.
  for (const path of [record.first, record.last]) {
    const picture = path && images.find((file) => file.path === path);
    if (picture && Number(record.createdAt) && picture.mtimeMs > Number(record.createdAt)) reasons.push(path === record.first ? "시작 이미지가 바뀌었습니다" : "끝 이미지가 바뀌었습니다");
  }
  return { state: reasons.length ? "stale" : "ready", reasons, versions: clip.versions ?? 0 };
}

/**
 * The scenes whose clips have to be made again when scene `index` is made again: for a reference clip the scene itself and every
 * following reference scene that continues the one before it; for a clip made from pictures only the scene itself.
 */
export function chainFrom(scenes, opts, index) {
  const chain = [index];
  // Clips made from pictures do not depend on each other; only reference clips take the last picture of the clip before.
  if (modeOf(opts, scenes[index]) !== "r2v") return chain;
  for (let i = index + 1; i < scenes.length && modeOf(opts, scenes[i]) === "r2v" && continuesPrevious(opts, scenes[i], i); i += 1) chain.push(i);
  return chain;
}
