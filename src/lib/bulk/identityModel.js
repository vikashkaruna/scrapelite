// src/lib/bulk/identityModel.js — Canonical domain normalization and deduplication.
//
// Ensures bulk domain lists are deduplicated and clean before running credits
// or web fetches. Handles protocols, www, subpaths, trailing slashes, and ports.

/**
 * Normalizes a raw string or URL into a clean canonical domain.
 * e.g.:
 *  "https://www.stripe.com/pricing" -> "stripe.com"
 *  "app.posthog.com/" -> "app.posthog.com"
 *  "ACME CORP <info@acme.com>" -> "acme.com"
 *  "acme.com:8080" -> "acme.com"
 */
export function normalizeDomain(raw) {
  if (!raw || typeof raw !== "string") return null;
  let str = raw.trim().toLowerCase();

  // Extract from angle brackets if present: "Name <email@domain.com>"
  const bracketMatch = str.match(/<([^>]+)>/);
  if (bracketMatch) {
    str = bracketMatch[1].trim();
  }

  // If input is an email address, extract the domain
  const emailMatch = str.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (emailMatch) {
    str = emailMatch[1];
  }

  // Remove protocol
  str = str.replace(/^[a-z]+:\/\//i, "");

  // Remove auth credentials if any (user:pass@)
  if (str.includes("@")) {
    str = str.split("@").pop();
  }

  // Remove path, query string, hash
  str = str.split(/[/?#]/)[0];

  // Remove port
  str = str.split(":")[0];

  // Strip leading/trailing dots and whitespace
  str = str.replace(/^\.+|\.+$/g, "").trim();

  // Strip common generic subdomains like "www."
  if (str.startsWith("www.")) {
    str = str.slice(4);
  }

  // Basic TLD validation: must contain at least one dot with alphanumeric segments
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(str)) {
    return null;
  }

  return str;
}

/**
 * Deduplicates an array of raw input strings (CSV lines or pasted text)
 * returning canonical entries with their raw origin.
 *
 * @param {string[]|string} inputs - Array of strings or newline/comma-separated text
 * @returns {{ canonical: string, raw: string, duplicateCount: number }[]}
 */
export function dedupeEntries(inputs) {
  const lines = Array.isArray(inputs)
    ? inputs
    : String(inputs || "")
        .split(/[\r\n,]+/)
        .map((l) => l.trim())
        .filter(Boolean);

  const map = new Map();

  for (const raw of lines) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) continue;

    const canonical = normalizeDomain(trimmed);
    if (!canonical) continue;

    if (map.has(canonical)) {
      const item = map.get(canonical);
      item.duplicateCount += 1;
    } else {
      map.set(canonical, {
        canonical,
        raw: trimmed,
        duplicateCount: 1,
      });
    }
  }

  return Array.from(map.values());
}
