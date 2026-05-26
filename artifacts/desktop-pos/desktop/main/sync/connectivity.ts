/**
 * Online/offline detector.
 *
 * Pings `GET /api/healthz` on the configured API base URL every 10s. The
 * resulting state is emitted to subscribers (the IPC layer broadcasts it to
 * the renderer over `connectivity:state`).
 */

import { EventEmitter } from "node:events";

export interface ConnectivityState {
  online: boolean;
  lastCheckedAt: number | null;
  /** Round-trip time in ms (only on success). */
  latencyMs: number | null;
  /** Reason the last probe failed, if any. */
  error: string | null;
}

const POLL_MS = 10_000;
const PROBE_TIMEOUT_MS = 4_000;

export class Connectivity extends EventEmitter {
  private state: ConnectivityState = { online: false, lastCheckedAt: null, latencyMs: null, error: null };
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private baseUrlProvider: () => string) {
    super();
  }

  start(): void {
    if (this.timer) return;
    // First probe is immediate so the UI doesn't sit at "offline" for 10s.
    void this.probe();
    this.timer = setInterval(() => void this.probe(), POLL_MS);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  current(): ConnectivityState {
    return { ...this.state };
  }

  /** Force a probe (used by the renderer's "Sync now" button). */
  async probe(): Promise<ConnectivityState> {
    if (this.inFlight) return this.state;
    this.inFlight = true;
    const baseUrl = this.baseUrlProvider().replace(/\/+$/, "");
    // The server mounts all routes (including healthz) behind `/api`; a bare
    // `/healthz` would 404 and we'd report offline even with a live server.
    const url = `${baseUrl.replace(/\/+$/, "")}/api/healthz`;
    const started = Date.now();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const r = await fetch(url, { method: "GET", signal: controller.signal });
      const ok = r.ok;
      const latency = Date.now() - started;
      this.update({
        online: ok,
        lastCheckedAt: Date.now(),
        latencyMs: ok ? latency : null,
        error: ok ? null : `HTTP ${r.status}`,
      });
    } catch (err) {
      this.update({
        online: false,
        lastCheckedAt: Date.now(),
        latencyMs: null,
        error: (err as Error).message,
      });
    } finally {
      clearTimeout(t);
      this.inFlight = false;
    }
    return this.state;
  }

  /** Force the state to offline (e.g. on auth-lost so the engine pauses). */
  markOffline(reason: string): void {
    this.update({ online: false, lastCheckedAt: Date.now(), latencyMs: null, error: reason });
  }

  private update(next: ConnectivityState): void {
    const changed = next.online !== this.state.online;
    this.state = next;
    if (changed) this.emit("change", next);
    this.emit("probe", next);
  }
}
