import path from "node:path";

import { ffmpegFor } from "../concat.mjs";

/**
 * Character sheets the way the MICW workflow makes them: one MiniMax H3 reference clip whose timed shots show the same
 * person from different sides, then one frame per shot, then a clean grid laid out by code. The identity comes from the
 * reference picture(s); the layout never overlaps because the image model does not draw it.
 */

/** One shot per second: five full-body views, then three face close-ups. `at` is the cut time of the shot. */
export const SHEET_SHOTS = [
  { id: "front", at: 0, kind: "body", text: "a full-body front view: <Subject 1> stands straight facing the camera, arms relaxed at the sides, feet together" },
  { id: "front34", at: 1, kind: "body", text: "a full-body three-quarter front view: <Subject 1> turned about 45 degrees to her or his left, still standing straight" },
  { id: "side", at: 2, kind: "body", text: "a full-body side profile view: <Subject 1> turned a full 90 degrees to the left, showing the profile of the face and the side of the outfit" },
  { id: "rear34", at: 3, kind: "body", text: "a full-body three-quarter rear view: <Subject 1> turned about 135 degrees, the back and one side of the outfit visible" },
  { id: "back", at: 4, kind: "body", text: "a full-body back view: <Subject 1> facing away from the camera, showing the hair and the back of the outfit" },
  { id: "face-neutral", at: 5, kind: "face", text: "a head-and-shoulders close-up facing the camera with a calm neutral expression" },
  { id: "face-smile", at: 6, kind: "face", text: "a head-and-shoulders close-up facing the camera with a gentle natural smile" },
  { id: "face-serious", at: 7, kind: "face", text: "a head-and-shoulders close-up facing the camera with a serious, focused expression" },
];
export const SHEET_SECONDS = SHEET_SHOTS.length;

const stamp = (seconds) => `00:${String(seconds).padStart(2, "0")}.000`;

/**
 * The prompt for the sheet clip, in the official full-reference (Ref2VA) format, filled in by code so the shot times
 * always match the frames that are taken later. `description` is the English look of the character; `faceReferences`
 * is the number of extra pictures that only fix the face.
 */
export function sheetPrompt({ description, style = "", faceReferences = 0 }) {
  const look = description.trim().replace(/\s+/g, " ");
  const subject = `<Subject 1> is the person in <Picture 1>, ${look}${faceReferences > 0 ? ` The face, eye shape and facial features come from ${Array.from({ length: faceReferences }, (_, i) => `<Picture ${i + 2}>`).join(" and ")}; <Picture 1> defines the body proportions, hair and exact outfit.` : ""}`;
  const last = SHEET_SHOTS.length;
  const shots = SHEET_SHOTS.map((shot, index) => `[Shot ${index + 1}] ${index === 0 ? "" : `At ${stamp(shot.at)}, the shot cuts to `}${index === 0 ? "A locked-off static shot frames " : ""}${shot.text}, in the same plain light-grey studio with the same flat even light.`).join("\n");
  return [
    `subject_definitions:\n${subject}`,
    `summary:\n[reference generation] A character turnaround shoot of <Subject 1> against a plain light-grey seamless studio background: eight locked-off framings of the same person, five full-body views from the front to the back and three face close-ups with different expressions.`,
    `retention_analysis:\n<Subject 1> (appears in [Shot 1] to [Shot ${last}]): fully_preserved - the face, hair, body proportions and the exact outfit of <Picture 1> are retained unchanged in every view.`,
    `detailed_description:\nThe target video is a clean character-design reference turnaround${style ? ` in this look: ${style.trim()}` : ""}, with a static camera, a seamless light-grey background and flat even studio lighting without cast shadows.\n${shots} The outfit, hair and face stay identical in every shot; only the viewing angle and the expression change.`,
    "overall_soundscape:\nFaint, steady studio room tone.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
}

/** The Krea prompt for the full-body picture that defines <Picture 1> when the character has no photo of her or his own. */
export const sheetReferencePrompt = ({ description, style = "" }) =>
  `Full-body front view of ${description.trim().replace(/\s+/g, " ")} Standing straight facing the camera, arms relaxed at the sides, the whole body visible from head to feet, on a plain light-grey seamless studio background with flat even lighting.${style ? ` ${style.trim()}.` : ""}`;

/**
 * Lays the eight frames out as one sheet: the five full-body views in a row (centre-cropped to a portrait strip), the three
 * face close-ups centred below them (cropped square). `frames` are image files in the order of SHEET_SHOTS.
 */
export async function composeSheet({ ffmpegPath, frames, output, capture, panelHeight = 864, background = "0xe9ecef" }) {
  if (frames.length !== SHEET_SHOTS.length) throw new Error(`시트에는 컷 ${SHEET_SHOTS.length}장이 필요합니다.`);
  const bodyWidth = Math.round(panelHeight * 0.62);
  const bodies = SHEET_SHOTS.filter((shot) => shot.kind === "body").length;
  const rowWidth = bodyWidth * bodies;
  const body = (i) => `[${i}:v]crop=ih*0.62:ih,scale=${bodyWidth}:${panelHeight}:flags=lanczos[b${i}]`;
  // A close-up fills most of the frame: keep the middle 88 % of its height as a square.
  const face = (i) => `[${i}:v]crop=ih*0.88:ih*0.88,scale=${panelHeight}:${panelHeight}:flags=lanczos[f${i}]`;
  const bodyIndexes = SHEET_SHOTS.flatMap((shot, i) => (shot.kind === "body" ? [i] : []));
  const faceIndexes = SHEET_SHOTS.flatMap((shot, i) => (shot.kind === "face" ? [i] : []));
  const filter = [
    ...bodyIndexes.map(body),
    ...faceIndexes.map(face),
    `${bodyIndexes.map((i) => `[b${i}]`).join("")}hstack=inputs=${bodyIndexes.length}[top]`,
    `${faceIndexes.map((i) => `[f${i}]`).join("")}hstack=inputs=${faceIndexes.length},pad=${rowWidth}:${panelHeight}:(ow-iw)/2:0:color=${background}[bottom]`,
    "[top][bottom]vstack=inputs=2[sheet]",
  ].join(";");
  const args = ["-loglevel", "error", "-y"];
  for (const frame of frames) args.push("-i", frame);
  await capture(ffmpegFor(ffmpegPath), [...args, "-filter_complex", filter, "-map", "[sheet]", "-frames:v", "1", output]);
  return { width: rowWidth, height: panelHeight * 2, extension: path.extname(output) };
}

/** The frame of shot `shot` taken half a second after its cut, so the cut itself is never caught. */
export async function extractFrame({ ffmpegPath, clip, shot, output, capture }) {
  await capture(ffmpegFor(ffmpegPath), ["-loglevel", "error", "-y", "-ss", String(shot.at + 0.5), "-i", clip, "-frames:v", "1", output]);
}
