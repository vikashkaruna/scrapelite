// src/components/PublicReportArticle.jsx — the actual rendered content of a
// shared report. Extracted out of PublicReport.jsx (/p/:slug) so
// AdminGallery.jsx's curation preview renders the exact same markup a public
// visitor would see — a separate preview implementation is how "I reviewed
// it" and "what actually got published" quietly drift apart.
//
// `ext` is the full public projection written by shareService.projectPublic():
// { title, url, ai_summary, custom_extraction, headings, links, created_at }.
// `interactive` controls whether the copy-to-clipboard buttons render — the
// admin preview shows the content but doesn't need its own "copy" affordance.
//
// Deliberately does NOT render the outer `<article class="public-article card
// rise">` wrapper or the "Powered by DatIQ" footer — those differ per caller
// (PublicReport.jsx adds its own share footer; AdminGallery.jsx doesn't want
// a viral-loop CTA in an admin screen), so each page supplies its own wrapper
// around this shared inner content instead.

import Icon from "./Icon.jsx";

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function PublicReportArticle({ ext, interactive = true, onCopySummary, copied }) {
  return (
    <>
      <h1 className="public-title">{ext.title}</h1>
      <p className="public-url">
        <Icon name="globe" size={13} />
        <a href={ext.url} target="_blank" rel="noreferrer noopener">{hostOf(ext.url)}</a>
        <span className="public-time">· {timeAgo(ext.created_at)}</span>
      </p>

      {ext.ai_summary && (
        <section className="public-section">
          <div className="public-section-head">
            <h2><Icon name="sparkles" size={14} /> Summary</h2>
            {interactive && (
              <button
                type="button"
                className="public-copy-btn"
                onClick={onCopySummary}
                title="Copy summary to clipboard"
              >
                <Icon name={copied ? "check" : "clipboard-copy"} size={12} />
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <p>{ext.ai_summary}</p>
        </section>
      )}

      {ext.custom_extraction && (
        <section className="public-section">
          <h2><Icon name="code" size={14} /> Extracted data</h2>
          <pre className="public-json">{JSON.stringify(ext.custom_extraction, null, 2)}</pre>
        </section>
      )}

      {ext.headings && ext.headings.length > 0 && (
        <section className="public-section">
          <h2><Icon name="list-tree" size={14} /> Headings ({ext.headings.length})</h2>
          <ul className="public-headings">
            {ext.headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
                <span className="h-level">H{h.level}</span> {h.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ext.links && ext.links.length > 0 && (
        <section className="public-section">
          <h2><Icon name="link" size={14} /> Links ({ext.links.length})</h2>
          <ul className="public-links">
            {ext.links.slice(0, 25).map((l, i) => (
              <li key={i}>
                <a href={l.href || l.url} target="_blank" rel="noreferrer noopener">{l.text || l.href || l.url}</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
