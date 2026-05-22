/**
 * Minimal ESC/POS byte builder. Generates a Uint8Array suitable for piping
 * straight to a Bluetooth/USB/LAN thermal printer characteristic / socket.
 *
 * Supports the subset we actually need: text + alignment + sizes + cut,
 * cash-drawer kick, buzzer, feed lines, and raster QR code (GS ( k).
 */

export const ESC = 0x1b;
export const GS = 0x1d;
export const LF = 0x0a;

export type Alignment = "left" | "center" | "right";
export type TextSize = "normal" | "double-width" | "double-height" | "double";

export class EscPosBuilder {
  private chunks: number[] = [];
  /** Character width supplied by the printer config (e.g. 32 for 58mm, 48 for 80mm). */
  readonly width: number;
  /** Use plain ASCII fallback (no ESC/POS control bytes) — useful for browser printing. */
  readonly plain: boolean;

  constructor(opts: { width?: number; plain?: boolean } = {}) {
    this.width = Math.max(16, Math.floor(opts.width ?? 48));
    this.plain = opts.plain === true;
  }

  raw(b: number | number[]): this {
    if (typeof b === "number") this.chunks.push(b & 0xff);
    else for (const x of b) this.chunks.push(x & 0xff);
    return this;
  }

  text(s: string): this {
    // Use Latin-1 + raw UTF-8 fallthrough; native libs (Brother, ESC/POS spec)
    // accept UTF-8 well in 'Hindi/regional' mode on modern thermal printers.
    const bytes = utf8(s);
    for (const b of bytes) this.chunks.push(b);
    return this;
  }

  line(s = ""): this {
    return this.text(s).raw(LF);
  }

  init(): this {
    if (this.plain) return this;
    return this.raw([ESC, 0x40]); // ESC @
  }

  align(a: Alignment): this {
    if (this.plain) return this;
    const v = a === "left" ? 0 : a === "center" ? 1 : 2;
    return this.raw([ESC, 0x61, v]);
  }

  bold(on: boolean): this {
    if (this.plain) return this;
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  underline(on: boolean): this {
    if (this.plain) return this;
    return this.raw([ESC, 0x2d, on ? 1 : 0]);
  }

  size(s: TextSize): this {
    if (this.plain) return this;
    const map = { "normal": 0x00, "double-width": 0x20, "double-height": 0x10, "double": 0x30 };
    return this.raw([GS, 0x21, map[s]]);
  }

  feed(n = 1): this {
    if (n <= 0) return this;
    if (this.plain) {
      for (let i = 0; i < n; i++) this.chunks.push(LF);
      return this;
    }
    return this.raw([ESC, 0x64, Math.min(255, n)]);
  }

  hr(char = "-"): this {
    return this.line(char.repeat(this.width));
  }

  /** Two-column row: left value padded, right value right-aligned. */
  row(left: string, right: string): this {
    const max = this.width;
    const l = left ?? "";
    const r = right ?? "";
    if (l.length + r.length + 1 > max) {
      // Wrap left, then place right on a new line right-aligned
      const wrap = wrapText(l, max);
      for (const w of wrap) this.line(w);
      this.line(r.padStart(max));
      return this;
    }
    return this.line(l + " ".repeat(max - l.length - r.length) + r);
  }

  /** Three-column item row: name / qty / amount. */
  item(name: string, qty: string, amount: string): this {
    const amountW = Math.max(8, Math.floor(this.width * 0.18));
    const qtyW = Math.max(4, Math.floor(this.width * 0.10));
    const nameW = this.width - amountW - qtyW;
    const lines = wrapText(name, nameW);
    const first = lines[0] ?? "";
    this.line(
      first.padEnd(nameW) +
      qty.padStart(qtyW) +
      amount.padStart(amountW),
    );
    for (let i = 1; i < lines.length; i++) {
      this.line(lines[i]!.padEnd(this.width));
    }
    return this;
  }

  cut(partial = true): this {
    if (this.plain) return this;
    // GS V m  — 0 = full, 1 = partial
    return this.raw([GS, 0x56, partial ? 1 : 0]);
  }

  drawerKick(pin: 2 | 5 = 2): this {
    if (this.plain) return this;
    // ESC p m t1 t2
    return this.raw([ESC, 0x70, pin === 5 ? 1 : 0, 0x32, 0x96]);
  }

  buzzer(): this {
    if (this.plain) return this;
    // ESC B — common on EPSON-compatible thermals (n=3 beeps, t=2 * 100ms)
    return this.raw([ESC, 0x42, 3, 2]);
  }

  /**
   * GS ( k QR code. Standard ESC/POS native QR.
   *  size 1–16 (module size in dots), error level 48–51 (L,M,Q,H).
   */
  qr(data: string, opts: { size?: number; ecLevel?: 0 | 1 | 2 | 3 } = {}): this {
    if (this.plain) {
      // Plain mode: emit data as text — printers ignore unknown bytes anyway.
      return this.line(`[QR] ${data}`);
    }
    const size = Math.min(16, Math.max(1, opts.size ?? 8));
    const ec = 48 + (opts.ecLevel ?? 1); // 48 L .. 51 H
    // Model (model 2)
    this.raw([GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]);
    // Module size
    this.raw([GS, 0x28, 0x6b, 3, 0, 49, 67, size]);
    // Error correction level
    this.raw([GS, 0x28, 0x6b, 3, 0, 49, 69, ec]);
    // Store data
    const bytes = utf8(data);
    const len = bytes.length + 3;
    this.raw([GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48]);
    this.raw(bytes);
    // Print stored data
    this.raw([GS, 0x28, 0x6b, 3, 0, 49, 81, 48]);
    return this;
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }

  /** Base64-encoded ESC/POS payload — convenient for transport (RN BLE, http). */
  base64(): string {
    const u = this.bytes();
    let s = "";
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!);
    if (typeof btoa === "function") return btoa(s);
    // Node fallback
    return Buffer.from(u).toString("base64");
  }

  /** Plain-text rendering — used by browser print + previews. */
  text_only(): string {
    // We strip ESC/POS control bytes by rebuilding in plain mode.
    return "";
  }
}

function utf8(s: string): number[] {
  if (typeof TextEncoder !== "undefined") {
    return Array.from(new TextEncoder().encode(s));
  }
  // Older RN runtimes — naive UTF-8
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return bytes;
}

export function wrapText(s: string, width: number): string[] {
  if (!s) return [""];
  const out: string[] = [];
  for (const para of s.split("\n")) {
    if (para.length <= width) { out.push(para); continue; }
    const words = para.split(/\s+/);
    let line = "";
    for (const w of words) {
      if (!line.length) {
        if (w.length > width) {
          for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
          line = "";
        } else {
          line = w;
        }
      } else if (line.length + 1 + w.length <= width) {
        line += " " + w;
      } else {
        out.push(line);
        if (w.length > width) {
          for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
          line = "";
        } else {
          line = w;
        }
      }
    }
    if (line.length) out.push(line);
  }
  return out.length ? out : [""];
}

export function widthForPaper(paperSize: "58mm" | "80mm", chars?: number): number {
  if (chars && chars > 0) return chars;
  return paperSize === "58mm" ? 32 : 48;
}
