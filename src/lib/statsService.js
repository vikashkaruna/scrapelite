// statsService.js — fetch aggregate platform stats from /api/stats.
// Results are cached in localStorage for 5 minutes.

const LS_KEY = "datiq.stats";
const TTL = 5 * 60 * 1000;

export async function getStats() {
  // Return cached data when still fresh.
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < TTL) return data;
    }
  } catch { /* ignore */ }

  // Fetch from API.
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* ignore */ }
    return data;
  } catch {
    return { teams: null, extractions: null };
  }
}

// Format a raw count for display: 1234 → "1.2K+", 12345 → "12K+", null → null.
export function fmtStat(n) {
  if (n === null || n === undefined) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 10_000) return `${Math.floor(n / 1000)}K+`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K+`;
  return `${n}+`;
}
