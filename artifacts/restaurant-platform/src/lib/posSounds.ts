/**
 * POS terminal sound effects — a thin wrapper around the audio engine that
 * lives inside `<PosShell>` (`usePosSounds`). We route every cue through a
 * window CustomEvent so the shell's single AudioContext (which the user has
 * already "activated" via a gesture on the shell's own buttons) is the only
 * audio engine on the page. Earlier versions of this file owned a second
 * AudioContext, which Chromium happily created but never un-suspended —
 * resulting in dead silence whenever the cue site (a cart add/remove)
 * happened before the user had clicked any header control.
 *
 * Keeping the shape of `playPosSound(cue)` means existing call sites in
 * pos.tsx don't need to change.
 */

type Cue = "add" | "remove" | "success" | "error" | "scan";

/** Custom-event name the PosShell listens on. */
export const POS_SOUND_EVENT = "pos:sound";

/**
 * Play a POS audio cue. Safe to call from any handler — never throws,
 * never blocks. Forwarded to PosShell's audio engine via a window event so
 * a single AudioContext (already user-activated by the shell) drives every
 * sound on the page.
 */
export function playPosSound(cue: Cue): void {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<Cue>(POS_SOUND_EVENT, { detail: cue }));
  } catch {
    // never let a bad cue break a payment / order flow
  }
}
