/**
 * Barcode / QR scanner hook.
 *
 * Most USB barcode + QR scanners present as a "HID keyboard": they type the
 * scanned value into whatever has focus, very fast, and terminate with Enter.
 * We detect that pattern globally (>5 chars in <200ms ending in Enter) and
 * surface it as a structured scan event without disturbing real keyboard
 * input.
 *
 * Notes:
 *   • While a text input / textarea has focus we suppress detection so the
 *     cashier's keyboard typing isn't mis-classified as a scan.
 *   • Detection runs only while the scanner is enabled in settings.
 *   • Detected scans are also reported to main so the Hardware settings tab
 *     can show a "last 5 scans" tester.
 */

import { useEffect, useRef } from "react";

interface UseScannerOpts {
  enabled: boolean;
  /** Called with the detected scan value (already trimmed). */
  onScan: (value: string) => void;
  /** Minimum length of input string to count as a scan (default 5). */
  minLength?: number;
  /** Max inter-key gap in ms for the burst to count as a scan (default 50). */
  maxGap?: number;
}

export function useScanner({ enabled, onScan, minLength = 5, maxGap = 50 }: UseScannerOpts): void {
  const bufRef = useRef<string>("");
  const lastAtRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = tag === "input" || tag === "textarea" || (target?.isContentEditable ?? false);
      // Allow scans into hidden / non-editable elements; suppress inside fields.
      if (isEditable) {
        bufRef.current = "";
        return;
      }
      const now = performance.now();
      if (now - lastAtRef.current > maxGap * 3 && bufRef.current.length > 0) {
        bufRef.current = "";
      }
      lastAtRef.current = now;
      if (e.key === "Enter") {
        const value = bufRef.current.trim();
        bufRef.current = "";
        if (value.length >= minLength) {
          // Best-effort persist to main for the Hardware tester; don't await.
          window.khanalagao?.scanner?.recordScan?.(value).catch(() => { /* tester is optional */ });
          onScan(value);
        }
        return;
      }
      if (e.key.length === 1) {
        bufRef.current += e.key;
        // Hard cap buffer so a stuck key doesn't leak memory.
        if (bufRef.current.length > 256) bufRef.current = bufRef.current.slice(-256);
      }
    };

    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, [enabled, onScan, minLength, maxGap]);
}
