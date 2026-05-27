function welcomeKey(userId: number | string | null | undefined) {
  return `kl:welcome:seen:${userId ?? "anon"}`;
}

export function markWelcomeSeen(userId: number | string | null | undefined) {
  try { localStorage.setItem(welcomeKey(userId), "1"); } catch { /* ignore */ }
}

export function hasSeenWelcome(userId: number | string | null | undefined) {
  try { return localStorage.getItem(welcomeKey(userId)) === "1"; } catch { return false; }
}
