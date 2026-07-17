// src/pages/PublicReport.jsx — Q6 (shareable report links) public view.
//
// Renders a single shared extraction at /p/:slug. No auth, no TopBar —
// just a clean read-only report. Includes OG / Twitter meta tags for
// social previews and SEO indexing via the static SSR step.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { getPublicBySlug } from "../lib/shareService.js";
import { setMeta } from "../lib/seoMeta.js";

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

export default function PublicReport() {
  const { slug } = useParams();
  const [ext, setExt] = useState(() => (slug ? getPublicBySlug(slug) : null));

  // Set OG / SEO meta when we have a record.
  useEffect(() => {
    if (!ext) return;
    const title = `${ext.title} — DatIQ`;
    const desc = (ext.ai_summary || `Shared extraction of ${ext.url}`).slice(0, 200);
    setMeta({ title, description: desc, url: typeof window !== "undefined" ? window.location.href : `/p/${slug}`, image: null });
  }, [ext, slug]);

  if (!ext) {
    return (
      <div className="page">
        <div className="container" style={{ paddingTop: 80, textAlign: "center" }}>
          <Icon name="search-x" size={40} />
          <h1 style={{ marginTop: 16 }}>Report not found</h1>
          <p style={{ color: "var(--text-2)", maxWidth: 480, margin: "12px auto 0", lineHeight: 1.6 }}>
            This shareable link may have been removed, or the slug is incorrect.
            Try <Link to="/gallery">the public gallery</Link> for live reports.
          </p>
          <p style={{ marginTop: 24 }}>
            <Link to="/">← Back to DatIQ</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page public-page">
      <div className="container public-container">
        <header className="public-head">
          <Link to="/" className="public-brand" aria-label="DatIQ">
            <Icon name="layers" size={18} strokeWidth={2.2} />
            <span>Dat<b>IQ</b></span>
          </Link>
          <span className="public-eyebrow">Shared report</span>
        </header>

        <article className="public-article card rise">
          <h1 className="public-title">{ext.title}</h1>
          <p className="public-url">
            <Icon name="globe" size={13} />
            <a href={ext.url} target="_blank" rel="noreferrer noopener">{hostOf(ext.url)}</a>
            <span className="public-time">· {timeAgo(ext.created_at)}</span>
          </p>

          {ext.ai_summary && (
            <section className="public-section">
              <h2><Icon name="sparkles" size={14} /> Summary</h2>
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

          <footer className="public-foot">
            <p>
              <Icon name="info" size={12} />
              Want your own? <Link to="/">Extract any page in seconds →</Link>
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
