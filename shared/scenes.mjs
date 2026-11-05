// Scene-centred rules shared by the screens and the tests: which clip belongs to a scene, whether a scene continues the
// one before it, where its piece of the song is, and whether a made clip is out of date.

/** A file-name safe form of an id (scene and section ids can hold anything the user typed). */
export const safeName = (id) => String(id).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "item";

/** The clip of a scene. One scene, one clip: the name does not depend on pictures any more. */
export const clipPathOf = (sceneId) => `assets/video/clip-${safeName(sceneId)}.mp4`;

/**
 * How the clip of a scene is made:
 * - "fl2v" (the default) from a first and a last picture; a clip connected to the one before shares its first picture with that clip's last one;
 * - "t2v", "i2v", "s2v" from a first picture only: the first clip's picture is made from a text (t2v), from reference pictures (i2v) or as
 *   a face for the song (s2v); a connected clip starts from the last frame of the clip before, a clip that is not connected has a picture of its own;
 * - "r2v" from reference pictures of the people (no pictures of its own).
 */
export const MODES = ["fl2v", "t2v", "i2v", "s2v", "r2v"];
export const modeOf = (opts, scene) => [opts?.[scene.id]?.mode, opts?.["*"]?.mode].find((mode) => MODES.includes(mode)) ?? "fl2v";

/** The way clips are made unless a scene says otherwise: the project's video mode from the start page (S2V when its audio source is S2V). */
export const defaultMode = (defaults) => (defaults?.audioSource === "s2v" ? "s2v" : MODES.find((mode) => mode === String(defaults?.videoMode).toLowerCase()) ?? "fl2v");

/** Scene options plus the default way, kept under the key "*" (never saved; scene ids cannot be "*"). */
export const withProjectMode = (opts, mode) => ({ ...(opts ?? {}), "*": { mode } });

/** Clips that start from the last frame of the clip before when connected (every way but fl2v, which shares a picture instead). */
export const isChain = (mode) => mode !== "fl2v";

/** The scene has a first picture file: every fl2v clip (shared with the clip before when connected), and a chain clip that starts anew. */
export const needsFirstPicture = (opts, scene, index) => {
  const mode = modeOf(opts, scene);
  return mode === "fl2v" || (mode !== "r2v" && (index === 0 || !continuesPrevious(opts, scene, index)));
};

/** First picture of clip number `index + 1`: "<clip number>-1". */
export const firstImagePath = (index) => `assets/images/${index + 1}-1.png`;

/**
 * Last picture of a clip: the first picture of the next clip when the two are connected (one picture serves both),
 * else its own "<clip number>-2".
 */
export const lastImagePath = (scenes, opts, index) => {
  const next = scenes[index + 1];
  // Only an fl2v clip takes the picture over as its first one (the others start from the last frame of the clip).
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
    if (!needsFirstPicture(opts, scene, index)) return;
    slots.push({ path: firstImagePath(index), index, role: "first", shared: false });
    // Only a clip from a first and a last picture has a last one.
    if (modeOf(opts, scene) !== "fl2v") return;
    const last = lastImagePath(scenes, opts, index);
    if (last !== firstImagePath(index + 1)) slots.push({ path: last, index, role: "last", shared: false });
  });
  // A picture shared with the clip before is the end of that clip as well.
  return slots.map((slot) => (slot.role === "first" && slot.index > 0 && lastImagePath(scenes, opts, slot.index - 1) === slot.path && modeOf(opts, scenes[slot.index - 1]) === "fl2v" ? { ...slot, shared: true } : slot));
}

/**
 * What has to happen to the picture files when the scene list changes (a scene added, deleted or moved, a connection switched):
 * the names follow the clip numbers, so each scene takes its pictures along. Returns `moves` ([{ from, to }], see
 * versions.arrange: from === to stays, `from` null empties the spot, `to` null puts a picture of a gone scene aside) and
 * `clips` (the pictures the clips of the scenes are recorded with, now at other names).
 */
export function pictureMoves(before, beforeOpts, after, afterOpts) {
  const pictures = (scenes, opts) =>
    new Map(scenes.map((scene, index) => [scene.id, modeOf(opts, scene) === "r2v" ? null : { first: needsFirstPicture(opts, scene, index) ? firstImagePath(index) : null, last: modeOf(opts, scene) === "fl2v" ? lastImagePath(scenes, opts, index) : null }]));
  const was = pictures(before, beforeOpts);
  const now = pictures(after, afterOpts);
  const source = new Map();
  const clips = [];
  for (const [id, to] of now) {
    const from = was.get(id);
    if (!to) continue;
    // A picture that ends one clip and starts the next belongs to the earlier scene first (scenes come in order).
    for (const role of ["first", "last"]) if (to[role] && source.get(to[role]) == null) source.set(to[role], from?.[role] ?? null);
    if (from && (from.first !== to.first || from.last !== to.last)) clips.push({ clip: clipPathOf(id), first: to.first, last: to.last });
  }
  const moves = [...source].map(([to, from]) => ({ from, to }));
  for (const old of was.values()) for (const from of old ? [old.first, old.last].filter(Boolean) : []) if (!source.has(from) && !moves.some((move) => move.from === from && move.to === null)) moves.push({ from, to: null });
  return { moves, clips };
}

/** A scene continues the one before it (its first frame is the last frame of that clip) unless it is switched off; the first scene never does. */
export const continuesPrevious = (opts, scene, index) => index > 0 && opts?.[scene.id]?.continuePrevious !== false;

/** The song is the guide of a scene when there is one and the scene shows people (or the user switched it on or off). */
export const usesSong = (opts, scene, songFile, hasPeople) => {
  // A sound clip (s2v) is always made with the song.
  return Boolean(songFile) && (modeOf(opts, scene) === "s2v" || (opts?.[scene.id]?.song ?? hasPeople));
};

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
 * The scenes whose clips have to be made again when scene `index` is made again: for a clip that starts from the last frame of the one
 * before (every way but fl2v) the scene itself and every following scene that continues it; for fl2v only the scene itself.
 */
export function chainFrom(scenes, opts, index) {
  const chain = [index];
  // Clips from two pictures do not depend on each other; the others take the last frame of the clip before.
  if (!isChain(modeOf(opts, scenes[index]))) return chain;
  for (let i = index + 1; i < scenes.length && isChain(modeOf(opts, scenes[i])) && continuesPrevious(opts, scenes[i], i); i += 1) chain.push(i);
  return chain;
}
