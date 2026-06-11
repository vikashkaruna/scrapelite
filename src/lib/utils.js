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

// Recursively flatten arbitrary JSON into [{ path, value }] leaf rows, so any
// enrichment/custom-extraction shape can be written to a flat CSV/PDF.
export function flattenJson(value, prefix = "") {
  const out = [];
  const walk = (v, path) => {
    if (v === null || v === undefined) {
      out.push({ path, value: "" });
    } else if (Array.isArray(v)) {
      if (v.length === 0) out.push({ path, value: "" });
      else v.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`));
    } else if (typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length === 0) out.push({ path, value: "" });
      else keys.forEach((k) => walk(v[k], path ? `${path}.${k}` : k));
    } else {
      out.push({ path, value: String(v) });
    }
  };
  walk(value, prefix);
  return out;
}

// All exportable rows for ONE extraction: meta + structure + every capability's
// data. Each row is [type, name, text, value]. This is the single source of
// truth for both CSV and (indirectly) the PDF export.
export function extractionRows(e) {
  const rows = [];
  rows.push(["meta", "url", e.url || "", ""]);
  rows.push(["meta", "title", e.page_title || "", ""]);
  if (e.ai_summary) rows.push(["meta", "summary", e.ai_summary, ""]);

  (e.headings || []).forEach((h) => rows.push(["heading", h.tag, h.text, ""]));
  (e.links || []).forEach((l) => rows.push(["link", l.category || "", l.text, l.href]));
  (e.domain_map || []).forEach((u) => rows.push(["mapped-url", "", "", u]));

  // Every enrichment capability, fully flattened. Fall back to a bare
  // custom_extraction if the row predates the enrichments map.
  const entries = Object.values(e.enrichments || {});
  if (entries.length) {
    for (const en of entries) {
      if (en?.data == null) continue;
      flattenJson(en.data).forEach(({ path, value }) =>
        rows.push(["enrichment", en.label || en.key, path, value]),
      );
    }
  } else if (e.custom_extraction != null) {
    flattenJson(e.custom_extraction).forEach(({ path, value }) =>
      rows.push(["custom", "Custom extraction", path, value]),
    );
  }
  return rows;
}

const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Build a CSV string from an extraction (kept for single-item callers).
export function extractionToCsv(extraction) {
  const rows = [["type", "name", "text", "value"], ...extractionRows(extraction)];
  return rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
}

// Build one combined CSV across one or more extractions, with a leading "page"
// column so rows from different extractions stay distinguishable.
export function extractionsToCsv(items) {
  const list = Array.isArray(items) ? items : [items];
  const rows = [["page", "type", "name", "text", "value"]];
  for (const e of list) {
    const page = hostOf(e.url) + (pathOf(e.url) !== "/" ? pathOf(e.url) : "");
    for (const r of extractionRows(e)) rows.push([page, ...r]);
  }
  return rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
}

// Trigger a browser file download from a Blob.
function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Download one or more extractions as a single CSV (all capabilities included).
export function csvDownload(items) {
  const list = Array.isArray(items) ? items : [items];
  const csv = extractionsToCsv(list);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.csv`
      : `datiq-export-${list.length}-pages.csv`;
  triggerDownload(blob, name);
}

// ── Markdown export ──────────────────────────────────────────────────────────

function mdEsc(text) {
  return String(text ?? "").replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

export function extractionsToMarkdown(items) {
  const list = Array.isArray(items) ? items : [items];
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const lines = [
    `# DatIQ Export — ${date}`,
    ``,
    `> Generated from [DatIQ](https://datiq.app) • ${list.length} page${list.length !== 1 ? "s" : ""}`,
    ``,
  ];

  list.forEach((e, idx) => {
    lines.push(`---`, ``);
    lines.push(`## ${idx + 1}. ${mdEsc(e.page_title || hostOf(e.url))}`, ``);
    lines.push(`**URL:** <${e.url}>  `);
    if (e.created_at) {
      lines.push(`**Extracted:** ${fmtDate(e.created_at)}  `);
    }
    lines.push(``);

    if (e.ai_summary) {
      lines.push(`### AI Summary`, ``, e.ai_summary, ``);
    }

    if (e.headings?.length) {
      lines.push(`### Headings (${e.headings.length})`, ``);
      e.headings.forEach((h) => lines.push(`- **${h.tag}** ${mdEsc(h.text)}`));
      lines.push(``);
    }

    if (e.links?.length) {
      lines.push(`### Links (${e.links.length})`, ``);
      e.links.slice(0, 50).forEach((l) => {
        const label = mdEsc(l.text || l.href);
        const cat = l.category ? ` — ${l.category}` : "";
        lines.push(`- [${label}](${l.href})${cat}`);
      });
      if (e.links.length > 50) lines.push(`- *…and ${e.links.length - 50} more*`);
      lines.push(``);
    }

    if (e.domain_map?.length) {
      lines.push(`### Mapped URLs (${e.domain_map.length})`, ``);
      e.domain_map.slice(0, 100).forEach((u) => lines.push(`- <${u}>`));
      if (e.domain_map.length > 100) lines.push(`- *…and ${e.domain_map.length - 100} more*`);
      lines.push(``);
    }

    const enrichEntries = Object.values(e.enrichments || {});
    if (enrichEntries.length) {
      enrichEntries.forEach((en) => {
        if (en?.data == null) return;
        lines.push(`### ${mdEsc(en.label || en.key)}`, ``);
        flattenJson(en.data).forEach(({ path, value }) => {
          if (value) lines.push(`**${mdEsc(path)}:** ${mdEsc(value)}  `);
        });
        lines.push(``);
      });
    } else if (e.custom_extraction != null) {
      lines.push(`### Custom Extraction`, ``);
      flattenJson(e.custom_extraction).forEach(({ path, value }) => {
        if (value) lines.push(`**${mdEsc(path)}:** ${mdEsc(value)}  `);
      });
      lines.push(``);
    }
  });

  lines.push(`---`, ``, `*Exported with DatIQ — https://datiq.app*`);
  return lines.join("\n");
}

export function markdownDownload(items) {
  const list = Array.isArray(items) ? items : [items];
  const md = extractionsToMarkdown(list);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.md`
      : `datiq-export-${list.length}-pages.md`;
  triggerDownload(blob, name);
}

// ── JSON export ──────────────────────────────────────────────────────────────

export function extractionsToJson(items) {
  const list = Array.isArray(items) ? items : [items];
  const payload = {
    export: {
      tool: "DatIQ",
      version: "2.0",
      date: new Date().toISOString(),
      count: list.length,
    },
    pages: list.map((e) => {
      const page = {
        url: e.url,
        page_title: e.page_title || null,
        ai_summary: e.ai_summary || null,
        extracted_at: e.created_at || null,
        headings: (e.headings || []).map((h) => ({ tag: h.tag, text: h.text })),
        links: (e.links || []).map((l) => ({
          text: l.text,
          href: l.href,
          category: l.category || null,
        })),
      };
      if (e.domain_map?.length) page.domain_map = e.domain_map;
      const enrichEntries = Object.values(e.enrichments || {});
      if (enrichEntries.length) {
        page.enrichments = {};
        enrichEntries.forEach((en) => {
          if (en) page.enrichments[en.key || en.label] = en.data;
        });
      } else if (e.custom_extraction != null) {
        page.custom_extraction = e.custom_extraction;
      }
      return page;
    }),
  };
  return JSON.stringify(payload, null, 2);
}

export function jsonDownload(items) {
  const list = Array.isArray(items) ? items : [items];
  const json = extractionsToJson(list);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.json`
      : `datiq-export-${list.length}-pages.json`;
  triggerDownload(blob, name);
}
