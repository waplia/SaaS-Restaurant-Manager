#!/usr/bin/env node
/**
 * Offline synthesiser that produces two WAV chimes matching the web
 * implementation in `restaurant-platform/src/lib/notificationSound.ts`.
 *
 *   - new-order.wav     -> playNewOrderChime() (triumphant 3s arpeggio)
 *   - notification.wav  -> playNotificationChime() (soft 2-note ping)
 *
 * Same oscillator frequencies, envelopes, lowpass and feedback-delay
 * "reverb" tail as the WebAudio version, rendered to 44.1kHz mono int16
 * WAV so iOS / Android can play them straight from the bundle as a push
 * notification sound.
 *
 * Re-run after any tweak to the web chimes:
 *   pnpm --filter @workspace/tabletrack-mobile run sounds:gen
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const DURATION = 3.2; // seconds of canvas (web tails out around 3s)
const N = Math.floor(SR * DURATION);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "assets", "sounds");

function makeBuffer() {
  return new Float32Array(N);
}

function scheduleNote(buf, opts) {
  const {
    freq,
    startOffset,
    duration,
    type = "sine",
    peak = 0.25,
    attack = 0.02,
    release = 0.25,
    detune = 0,
  } = opts;
  const f = freq * Math.pow(2, detune / 1200);
  const start = Math.floor(startOffset * SR);
  const len = Math.floor(duration * SR);
  const aSamp = Math.max(1, Math.floor(attack * SR));
  const rSamp = Math.max(1, Math.floor(release * SR));
  const sustainEnd = Math.max(aSamp, len - rSamp);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    let env;
    if (i < aSamp) {
      const t = i / aSamp;
      env = 0.0001 * Math.pow(peak / 0.0001, t);
    } else if (i < sustainEnd) {
      env = peak;
    } else {
      const t = (i - sustainEnd) / rSamp;
      env = peak * Math.pow(0.0001 / peak, t);
    }
    let sample;
    if (type === "triangle") {
      const x = ((f * i) / SR) % 1;
      sample = 4 * Math.abs(x - 0.5) - 1;
    } else {
      sample = Math.sin(2 * Math.PI * f * (i / SR));
    }
    buf[idx] += env * sample;
  }
}

function applyLowpass(buf, cutoff) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / SR;
  const a = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    prev = prev + a * (buf[i] - prev);
    buf[i] = prev;
  }
}

function applyFeedbackDelay(buf, delaySec, feedback, wet) {
  const dSamp = Math.max(1, Math.floor(delaySec * SR));
  const delayLine = new Float32Array(buf.length);
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const d = i >= dSamp ? delayLine[i - dSamp] : 0;
    delayLine[i] = buf[i] + d * feedback;
    out[i] = buf[i] + d * wet;
  }
  for (let i = 0; i < buf.length; i++) buf[i] = out[i];
}

function normalize(buf, target = 0.95) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > peak) peak = v;
  }
  if (peak === 0) return;
  const scale = target / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= scale;
}

function writeWav(filename, samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.floor(s * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, buffer);
}

// ─── new-order chime — mirrors playNewOrderChime() ───────────────────────
{
  const buf = makeBuffer();
  // Opening bell-like strike: fundamental + octave + fifth
  scheduleNote(buf, { freq: 1046.5, startOffset: 0, duration: 1.4, type: "sine",     peak: 0.45, attack: 0.005, release: 1.2 });
  scheduleNote(buf, { freq: 2093.0, startOffset: 0, duration: 1.1, type: "sine",     peak: 0.18, attack: 0.005, release: 1.0 });
  scheduleNote(buf, { freq: 1568.0, startOffset: 0, duration: 1.0, type: "triangle", peak: 0.15, attack: 0.005, release: 0.9 });
  // C-E-G-B-C ascending arpeggio with octave shimmer
  const arp = [
    [523.25, 0.28],
    [659.25, 0.46],
    [783.99, 0.64],
    [987.77, 0.82],
    [1046.5, 1.05],
  ];
  for (const [freq, start] of arp) {
    scheduleNote(buf, { freq, startOffset: start, duration: 0.55, type: "triangle", peak: 0.28, attack: 0.015, release: 0.45 });
    scheduleNote(buf, { freq: freq * 2, startOffset: start + 0.02, duration: 0.4, type: "sine", peak: 0.08, attack: 0.01, release: 0.35 });
  }
  // Sustained pad to fill the 3s window
  scheduleNote(buf, { freq: 523.25, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.18, attack: 0.25, release: 1.4 });
  scheduleNote(buf, { freq: 783.99, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.14, attack: 0.25, release: 1.4, detune: 4 });
  scheduleNote(buf, { freq: 1046.5, startOffset: 1.6, duration: 1.4, type: "triangle", peak: 0.18, attack: 0.20, release: 1.2 });
  applyLowpass(buf, 5200);
  applyFeedbackDelay(buf, 0.18, 0.32, 0.35);
  for (let i = 0; i < buf.length; i++) buf[i] *= 0.9; // master gain
  normalize(buf, 0.95);
  writeWav(path.join(OUT_DIR, "new-order.wav"), buf);
  console.log(`✓ wrote ${path.relative(process.cwd(), path.join(OUT_DIR, "new-order.wav"))}`);
}

// ─── notification chime — mirrors playNotificationChime() ─────────────────
{
  const buf = makeBuffer();
  // Ping 1 — E5
  scheduleNote(buf, { freq: 659.25, startOffset: 0,    duration: 0.7,  type: "sine",     peak: 0.32, attack: 0.005, release: 0.55 });
  scheduleNote(buf, { freq: 1318.5, startOffset: 0,    duration: 0.5,  type: "sine",     peak: 0.10, attack: 0.005, release: 0.45 });
  // Ping 2 — G5
  scheduleNote(buf, { freq: 783.99, startOffset: 0.32, duration: 0.8,  type: "triangle", peak: 0.30, attack: 0.01,  release: 0.65 });
  scheduleNote(buf, { freq: 1568.0, startOffset: 0.32, duration: 0.55, type: "sine",     peak: 0.10, attack: 0.005, release: 0.5 });
  // Soft pad tail
  scheduleNote(buf, { freq: 523.25, startOffset: 0.9,  duration: 2.0,  type: "sine",     peak: 0.12, attack: 0.35,  release: 1.5 });
  scheduleNote(buf, { freq: 783.99, startOffset: 1.0,  duration: 1.8,  type: "sine",     peak: 0.10, attack: 0.35,  release: 1.4, detune: -3 });
  applyLowpass(buf, 5200);
  applyFeedbackDelay(buf, 0.18, 0.32, 0.35);
  for (let i = 0; i < buf.length; i++) buf[i] *= 0.75;
  normalize(buf, 0.9);
  writeWav(path.join(OUT_DIR, "notification.wav"), buf);
  console.log(`✓ wrote ${path.relative(process.cwd(), path.join(OUT_DIR, "notification.wav"))}`);
}
