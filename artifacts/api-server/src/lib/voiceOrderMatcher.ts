/**
 * Lightweight helpers for the AI voice-order assistant.
 *
 * Responsibilities:
 *   1. Normalize Hindi/English/Hinglish number words to integers (so that
 *      transcripts like "do butter naan, teen lassi" can be parsed even if the
 *      LLM misses the digit).
 *   2. Provide a deterministic fallback that fuzzy-matches an LLM-extracted
 *      `nameGuess` against the live menu when the LLM does not return a
 *      menuItemId. This protects the POS from acting on hallucinated ids.
 */

const HINDI_EN_NUMBERS: Record<string, number> = {
  // English digits/words
  "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
  "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
  "eleven": 11, "twelve": 12, "a": 1, "an": 1,
  // Hindi (latin transliteration) — common dine-in counts
  "ek": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4,
  "paanch": 5, "panch": 5, "chhe": 6, "che": 6, "chai": 6,
  "saat": 7, "sath": 7, "aath": 8, "aat": 8, "nau": 9, "nao": 9,
  "das": 10, "dus": 10, "gyarah": 11, "barah": 12,
  // Hindi devanagari
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
  "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
};

export function wordToNumber(word: string): number | null {
  if (!word) return null;
  const k = word.trim().toLowerCase();
  if (k === "") return null;
  if (/^\d+$/.test(k)) return parseInt(k, 10);
  const v = HINDI_EN_NUMBERS[k];
  return typeof v === "number" ? v : null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

export interface MatcherMenuItem {
  id: number;
  name: string;
}

export interface MatchResult {
  item: MatcherMenuItem | null;
  /** 0..1 — higher is better. */
  score: number;
}

/**
 * Score a guess against menu items using a blend of token overlap and edit
 * distance. Returns the best match plus a confidence in [0,1].
 *
 * Empty / whitespace-only guesses score 0. A score above ~0.55 is generally
 * safe to auto-resolve in the confirmation modal; below that it should be
 * flagged as `unresolved` so the waiter picks manually.
 */
export function findBestMenuMatch(
  guess: string,
  menu: MatcherMenuItem[],
): MatchResult {
  const g = normalize(guess);
  if (!g || menu.length === 0) return { item: null, score: 0 };
  const gTokens = tokens(g);
  if (gTokens.length === 0) return { item: null, score: 0 };
  let best: MatchResult = { item: null, score: 0 };
  for (const item of menu) {
    const n = normalize(item.name);
    if (!n) continue;
    const nTokens = tokens(n);
    if (n === g) return { item, score: 1 };
    const overlap = gTokens.filter(t => nTokens.includes(t)).length;
    const overlapScore = overlap / Math.max(gTokens.length, nTokens.length);
    const dist = levenshtein(g, n);
    const distScore = 1 - dist / Math.max(g.length, n.length);
    const containsBoost = n.includes(g) || g.includes(n) ? 0.15 : 0;
    const score = Math.min(1, 0.55 * overlapScore + 0.45 * distScore + containsBoost);
    if (score > best.score) {
      best = { item, score };
    }
  }
  return best;
}
