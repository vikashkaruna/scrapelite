// src/pages/PublicReport.jsx — Q8 (shareable report links) public view.
//
// Renders a single shared extraction at /p/:slug. No auth, no TopBar —
// just a clean read-only report. The slug is looked up against the
// Supabase `public_reports` table (so the URL works across browsers) with
// a localStorage fallback for dev/offline. Includes OG / Twitter meta tags
// for social previews and SEO indexing.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { getPublicBySlug, buildPublicUrl } from "../lib/shareService.js";
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
  const [ext, setExt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Q8 — async lookup. Supabase first, then localStorage fallback. The
  // previous sync version was BROKEN cross-browser (slug lived in the
  // originator's localStorage only).
  useEffect(() => {
    let cancelled = false;
    if (!slug) { setLoading(false); return; }
    setLoading(true);
    getPublicBySlug(slug)
      .then((data) => { if (!cancelled) setExt(data); })
      .catch(() => { if (!cancelled) setExt(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  // Set OG / SEO meta when we have a record.
  useEffect(() => {
    if (!ext) return;
    const title = `${ext.title} — DatIQ`;
    const desc = (ext.ai_summary || `Shared extraction of ${ext.url}`).slice(0, 200);
    setMeta({ title, description: desc, url: typeof window !== "undefined" ? window.location.href : `/p/${slug}`, image: null });
  }, [ext, slug]);

  const handleCopyUrl = async () => {
    if (typeof window === "undefined") return;
    const url = buildPublicUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const handleCopySummary = async () => {
    if (!ext?.ai_summary || typeof window === "undefined") return;
    try {
      await navigator.clipboard.writeText(ext.ai_summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this summary:", ext.ai_summary);
    }
  };

  if (loading) {
    return (
      <div className="page public-page">
        <div className="container public-container" style={{ paddingTop: 80, textAlign: "center" }}>
          <Icon name="loader" size={28} className="spin" />
          <p style={{ color: "var(--text-2)", marginTop: 12 }}>Loading shared report…</p>
        </div>
      </div>
    );
  }

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
              <div className="public-section-head">
                <h2><Icon name="sparkles" size={14} /> Summary</h2>
                <button
                  type="button"
                  className="public-copy-btn"
                  onClick={handleCopySummary}
                  title="Copy summary to clipboard"
                >
                  <Icon name={copied ? "check" : "clipboard-copy"} size={12} />
                  {copied ? "Copied" : "Copy"}
                </button>
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

          <footer className="public-foot">
            <p>
              <Icon name="info" size={12} />
              Want your own? <Link to="/">Extract any page in seconds →</Link>
            </p>
            <p style={{ marginTop: 6 }}>
              <Icon name="share" size={12} />
              <button type="button" onClick={handleCopyUrl} className="public-copy-link">
                {copied ? "Link copied" : "Copy this page's link"}
              </button>
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
