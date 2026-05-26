/**
 * Lightweight POS terminal sound effects using the Web Audio API.
 *
 * Synthesized on-the-fly so we don't ship audio assets, don't need to wait
 * for network fetches, and don't break in offline mode. Each cue is a short
 * (<150ms) beep — the only goal is tactile feedback for cashiers banging
 * through high-volume orders ("did that scan register? did the payment go
 * through?"). Loud, distracting, or musical is the wrong direction.
 *
 * Browsers gate AudioContext creation until the page receives a user
 * gesture, which is fine here — every cue fires in response to a click,
 * keypress, or scan, all of which qualify. We lazy-create the context on
 * first use and reuse it forever after.
 */

type Cue = "add" | "remove" | "success" | "error" | "scan";

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
}

interface Tone {
  freq: number;     // Hz
  duration: number; // seconds
  type?: OscillatorType;
  gain?: number;    // 0..1, default 0.08 (quiet)
  delay?: number;   // seconds offset from start
}

const CUES: Record<Cue, Tone[]> = {
  // Crisp single click — fires every time an item lands in the cart.
  add: [{ freq: 880, duration: 0.07, type: "triangle", gain: 0.07 }],
  // Lower, softer thunk — distinguishable from add without being alarming.
  remove: [{ freq: 220, duration: 0.09, type: "sine", gain: 0.06 }],
  // Two-note ascending major third — universal "done" cue.
  success: [
    { freq: 660, duration: 0.10, type: "triangle", gain: 0.08, delay: 0 },
    { freq: 990, duration: 0.14, type: "triangle", gain: 0.08, delay: 0.10 },
  ],
  // Two-note descending — universal "nope" cue. Slightly louder so it cuts
  // through a busy floor.
  error: [
    { freq: 380, duration: 0.10, type: "square", gain: 0.09, delay: 0 },
    { freq: 220, duration: 0.18, type: "square", gain: 0.09, delay: 0.09 },
  ],
  // Same as add but a touch higher — barcode wedge gets its own pitch so
  // the cashier can tell "the scan registered" from "the item added".
  scan: [{ freq: 1320, duration: 0.05, type: "triangle", gain: 0.06 }],
};

/**
 * Play a POS audio cue. Safe to call from any handler — never throws,
 * never blocks, silently no-ops when audio is unavailable (SSR, locked
 * AudioContext before first gesture, sound disabled in settings, etc.).
 */
export function playPosSound(cue: Cue): void {
  try {
    const c = getCtx();
    if (!c) return;
    // Some browsers suspend the context until the next user gesture.
    // resume() is a no-op when already running.
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    for (const tone of CUES[cue]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = tone.type ?? "sine";
      osc.frequency.value = tone.freq;
      const start = now + (tone.delay ?? 0);
      const end = start + tone.duration;
      const peak = tone.gain ?? 0.08;
      // Tiny attack + exponential decay → percussive, not a held tone.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // never let a bad cue break a payment / order flow
  }
}
