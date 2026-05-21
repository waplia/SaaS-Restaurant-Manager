/**
 * Rich 3-second WebAudio notification chimes.
 *
 * No asset files: every tone is synthesised from oscillators with envelopes
 * and a touch of reverb-style decay so it sounds musical rather than a flat
 * beep. Two presets:
 *   - playNewOrderChime(): triumphant 3-second arpeggio for `order:new`
 *   - playNotificationChime(): softer 3-second two-note ping for generic
 *     notifications (waiter calls, system alerts, etc.).
 *
 * Browsers block AudioContext until the user has interacted with the page,
 * so the first event after page-load may be silent. We keep a single shared
 * context and lazily resume it whenever a user gesture (click/keydown) is
 * observed.
 */

const SOUND_PREF_KEY = "tt_notification_sound";

type AC = AudioContext;

let sharedCtx: AC | null = null;
let unlocked = false;
// Keep at most one queued play per key so a long locked session can't
// accumulate a wall of deferred chimes that all flush at unlock.
const pendingPlays = new Map<string, () => void>();

function getCtx(): AC | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  try {
    const Ctor = (window.AudioContext
      || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    return null;
  }
}

function flushPending(): void {
  for (const [, run] of pendingPlays) {
    // Re-check the mute pref at execution time — user may have muted while
    // the gesture was still pending.
    if (isSoundEnabled()) run();
  }
  pendingPlays.clear();
}

function tryUnlock(): void {
  const ctx = sharedCtx ?? getCtx();
  if (!ctx) return;
  if (ctx.state === "running") {
    unlocked = true;
    flushPending();
    return;
  }
  ctx.resume().then(() => {
    unlocked = true;
    flushPending();
  }).catch(() => { /* still locked */ });
}

if (typeof window !== "undefined") {
  const onGesture = () => {
    tryUnlock();
    if (unlocked) {
      window.removeEventListener("click", onGesture);
      window.removeEventListener("keydown", onGesture);
      window.removeEventListener("touchstart", onGesture);
    }
  };
  window.addEventListener("click", onGesture, { passive: true });
  window.addEventListener("keydown", onGesture);
  window.addEventListener("touchstart", onGesture, { passive: true });
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const v = window.localStorage.getItem(SOUND_PREF_KEY);
  return v === null ? true : v === "1";
}

export function setSoundEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOUND_PREF_KEY, on ? "1" : "0");
}

/** Schedule a single oscillator note with an ADSR-like envelope. */
function scheduleNote(
  ctx: AC,
  destination: AudioNode,
  opts: {
    freq: number;
    startOffset: number; // seconds from now
    duration: number;
    type?: OscillatorType;
    peak?: number;
    attack?: number;
    release?: number;
    detune?: number;
  },
): void {
  const { freq, startOffset, duration, type = "sine", peak = 0.25, attack = 0.02, release = 0.25, detune = 0 } = opts;
  const t0 = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (detune) osc.detune.setValueAtTime(detune, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.setValueAtTime(peak, t0 + Math.max(attack, duration - release));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/**
 * Build a master bus with a gentle lowpass + a feedback delay so the chime
 * sounds like it's in a small room rather than a dry bleep.
 */
function buildBus(ctx: AC, masterGain: number, tailSeconds: number): AudioNode {
  const master = ctx.createGain();
  master.gain.value = masterGain;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 5200;
  lowpass.Q.value = 0.7;

  const dryWet = ctx.createGain();
  dryWet.gain.value = 1;

  // Simple feedback delay → faux reverb tail
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.18;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;

  master.connect(lowpass);
  lowpass.connect(dryWet);
  dryWet.connect(ctx.destination);

  lowpass.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(ctx.destination);

  // Deterministic teardown so we don't accumulate audio nodes over the
  // lifetime of the session (every play creates a fresh bus chain).
  const teardownAt = (tailSeconds + 0.4) * 1000;
  setTimeout(() => {
    try { master.disconnect(); } catch { /* noop */ }
    try { lowpass.disconnect(); } catch { /* noop */ }
    try { dryWet.disconnect(); } catch { /* noop */ }
    try { delay.disconnect(); } catch { /* noop */ }
    try { fb.disconnect(); } catch { /* noop */ }
    try { wet.disconnect(); } catch { /* noop */ }
  }, teardownAt);

  return master;
}

// Cooldown so a burst of socket events doesn't stack a wall of chimes.
let lastPlay: Record<string, number> = {};
function rateLimited(key: string, gapMs: number): boolean {
  const now = Date.now();
  const prev = lastPlay[key] ?? 0;
  if (now - prev < gapMs) return true;
  lastPlay[key] = now;
  return false;
}

/**
 * Triumphant 3-second chime for new orders.
 * - Bell strike (C6) with a quick octave shimmer
 * - Major-7 arpeggio C-E-G-B climbing then resolving on a high C
 * - Long reverb tail so it lingers ~3s total
 */
export function playNewOrderChime(): void {
  if (!isSoundEnabled()) return;
  // Cooldown longer than the 3s tail so two chimes can't overlap and
  // smear into noise during a burst of socket events.
  if (rateLimited("new-order", 3500)) return;
  const run = () => {
    const ctx = getCtx();
    if (!ctx) return;
    const bus = buildBus(ctx, 0.9, 3.0);

    // Opening bell-like strike: fundamental + octave + fifth.
    scheduleNote(ctx, bus, { freq: 1046.5, startOffset: 0.00, duration: 1.4, type: "sine",     peak: 0.45, attack: 0.005, release: 1.2 });
    scheduleNote(ctx, bus, { freq: 2093.0, startOffset: 0.00, duration: 1.1, type: "sine",     peak: 0.18, attack: 0.005, release: 1.0 });
    scheduleNote(ctx, bus, { freq: 1568.0, startOffset: 0.00, duration: 1.0, type: "triangle", peak: 0.15, attack: 0.005, release: 0.9 });

    // C-E-G-B-C ascending arpeggio
    const arp: Array<[number, number]> = [
      [523.25, 0.28],  // C5
      [659.25, 0.46],  // E5
      [783.99, 0.64],  // G5
      [987.77, 0.82],  // B5
      [1046.5, 1.05],  // C6 resolution
    ];
    for (const [freq, start] of arp) {
      scheduleNote(ctx, bus, { freq, startOffset: start, duration: 0.55, type: "triangle", peak: 0.28, attack: 0.015, release: 0.45 });
      // Subtle octave-up shimmer one beat behind
      scheduleNote(ctx, bus, { freq: freq * 2, startOffset: start + 0.02, duration: 0.4, type: "sine", peak: 0.08, attack: 0.01, release: 0.35 });
    }

    // Sustained pad to fill the 3-second window
    scheduleNote(ctx, bus, { freq: 523.25, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.18, attack: 0.25, release: 1.4 });
    scheduleNote(ctx, bus, { freq: 783.99, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.14, attack: 0.25, release: 1.4, detune: 4 });
    scheduleNote(ctx, bus, { freq: 1046.5, startOffset: 1.6, duration: 1.4, type: "triangle", peak: 0.18, attack: 0.20, release: 1.2 });
  };
  if (!unlocked) {
    pendingPlays.set("new-order", run);
    tryUnlock();
    return;
  }
  run();
}

/**
 * Lighter 3-second chime for generic notifications (waiter calls, system
 * alerts, ops events). Two-note major-third ping with a soft tail.
 */
export function playNotificationChime(): void {
  if (!isSoundEnabled()) return;
  if (rateLimited("notification", 3200)) return;
  const run = () => {
    const ctx = getCtx();
    if (!ctx) return;
    const bus = buildBus(ctx, 0.75, 2.9);

    // Ping 1 — E5
    scheduleNote(ctx, bus, { freq: 659.25, startOffset: 0.00, duration: 0.7, type: "sine",     peak: 0.32, attack: 0.005, release: 0.55 });
    scheduleNote(ctx, bus, { freq: 1318.5, startOffset: 0.00, duration: 0.5, type: "sine",     peak: 0.10, attack: 0.005, release: 0.45 });

    // Ping 2 — G5 (minor third up)
    scheduleNote(ctx, bus, { freq: 783.99, startOffset: 0.32, duration: 0.8, type: "triangle", peak: 0.30, attack: 0.01, release: 0.65 });
    scheduleNote(ctx, bus, { freq: 1568.0, startOffset: 0.32, duration: 0.55, type: "sine",    peak: 0.10, attack: 0.005, release: 0.5 });

    // Soft pad tail to fill 3s
    scheduleNote(ctx, bus, { freq: 523.25, startOffset: 0.9, duration: 2.0, type: "sine", peak: 0.12, attack: 0.35, release: 1.5 });
    scheduleNote(ctx, bus, { freq: 783.99, startOffset: 1.0, duration: 1.8, type: "sine", peak: 0.10, attack: 0.35, release: 1.4, detune: -3 });
  };
  if (!unlocked) {
    pendingPlays.set("notification", run);
    tryUnlock();
    return;
  }
  run();
}

/**
 * Quick preview helper — used by the settings UI so a user can hear the
 * tone before flipping the switch.
 */
export function previewChime(kind: "new-order" | "notification"): void {
  // Bypass rate limit for explicit user preview.
  lastPlay = {};
  if (kind === "new-order") playNewOrderChime();
  else playNotificationChime();
}
