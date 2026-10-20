/** Sound roles in a mix: speech, sound effects, music (instrumental and vocal). */
export const ROLES = ["dialogue", "sfx", "music"];

/**
 * The ffmpeg filter graph that lays pieces on one timeline. Every piece is delayed to its start second; pieces of one
 * role are summed. With `duck`, the music bus is compressed by the dialogue bus (side-chain) so speech stays clear.
 * pieces: [{ startSeconds, role }] in the order of the ffmpeg inputs. Returns { filter, label }.
 */
export function buildMixFilter(pieces, { duck = false } = {}) {
  const lines = pieces.map((piece, i) => {
    const ms = Math.max(0, Math.round((Number(piece.startSeconds) || 0) * 1000));
    return `[${i}:a:0]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[p${i}]`;
  });
  const roleOf = (piece) => (ROLES.includes(piece.role) ? piece.role : "dialogue");
  const bus = {};
  for (const role of ROLES) {
    const ids = pieces.map((piece, i) => (roleOf(piece) === role ? i : -1)).filter((i) => i >= 0);
    if (ids.length === 0) continue;
    lines.push(`${ids.map((i) => `[p${i}]`).join("")}amix=inputs=${ids.length}:normalize=0:duration=longest[${role}]`);
    bus[role] = role;
  }
  const finals = [];
  if (duck && bus.dialogue && bus.music) {
    lines.push("[dialogue]asplit=2[dlg][dlgkey]");
    lines.push("[music][dlgkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500:makeup=1[musicducked]");
    finals.push("[dlg]", "[musicducked]");
    if (bus.sfx) finals.push("[sfx]");
  } else {
    finals.push(...Object.keys(bus).map((role) => `[${role}]`));
  }
  lines.push(`${finals.join("")}amix=inputs=${finals.length}:normalize=0:duration=longest,alimiter=limit=0.95[mix]`);
  return { filter: lines.join(";"), label: "[mix]" };
}
