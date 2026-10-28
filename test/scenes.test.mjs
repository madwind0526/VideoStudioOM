import assert from "node:assert/strict";
import { test } from "node:test";

import { chainFrom, clipPathOf, clipStatus, continuesPrevious, firstImagePath, lastImagePath, modeOf, safeName, slotImages, songRange, usesSong } from "../shared/scenes.mjs";

const scenes = [
  { id: "scene-1", start_seconds: 0, end_seconds: 6 },
  { id: "scene-2", start_seconds: 6, end_seconds: 13 },
  { id: "scene-3", start_seconds: 13, end_seconds: 23 },
  { id: "scene-4", start_seconds: 23, end_seconds: 31 },
];

test("a scene has one clip whose name follows the scene id", () => {
  assert.equal(clipPathOf("scene-10"), "assets/video/clip-scene-10.mp4");
  assert.equal(safeName(" 장면 / 1 "), "장면-1");
  assert.equal(safeName("///"), "item");
});

test("scenes continue the one before by default; the first never does; a scene can start anew", () => {
  assert.equal(continuesPrevious({}, scenes[0], 0), false);
  assert.equal(continuesPrevious({}, scenes[1], 1), true);
  assert.equal(continuesPrevious({ "scene-2": { continuePrevious: false } }, scenes[1], 1), false);
  // reference clips take the last picture of the clip before: the chain ends where a scene starts anew
  const r2v = Object.fromEntries(scenes.map((scene) => [scene.id, { mode: "r2v" }]));
  assert.deepEqual(chainFrom(scenes, { ...r2v, "scene-3": { mode: "r2v", continuePrevious: false } }, 0), [0, 1]);
  assert.deepEqual(chainFrom(scenes, r2v, 1), [1, 2, 3]);
  assert.deepEqual(chainFrom(scenes, { ...r2v, "scene-3": { mode: "r2v", continuePrevious: false } }, 2), [2, 3]);
  // clips made from pictures do not depend on each other
  assert.deepEqual(chainFrom(scenes, {}, 0), [0]);
});

test("the song guides a scene with people unless switched; it needs a song file", () => {
  assert.equal(usesSong({}, scenes[0], "assets/audio/song.wav", true), true);
  assert.equal(usesSong({}, scenes[0], "assets/audio/song.wav", false), false);
  assert.equal(usesSong({ "scene-1": { song: true } }, scenes[0], "assets/audio/song.wav", false), true);
  assert.equal(usesSong({ "scene-1": { song: false } }, scenes[0], "assets/audio/song.wav", true), false);
  assert.equal(usesSong({}, scenes[0], "", true), false);
  assert.deepEqual(songRange(scenes[1], 7), [6, 7]);
});

test("clip state: none, ready, and stale when the time moved or the clip before was made again", () => {
  const made = (index, extra = {}, mtimeMs = 1000) => ({ path: clipPathOf(scenes[index].id), mtimeMs, versions: 1, record: { createdAt: mtimeMs + 5, audioRange: [scenes[index].start_seconds, 7], ...extra } });
  const state = (index, videos, opts = {}) => clipStatus({ scene: scenes[index], index, scenes, opts, videos });
  assert.equal(state(0, []).state, "none");
  assert.equal(state(0, [made(0)]).state, "ready");

  // the scene moved in time: the song piece of the clip is no longer the scene's
  const moved = { ...scenes[1], start_seconds: 10 };
  assert.equal(clipStatus({ scene: moved, index: 1, scenes, opts: {}, videos: [made(1)] }).state, "stale");

  // the clip before was made again after this one: stale; with an older file (a version chosen back) it is fine again
  const continued = made(1, { continuedFrom: clipPathOf("scene-1") }, 2000);
  assert.deepEqual(state(1, [made(0, {}, 3000), continued]).reasons, ["앞 장면 영상이 바뀌었습니다"]);
  assert.equal(state(1, [made(0, {}, 1500), continued]).state, "ready");
  // switched to start anew: no longer depends on the clip before
  assert.equal(state(1, [made(0, {}, 3000), continued], { "scene-2": { continuePrevious: false } }).state, "ready");
});

test("pictures: connected clips share one, a cut adds one; names follow the clip number", () => {
  assert.equal(modeOf({}, scenes[0]), "fl2v");
  assert.equal(firstImagePath(0), "assets/images/1-1.png");
  const names = (opts) => slotImages(scenes, opts).map((slot) => slot.path.replace("assets/images/", "").replace(".png", ""));
  // 4 clips all connected: 5 pictures (the last clip has its own end picture)
  assert.deepEqual(names({}), ["1-1", "2-1", "3-1", "4-1", "4-2"]);
  // all cut: 2 pictures per clip
  const cut = Object.fromEntries(scenes.map((scene) => [scene.id, { continuePrevious: false }]));
  assert.deepEqual(names(cut), ["1-1", "1-2", "2-1", "2-2", "3-1", "3-2", "4-1", "4-2"]);
  // one cut between clip 2 and 3: 6 pictures
  assert.deepEqual(names({ "scene-3": { continuePrevious: false } }), ["1-1", "2-1", "2-2", "3-1", "4-1", "4-2"]);
  // the end of a clip is the start of the next when they are connected
  assert.equal(lastImagePath(scenes, {}, 0), "assets/images/2-1.png");
  assert.equal(lastImagePath(scenes, { "scene-2": { continuePrevious: false } }, 0), "assets/images/1-2.png");
  assert.equal(lastImagePath(scenes, {}, 3), "assets/images/4-2.png");
  // a shared picture is marked; reference clips do not need pictures
  assert.deepEqual(slotImages(scenes, {}).filter((slot) => slot.shared).map((slot) => slot.path), ["assets/images/2-1.png", "assets/images/3-1.png", "assets/images/4-1.png"]);
  assert.deepEqual(slotImages(scenes, { "scene-2": { mode: "r2v" } }).map((slot) => slot.index), [0, 0, 2, 3, 3]);
});

test("a clip made from pictures is out of date when a picture was made or replaced after it", () => {
  const record = { first: "assets/images/1-1.png", last: "assets/images/2-1.png", createdAt: 5000 };
  const videos = [{ path: clipPathOf("scene-1"), mtimeMs: 4000, versions: 1, record }];
  const state = (images) => clipStatus({ scene: scenes[0], index: 0, scenes, opts: {}, videos, images });
  assert.equal(state([{ path: "assets/images/1-1.png", mtimeMs: 3000 }, { path: "assets/images/2-1.png", mtimeMs: 3000 }]).state, "ready");
  assert.deepEqual(state([{ path: "assets/images/1-1.png", mtimeMs: 3000 }, { path: "assets/images/2-1.png", mtimeMs: 9000 }]).reasons, ["끝 이미지가 바뀌었습니다"]);
  assert.deepEqual(state([{ path: "assets/images/1-1.png", mtimeMs: 9000 }]).reasons, ["시작 이미지가 바뀌었습니다"]);
});
