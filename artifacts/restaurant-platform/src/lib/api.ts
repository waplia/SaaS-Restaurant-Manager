const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const API_BASE = `${BASE_URL}/api`;

const TOKEN_KEY = "tt_access_token";
const REFRESH_KEY = "tt_refresh_token";
const USER_KEY = "tt_user";

export function getApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function authHeaders(token?: string | null): HeadersInit {
  const t = token ?? getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  const res = await fetch(getApiUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event("tt:logout"));
    return null;
  }

  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.accessToken as string);
  if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken as string);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.accessToken as string;
}

async function getRefreshedToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise(resolve => { refreshQueue.push(resolve); });
  }
  isRefreshing = true;
  const token = await doRefresh();
  refreshQueue.forEach(resolve => resolve(token));
  refreshQueue = [];
  isRefreshing = false;
  return token;
}

async function request(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const res = await fetch(getApiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && !retried) {
    const newToken = await getRefreshedToken();
    if (newToken) {
      return request(path, init, true);
    }
  }

  return res;
}

export async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export async function apiAction<T = unknown>(
  path: string,
  method = "POST",
  body?: unknown,
): Promise<T> {
  const res = await request(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiAction<T>(path, "POST", body);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiAction<T>(path, "PATCH", body);
}

export async function apiDelete(path: string): Promise<void> {
  await apiAction(path, "DELETE");
}
