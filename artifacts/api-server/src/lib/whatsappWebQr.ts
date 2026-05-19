/**
 * Task #506 — WhatsApp Web QR session manager.
 *
 * Manages one Baileys connection per restaurant, in process. Persists the
 * encrypted session creds to whatsapp_sessions.sessionState so a server
 * restart can attempt to resume without re-scanning a QR code.
 *
 * Baileys is loaded via dynamic `import()` so the API server still builds
 * and runs in environments where the optional dependency is not installed.
 * If the library cannot load, sessions move to status="library_unavailable"
 * and any send through this provider returns reason="no_session".
 *
 * Replit dev environment caveat: long-running Web QR sockets require a
 * persistent server process. The Replit dev preview frequently sleeps and
 * restarts, which will drop the socket. Use the Cloud API provider for
 * production deployments unless your hosting guarantees long-lived
 * processes (and even then, treat Web QR as best-effort).
 */
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import {
  db,
  whatsappSessionsTable,
  whatsappSessionLogsTable,
  type WhatsAppSession,
} from "./db";
import { logger } from "./logger";
import { broadcastEvent } from "./socketio";

function authDirFor(restaurantId: number): string {
  return `${process.env.WA_WEB_QR_AUTH_DIR ?? ".wa-sessions"}/restaurant-${restaurantId}`;
}

async function clearAuthDir(restaurantId: number): Promise<void> {
  try { await rm(authDirFor(restaurantId), { recursive: true, force: true }); }
  catch (err) { logger.warn({ err, restaurantId }, "[whatsapp:web-qr] failed to clear auth dir"); }
}

export type WebQrStatus =
  | "disconnected"
  | "qr_pending"
  | "connecting"
  | "connected"
  | "failed"
  | "library_unavailable"
  | "force_disconnected";

interface LiveSession {
  restaurantId: number;
  status: WebQrStatus;
  qr?: string;
  qrExpiresAt?: Date;
  phone?: string;
  profileName?: string;
  deviceId?: string;
  lastError?: string;
  client?: unknown;
  endClient?: () => Promise<void> | void;
}

const sessions = new Map<number, LiveSession>();

// ─── Baileys loader (optional) ───────────────────────────────────────

let baileysModule: Record<string, unknown> | null | undefined;
async function loadBaileys(): Promise<Record<string, unknown> | null> {
  if (baileysModule !== undefined) return baileysModule;
  try {
    // The dependency is intentionally optional; the await import is wrapped
    // so a missing package only degrades the Web QR provider, not the whole API.
    const mod = await import("@whiskeysockets/baileys").catch(() => null);
    baileysModule = (mod as Record<string, unknown> | null) ?? null;
    return baileysModule;
  } catch {
    baileysModule = null;
    return null;
  }
}

export async function isWebQrLibraryAvailable(): Promise<boolean> {
  const mod = await loadBaileys();
  return !!mod;
}

// ─── Persistence helpers ─────────────────────────────────────────────

async function loadRow(restaurantId: number): Promise<WhatsAppSession | null> {
  const [row] = await db.select().from(whatsappSessionsTable)
    .where(eq(whatsappSessionsTable.restaurantId, restaurantId));
  return row ?? null;
}

async function upsertRow(restaurantId: number, patch: Partial<WhatsAppSession>): Promise<WhatsAppSession> {
  const existing = await loadRow(restaurantId);
  if (existing) {
    const [row] = await db.update(whatsappSessionsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(whatsappSessionsTable.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(whatsappSessionsTable).values({
    restaurantId,
    status: patch.status ?? "disconnected",
    ...patch,
  }).returning();
  return row;
}

async function logEvent(restaurantId: number, sessionId: number | null, event: string, detail?: string | null, actorUserId?: number | null): Promise<void> {
  await db.insert(whatsappSessionLogsTable).values({
    restaurantId, sessionId, event, detail: detail ?? null, actorUserId: actorUserId ?? null, meta: {},
  }).catch(err => logger.warn({ err, event }, "[whatsapp:web-qr] failed to write session log"));
}

function emit(restaurantId: number, event: string, data: unknown): void {
  try { broadcastEvent(restaurantId, event, data); } catch { /* socket not yet ready */ }
}

function setLive(restaurantId: number, patch: Partial<LiveSession>): LiveSession {
  const prev = sessions.get(restaurantId) ?? { restaurantId, status: "disconnected" as WebQrStatus };
  const next = { ...prev, ...patch };
  sessions.set(restaurantId, next);
  return next;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface SessionPublicView {
  restaurantId: number;
  status: WebQrStatus;
  phone: string | null;
  profileName: string | null;
  qrPayload: string | null;
  qrExpiresAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
}

export async function getPublicSessionView(restaurantId: number): Promise<SessionPublicView> {
  const row = await loadRow(restaurantId);
  const live = sessions.get(restaurantId);
  const status = (live?.status ?? row?.status ?? "disconnected") as WebQrStatus;
  return {
    restaurantId,
    status,
    phone: live?.phone ?? row?.phone ?? null,
    profileName: live?.profileName ?? row?.profileName ?? null,
    qrPayload: live?.qr ?? row?.qrPayload ?? null,
    qrExpiresAt: (live?.qrExpiresAt ?? row?.qrExpiresAt)?.toISOString() ?? null,
    lastConnectedAt: row?.lastConnectedAt?.toISOString() ?? null,
    lastDisconnectedAt: row?.lastDisconnectedAt?.toISOString() ?? null,
    lastError: live?.lastError ?? row?.lastError ?? null,
  };
}

export async function listAllSessions(): Promise<Array<WhatsAppSession & { live: boolean }>> {
  const rows = await db.select().from(whatsappSessionsTable);
  return rows.map(r => ({ ...r, live: sessions.has(r.restaurantId) }));
}

/** Start (or restart) a Web QR session. Resolves once QR is emitted or library is unavailable. */
export async function startSession(restaurantId: number, actorUserId: number | null): Promise<SessionPublicView> {
  const mod = await loadBaileys();
  if (!mod) {
    setLive(restaurantId, { status: "library_unavailable", lastError: "Web QR library (@whiskeysockets/baileys) is not installed on this server." });
    const row = await upsertRow(restaurantId, {
      status: "library_unavailable",
      lastError: "Web QR library not installed",
      qrPayload: null,
      qrExpiresAt: null,
    });
    await logEvent(restaurantId, row.id, "library_unavailable", "Baileys not installed", actorUserId);
    emit(restaurantId, "whatsapp:status", { status: "library_unavailable" });
    return getPublicSessionView(restaurantId);
  }

  // Tear down any existing live socket before starting a fresh one.
  const existing = sessions.get(restaurantId);
  if (existing?.endClient) {
    try { await existing.endClient(); } catch { /* ignore */ }
  }
  setLive(restaurantId, { status: "connecting", qr: undefined, qrExpiresAt: undefined, lastError: undefined });
  emit(restaurantId, "whatsapp:status", { status: "connecting" });

  try {
    // Lazy access — types are intentionally loose since the dependency may be absent at compile time.
    const makeWASocket = (mod.default ?? mod.makeWASocket) as unknown as (opts: Record<string, unknown>) => Record<string, unknown>;
    const useAuthState = (mod.useMultiFileAuthState ?? mod.useSingleFileAuthState) as unknown as (path: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
    if (typeof makeWASocket !== "function" || typeof useAuthState !== "function") {
      throw new Error("Baileys module is missing expected exports");
    }
    // If the previous attempt ended in a hard failure or the device was
    // unlinked from the phone, the cached creds will keep producing
    // "Connection Failure" forever. Clear them before re-pairing.
    const prevRow = await loadRow(restaurantId);
    if (prevRow && (prevRow.status === "failed" || prevRow.status === "force_disconnected"
      || (prevRow.status === "disconnected" && prevRow.lastError && /connection failure|logged.?out|401/i.test(prevRow.lastError)))) {
      await clearAuthDir(restaurantId);
      await upsertRow(restaurantId, { deviceId: null, phone: null, profileName: null });
    }
    const { state, saveCreds } = await useAuthState(authDirFor(restaurantId));
    const sock = makeWASocket({ auth: state, printQRInTerminal: false });
    setLive(restaurantId, { client: sock, endClient: async () => {
      const end = (sock as { end?: (err?: Error) => void }).end;
      if (typeof end === "function") end();
    } });

    const ev = (sock as { ev: { on: (event: string, cb: (...args: unknown[]) => void) => void } }).ev;
    ev.on("creds.update", () => { void saveCreds(); });
    ev.on("connection.update", async (update: unknown) => {
      const u = update as { connection?: string; qr?: string; lastDisconnect?: { error?: { message?: string } } };
      if (u.qr) {
        const expiresAt = new Date(Date.now() + 20_000);
        setLive(restaurantId, { status: "qr_pending", qr: u.qr, qrExpiresAt: expiresAt });
        const row = await upsertRow(restaurantId, { status: "qr_pending", qrPayload: u.qr, qrExpiresAt: expiresAt });
        await logEvent(restaurantId, row.id, "qr_generated");
        emit(restaurantId, "whatsapp:qr", { qr: u.qr, expiresAt: expiresAt.toISOString() });
        emit(restaurantId, "whatsapp:status", { status: "qr_pending" });
      }
      if (u.connection === "open") {
        const me = (sock as { user?: { id?: string; name?: string } }).user;
        const phone = me?.id?.split(":")[0] ?? null;
        const profileName = me?.name ?? null;
        setLive(restaurantId, { status: "connected", qr: undefined, qrExpiresAt: undefined, phone: phone ?? undefined, profileName: profileName ?? undefined, deviceId: me?.id ?? undefined });
        const row = await upsertRow(restaurantId, {
          status: "connected", phone, profileName, deviceId: me?.id ?? null,
          qrPayload: null, qrExpiresAt: null, lastConnectedAt: new Date(), lastHeartbeatAt: new Date(),
        });
        await logEvent(restaurantId, row.id, "connected", phone ?? undefined);
        emit(restaurantId, "whatsapp:status", { status: "connected", phone, profileName });
      }
      if (u.connection === "close") {
        const errInfo = u.lastDisconnect?.error as { message?: string; output?: { statusCode?: number } } | undefined;
        const errMsg = errInfo?.message ?? "closed";
        const statusCode = errInfo?.output?.statusCode;
        // 515 = restartRequired — Baileys/WhatsApp always closes the socket
        // immediately after a fresh QR pairing completes, expecting the
        // client to reconnect with the saved creds. This is a SUCCESS path,
        // not a failure — auto-restart without clearing auth.
        if (statusCode === 515 || /stream errored|restart required/i.test(errMsg)) {
          await logEvent(restaurantId, (await loadRow(restaurantId))?.id ?? 0, "restart_required", errMsg);
          emit(restaurantId, "whatsapp:status", { status: "connecting" });
          setLive(restaurantId, { status: "connecting", lastError: undefined });
          setTimeout(() => { void startSession(restaurantId, null); }, 250);
          return;
        }
        // 401 = loggedOut, 403 = forbidden, 405 = unauthorized device — all
        // permanent: the cached creds are dead and any reconnect attempt
        // will repeat "Connection Failure". Clear the auth dir so the next
        // user-initiated start can issue a fresh QR.
        const isPermanent = statusCode === 401 || statusCode === 403 || statusCode === 405
          || /connection failure|logged.?out/i.test(errMsg);
        if (isPermanent) await clearAuthDir(restaurantId);
        setLive(restaurantId, { status: "disconnected", lastError: errMsg });
        const row = await upsertRow(restaurantId, {
          status: "disconnected",
          lastError: errMsg,
          lastDisconnectedAt: new Date(),
          ...(isPermanent ? { deviceId: null, phone: null, profileName: null } : {}),
        });
        await logEvent(restaurantId, row.id, "disconnected", errMsg);
        emit(restaurantId, "whatsapp:status", { status: "disconnected", error: errMsg });
      }
    });
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err, restaurantId }, "[whatsapp:web-qr] startSession failed");
    setLive(restaurantId, { status: "failed", lastError: msg });
    const row = await upsertRow(restaurantId, { status: "failed", lastError: msg });
    await logEvent(restaurantId, row.id, "start_failed", msg, actorUserId);
    emit(restaurantId, "whatsapp:status", { status: "failed", error: msg });
  }

  return getPublicSessionView(restaurantId);
}

export async function disconnectSession(restaurantId: number, actorUserId: number | null, force = false): Promise<void> {
  const live = sessions.get(restaurantId);
  if (live?.endClient) {
    try { await live.endClient(); } catch { /* ignore */ }
  }
  sessions.delete(restaurantId);
  const status: WebQrStatus = force ? "force_disconnected" : "disconnected";
  const row = await upsertRow(restaurantId, {
    status,
    qrPayload: null, qrExpiresAt: null,
    lastDisconnectedAt: new Date(),
  });
  await logEvent(restaurantId, row.id, force ? "force_disconnected" : "disconnected", null, actorUserId);
  emit(restaurantId, "whatsapp:status", { status });
}

export async function sendTextViaWebQr(restaurantId: number, to: string, body: string): Promise<{ messageId: string | null }> {
  const live = sessions.get(restaurantId);
  if (!live || live.status !== "connected" || !live.client) {
    throw new Error("no_session");
  }
  const sock = live.client as { sendMessage?: (jid: string, content: { text: string }) => Promise<{ key?: { id?: string } }> };
  if (typeof sock.sendMessage !== "function") throw new Error("no_session");
  const norm = to.replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
  if (!norm) throw new Error("Invalid recipient");
  const jid = `${norm}@s.whatsapp.net`;
  const result = await sock.sendMessage(jid, { text: body });
  // Heartbeat — surfaces session liveness on the super-admin dashboard.
  await upsertRow(restaurantId, { lastHeartbeatAt: new Date() });
  return { messageId: result?.key?.id ?? null };
}

export function isSessionConnected(restaurantId: number): boolean {
  return sessions.get(restaurantId)?.status === "connected";
}

/** Attempt to restore previously-connected sessions on server boot. Best-effort. */
export async function resumePersistedSessions(): Promise<void> {
  const rows = await db.select().from(whatsappSessionsTable);
  for (const row of rows) {
    if (row.status === "connected" || row.status === "qr_pending" || row.status === "connecting") {
      logger.info({ restaurantId: row.restaurantId }, "[whatsapp:web-qr] resuming persisted session");
      void startSession(row.restaurantId, null);
    }
  }
}
