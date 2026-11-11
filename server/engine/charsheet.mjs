/**
 * The character sheet of MiniMax H3 (after the micwFast Character Sheet workflow): one Ref2VA clip of static jump cuts of the same
 * person seen from the side, the back, three-quarter views and close-ups; one picture is taken from the middle of every shot and
 * the pictures are laid out as a sheet together with the reference picture.
 */

/** The shots in playback order; `label` is only for the screen. */
export const SHEET_SHOT_LIST = [
  { label: "뒷모습", text: "a static full-body shot, back view from head to toe" },
  { label: "왼쪽 옆모습", text: "a static full-body shot, side-view profile from the left" },
  { label: "오른쪽 옆모습", text: "a static full-body shot, side-view profile from the right" },
  { label: "3/4 앞 왼쪽", text: "a static front three-quarter view on the left, framed from mid-thigh to the top of the head" },
  { label: "3/4 앞 오른쪽", text: "a static front three-quarter view on the right, framed from mid-thigh to the top of the head" },
  { label: "3/4 뒤 왼쪽", text: "a static back three-quarter view on the left, framed from mid-thigh to the top of the head" },
  { label: "얼굴 정면", text: "a static close-up of the face from the front, neutral expression" },
  { label: "얼굴 왼쪽 옆", text: "a static close-up of the face from the left profile" },
];
export const SHEET_SECONDS = 5;
const NO_CAMERA = "Absolute zero camera motion, no camera movement, zero panning, zero tracking, zero zoom.";
const COLUMNS = 3;
const BACKGROUND = "0xe6e6e6";

const stamp = (seconds) => `00:${String(Math.floor(seconds)).padStart(2, "0")}.${String(Math.round((seconds % 1) * 1000)).padStart(3, "0")}`;

/** The prompt of the sheet clip in the Ref2VA format; `style` (optional, English) is added to the opening sentence. */
export function characterSheetPrompt({ style = "", seconds = SHEET_SECONDS } = {}) {
  const shots = SHEET_SHOT_LIST;
  const lines = shots.map((shot, index) => `[Shot ${index + 1}] ${index === 0 ? "" : `At ${stamp((seconds * index) / shots.length)}, `}instant jump cut to ${shot.text}, <Subject 1> in a plain light grey studio, even soft light. ${NO_CAMERA}`);
  const look = style.trim() ? ` Visual style: ${style.trim()}.` : " Use <Subject 1> strict visual style.";
  return `subject_definitions:
<Subject 1> is the sole character reference, the character shown in <Picture 1>.

summary:
[reference generation] Sequence of ${shots.length} shots over ${seconds} seconds: a character turnaround sheet shown as static jump cuts of the same character.

retention_analysis:
<Subject 1> (appears in ${shots.map((_, index) => `[Shot ${index + 1}]`).join(", ")}): fully_preserved - the face, skin, hair, body proportions and outfit of <Picture 1> are retained in every shot.

detailed_description:
The target video is a clean character reference sheet shot in a plain light grey studio with soft diffused light.${look}
${lines.join("\n")}

overall_soundscape:
Only quiet room tone is heard.

non_diegetic_music:
No music.`;
}

/** The time of the picture of every shot: the middle of the shot. */
export const sheetFrameTimes = (seconds = SHEET_SECONDS) => SHEET_SHOT_LIST.map((_, index) => ((index + 0.5) * seconds) / SHEET_SHOT_LIST.length);

/** ffmpeg filter that lays the reference picture (input 0) and the shot pictures (inputs 1..n) out in a grid of 3 columns; empty cells are plain. */
export function sheetFilter(count, [width, height]) {
  const empty = (COLUMNS - (count % COLUMNS)) % COLUMNS;
  const scaled = Array.from({ length: count }, (_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${BACKGROUND},setsar=1[v${i}]`);
  const blanks = Array.from({ length: empty }, (_, i) => `color=c=${BACKGROUND}:s=${width}x${height}:d=1[e${i}]`);
  const cells = [...Array.from({ length: count }, (_, i) => `[v${i}]`), ...Array.from({ length: empty }, (_, i) => `[e${i}]`)];
  const layout = cells.map((_, i) => `${(i % COLUMNS) * width}_${Math.floor(i / COLUMNS) * height}`).join("|");
  return [...scaled, ...blanks, `${cells.join("")}xstack=inputs=${cells.length}:layout=${layout}[out]`].join(";");
}
