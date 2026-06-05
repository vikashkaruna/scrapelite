// utils.js — small pure helpers shared across screens.

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

export function pathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

export function isExternal(href, base) {
  try {
    return new URL(href).hostname.replace(/^www\./, "") !== hostOf(base);
  } catch {
    return false;
  }
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const day = 86400;
  if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + "m ago";
  if (diff < day) return Math.round(diff / 3600) + "h ago";
  if (diff < day * 7) return Math.round(diff / day) + "d ago";
  return fmtDate(iso);
}

// deterministic hue from a string — used for favicon dots
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function snippet(text, n = 130) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).replace(/\s+\S*$/, "") + "…" : text;
}

export function uid() {
  return "ex_" + Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3);
}

// Validate a user-typed URL (scheme optional) and normalize it to include https://.
export function isValidUrl(value) {
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(String(value).trim());
}

export function normalizeUrl(value) {
  let u = String(value).trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// ── Email helpers (for emailing selected extractions) ────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value).trim());
}

// Split a free-text field (commas, spaces, semicolons, newlines) into unique
// valid / invalid email lists. Used by the "Send email" recipient input.
export function parseEmails(value) {
  const parts = String(value)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (isValidEmail(p) ? valid : invalid).push(p);
  }
  return { valid, invalid };
}

// Build a CSV string from an extraction (headings + links).
export function extractionToCsv(extraction) {
  const rows = [["type", "tag", "text", "href"]];
  (extraction.headings || []).forEach((h) => rows.push(["heading", h.tag, h.text, ""]));
  (extraction.links || []).forEach((l) => rows.push(["link", "", l.text, l.href]));
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

// Trigger a browser download of an extraction as CSV.
export function csvDownload(extraction) {
  const csv = extractionToCsv(extraction);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `scrapelite-${hostOf(extraction.url)}-${extraction.id || "export"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
