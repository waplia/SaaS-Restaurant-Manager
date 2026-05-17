const TOKEN_KEY = "tt_wallet_token";

export function getToken(): string | null {
  return typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const url = path.startsWith("http") ? path : `/api${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string")
      ? (body as { error: string }).error
      : `Request failed (${res.status})`;
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const fmtMoney = (val: number | string | null | undefined, currency = "INR"): string => {
  const n = Number(val ?? 0);
  if (!isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
};

export const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
