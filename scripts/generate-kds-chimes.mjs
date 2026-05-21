// Synthesise the same 3-second chimes the web platform plays through
// WebAudio (see artifacts/restaurant-platform/src/lib/notificationSound.ts)
// into bundled .wav files for the mobile KDS so both platforms ring
// identically. Run: `node scripts/generate-kds-chimes.mjs`.
import fs from "node:fs";
import path from "node:path";

const SR = 44100; // sample rate
const OUT_DIR = "artifacts/tabletrack-mobile/assets/sounds";

function makeBuffer(seconds) {
  return new Float32Array(Math.ceil(SR * seconds));
}

// Render one oscillator note with an ADSR-ish envelope and additive
// detune support, mirroring scheduleNote() in the web library.
function renderNote(buf, opts) {
  const { freq, startOffset, duration, type = "sine", peak = 0.25,
          attack = 0.02, release = 0.25, detune = 0 } = opts;
  const startSample = Math.floor(startOffset * SR);
  const len = Math.floor(duration * SR);
  const attackSamples = Math.max(1, Math.floor(attack * SR));
  const releaseSamples = Math.max(1, Math.floor(release * SR));
  const sustainEnd = Math.max(attackSamples, len - releaseSamples);
  const f = freq * Math.pow(2, detune / 1200);
  const twoPiF = 2 * Math.PI * f;
  for (let i = 0; i < len; i++) {
    const idx = startSample + i;
    if (idx >= buf.length) break;
    const t = i / SR;
    // Waveform
    let sample;
    const phase = (twoPiF * t) % (2 * Math.PI);
    if (type === "sine") {
      sample = Math.sin(phase);
    } else if (type === "triangle") {
      const p = phase / (2 * Math.PI);
      sample = 4 * Math.abs(p - 0.5) - 1;
    } else {
      sample = Math.sin(phase);
    }
    // Envelope — exponential ramps approximated like the WebAudio impl.
    let env;
    if (i < attackSamples) {
      const k = i / attackSamples;
      env = 0.0001 * Math.pow(peak / 0.0001, k);
    } else if (i < sustainEnd) {
      env = peak;
    } else {
      const k = (i - sustainEnd) / releaseSamples;
      env = peak * Math.pow(0.0001 / peak, k);
    }
    buf[idx] += sample * env;
  }
}

// Simple feedback delay → faux reverb tail to match the web bus.
function applyReverbTail(buf, { delayMs = 180, feedback = 0.32, wet = 0.35 } = {}) {
  const d = Math.floor((delayMs / 1000) * SR);
  const tail = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let s = 0;
    let amp = 1;
    let off = d;
    // sum decaying echoes
    while (amp > 0.001 && i - off >= 0) {
      s += buf[i - off] * amp;
      amp *= feedback;
      off += d;
    }
    tail[i] = s * wet;
  }
  for (let i = 0; i < buf.length; i++) buf[i] += tail[i];
}

// Soft lowpass via one-pole IIR (matches the lowpass on the web bus).
function applyLowpass(buf, cutoffHz = 5200) {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / SR;
  const a = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < buf.length; i++) {
    prev = prev + a * (buf[i] - prev);
    buf[i] = prev;
  }
}

function applyMaster(buf, gain) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    buf[i] *= gain;
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  // Normalise so the loudest peak sits at ~0.92 to avoid clipping.
  if (peak > 0.92) {
    const k = 0.92 / peak;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
}

function writeWav(filePath, samples) {
  const numSamples = samples.length;
  const blockAlign = 2; // mono, 16-bit
  const byteRate = SR * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);     // PCM chunk size
  buffer.writeUInt16LE(1, 20);      // PCM format
  buffer.writeUInt16LE(1, 22);      // channels
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 30);
  buffer.writeUInt16LE(16, 34);     // bits/sample
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

// === chime.wav — triumphant 3s "new order" chime (matches playNewOrderChime) ===
{
  const buf = makeBuffer(3.4);
  // Opening bell-like strike
  renderNote(buf, { freq: 1046.5, startOffset: 0.00, duration: 1.4, type: "sine",     peak: 0.45, attack: 0.005, release: 1.2 });
  renderNote(buf, { freq: 2093.0, startOffset: 0.00, duration: 1.1, type: "sine",     peak: 0.18, attack: 0.005, release: 1.0 });
  renderNote(buf, { freq: 1568.0, startOffset: 0.00, duration: 1.0, type: "triangle", peak: 0.15, attack: 0.005, release: 0.9 });
  // C-E-G-B-C ascending arpeggio with octave shimmer
  for (const [freq, start] of [[523.25, 0.28], [659.25, 0.46], [783.99, 0.64], [987.77, 0.82], [1046.5, 1.05]]) {
    renderNote(buf, { freq, startOffset: start, duration: 0.55, type: "triangle", peak: 0.28, attack: 0.015, release: 0.45 });
    renderNote(buf, { freq: freq * 2, startOffset: start + 0.02, duration: 0.4, type: "sine", peak: 0.08, attack: 0.01, release: 0.35 });
  }
  // Sustained pad to fill the 3-second window
  renderNote(buf, { freq: 523.25, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.18, attack: 0.25, release: 1.4 });
  renderNote(buf, { freq: 783.99, startOffset: 1.2, duration: 1.8, type: "sine",     peak: 0.14, attack: 0.25, release: 1.4, detune: 4 });
  renderNote(buf, { freq: 1046.5, startOffset: 1.6, duration: 1.4, type: "triangle", peak: 0.18, attack: 0.20, release: 1.2 });
  applyReverbTail(buf);
  applyLowpass(buf, 5200);
  applyMaster(buf, 0.9);
  writeWav(`${OUT_DIR}/chime.wav`, buf);
  console.log("wrote", `${OUT_DIR}/chime.wav`, buf.length, "samples");
}

// === bell.wav — softer 3s notification chime (matches playNotificationChime) ===
{
  const buf = makeBuffer(3.2);
  renderNote(buf, { freq: 659.25, startOffset: 0.00, duration: 0.7, type: "sine",     peak: 0.32, attack: 0.005, release: 0.55 });
  renderNote(buf, { freq: 1318.5, startOffset: 0.00, duration: 0.5, type: "sine",     peak: 0.10, attack: 0.005, release: 0.45 });
  renderNote(buf, { freq: 783.99, startOffset: 0.32, duration: 0.8, type: "triangle", peak: 0.30, attack: 0.01,  release: 0.65 });
  renderNote(buf, { freq: 1568.0, startOffset: 0.32, duration: 0.55, type: "sine",    peak: 0.10, attack: 0.005, release: 0.5 });
  renderNote(buf, { freq: 523.25, startOffset: 0.9, duration: 2.0, type: "sine", peak: 0.12, attack: 0.35, release: 1.5 });
  renderNote(buf, { freq: 783.99, startOffset: 1.0, duration: 1.8, type: "sine", peak: 0.10, attack: 0.35, release: 1.4, detune: -3 });
  applyReverbTail(buf);
  applyLowpass(buf, 5200);
  applyMaster(buf, 0.75);
  writeWav(`${OUT_DIR}/bell.wav`, buf);
  console.log("wrote", `${OUT_DIR}/bell.wav`, buf.length, "samples");
}

// === ding.wav — short crisp 1s ping (compact variant for staff who want
// a quicker tone). Sine pair, less reverb, no pad. ===
{
  const buf = makeBuffer(1.2);
  renderNote(buf, { freq: 880,  startOffset: 0.00, duration: 0.45, type: "sine", peak: 0.40, attack: 0.004, release: 0.40 });
  renderNote(buf, { freq: 1320, startOffset: 0.12, duration: 0.55, type: "sine", peak: 0.28, attack: 0.004, release: 0.50 });
  renderNote(buf, { freq: 1760, startOffset: 0.04, duration: 0.30, type: "sine", peak: 0.10, attack: 0.004, release: 0.25 });
  applyReverbTail(buf, { delayMs: 110, feedback: 0.22, wet: 0.22 });
  applyLowpass(buf, 6000);
  applyMaster(buf, 0.85);
  writeWav(`${OUT_DIR}/ding.wav`, buf);
  console.log("wrote", `${OUT_DIR}/ding.wav`, buf.length, "samples");
}
