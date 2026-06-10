// currencyService.js — multi-currency conversion with daily BOD refresh at 5:00 AM IST.
// Rates are fetched from open.er-api.com and cached in localStorage.

const CACHE_KEY = "datiq.currencyRates";

// Fallback rates (USD base) — used if fetch fails and no cache exists.
const DEFAULT_RATES = { USD: 1, INR: 83.5, EUR: 0.92, GBP: 0.79, SGD: 1.34, AED: 3.67 };

// Returns the UTC timestamp for 5:00 AM IST today (or yesterday if we're before 5 AM IST).
// IST = UTC+5:30, so 5:00 AM IST = 23:30 UTC on the previous calendar day.
function bodUtcMs() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const now = new Date();
  const nowIst = new Date(now.getTime() + IST_OFFSET_MS);
  // 5:00 AM in IST on the same calendar date as nowIst
  const bodIst = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), 5, 0, 0, 0) - IST_OFFSET_MS);
  // If now is before today's BOD, use yesterday's BOD
  return now.getTime() < bodIst.getTime() ? bodIst.getTime() - 86400000 : bodIst.getTime();
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function writeCache(rates) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() })); } catch {}
}

export async function getRates() {
  const cache = readCache();
  if (cache?.fetchedAt >= bodUtcMs()) return cache.rates; // still fresh

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (res.ok) {
      const data = await res.json();
      const rates = Object.fromEntries(
        Object.keys(DEFAULT_RATES).map((k) => [k, data.rates?.[k] ?? DEFAULT_RATES[k]])
      );
      writeCache(rates);
      return rates;
    }
  } catch { /* network error — fall through */ }

  if (cache?.rates) { writeCache(cache.rates); return cache.rates; }
  return DEFAULT_RATES;
}

export function convertPrice(usdAmount, rates, currency) {
  if (!usdAmount) return 0;
  const rate = rates?.[currency] ?? DEFAULT_RATES[currency] ?? 1;
  return usdAmount * rate;
}

export function formatPrice(amount, currency) {
  const meta = { USD: "$", INR: "₹", EUR: "€", GBP: "£", SGD: "S$", AED: "AED " };
  const sym = meta[currency] ?? (currency + " ");
  if (currency === "INR") return sym + Math.round(amount).toLocaleString("en-IN");
  if (currency === "AED") return sym + Math.round(amount);
  return sym + (amount % 1 === 0 ? amount : amount.toFixed(2));
}

export function getDefaultRates() { return DEFAULT_RATES; }

// Detect currency from browser locale / timezone. Returns one of the supported
// currency codes (USD, INR, EUR, GBP, SGD, AED). Falls back to USD.
export function detectCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
    if (tz === "Europe/London" || tz === "Atlantic/Reykjavik") return "GBP";
    if (tz === "Asia/Singapore") return "SGD";
    if (tz === "Asia/Dubai" || tz === "Asia/Muscat") return "AED";
    // Europe (but not London/Reykjavik already handled)
    if (tz.startsWith("Europe/")) return "EUR";
    const lang = (navigator.language || navigator.userLanguage || "").toLowerCase();
    if (lang.endsWith("-in") || lang === "hi" || lang === "mr" || lang === "ta") return "INR";
    if (lang.endsWith("-gb")) return "GBP";
    if (lang.endsWith("-sg")) return "SGD";
    if (lang.endsWith("-ae") || lang.endsWith("-sa")) return "AED";
    if (/^(de|fr|it|es|pt-pt|nl|pl|sv|fi|da|nb|cs|sk|hu|ro)/.test(lang)) return "EUR";
    return "USD";
  } catch {
    return "USD";
  }
}
