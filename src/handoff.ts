/** A prompt of the prompt library that is sent to a make screen; the screen reads it once when it opens. */
export type Handoff = { kind: "image"; tab: "make" | "vary" | "ref"; prompt: string; image?: string } | { kind: "video"; prompt: string } | { kind: "clip"; prompt: string };

let pending: Handoff | null = null;

export const sendHandoff = (handoff: Handoff) => {
  pending = handoff;
};
/** Reads without clearing, so a double render in development sees the same value; call clearHandoff after mount. */
export const peekHandoff = <K extends Handoff["kind"]>(kind: K) => (pending?.kind === kind ? (pending as Extract<Handoff, { kind: K }>) : null);
export const clearHandoff = () => {
  pending = null;
};
