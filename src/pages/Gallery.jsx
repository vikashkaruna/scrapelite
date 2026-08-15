// src/pages/Gallery.jsx — Q6 (public sample gallery) listing page.
//
// Lists all publicly shared extractions. Pure read from localStorage — works
// even without a backend. Renders SEO-friendly cards with link previews.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { getGallery, buildPublicUrl } from "../lib/shareService.js";
import { setMeta , canonicalUrl } from "../lib/seoMeta.js";

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function Gallery() {
  const [items, setItems] = useState(() => getGallery(100));

  useEffect(() => {
    setMeta({
      title: "Public extraction gallery — DatIQ",
      description: "Browse real, anonymized public reports extracted with DatIQ. See what structured data looks like for pricing pages, directories, articles, and more.",
      url: canonicalUrl("/gallery"),
    });
    // Refresh the gallery in case it was updated since mount.
    setItems(getGallery(100));
  }, []);

  return (
    <div className="page">
      <div className="container" style={{ paddingTop: "clamp(32px, 5vh, 56px)", paddingBottom: "clamp(40px, 6vh, 72px)" }}>
        <header className="rise" style={{ textAlign: "center", marginBottom: 32 }}>
          <span className="ws-eyebrow">
            <Icon name="library" size={12} />
            Public gallery
          </span>
          <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", margin: "10px 0 0", letterSpacing: "-.02em" }}>
            Real extractions. Shared publicly.
          </h1>
          <p style={{ color: "var(--text-2)", maxWidth: 600, margin: "10px auto 0", lineHeight: 1.55 }}>
            Browse the latest reports our users have shared. Each one is a live
            page you can view, copy, or use as inspiration for your own extractions.
          </p>
        </header>

        {items.length === 0 ? (
          <div className="card rise" style={{ padding: 32, textAlign: "center" }}>
            <Icon name="inbox" size={32} />
            <h2 style={{ marginTop: 12, fontSize: "1.2rem" }}>No shared reports yet</h2>
            <p style={{ color: "var(--text-2)", margin: "8px 0 0" }}>
              Extract a page and click <strong>Share</strong> to publish it here.
            </p>
            <p style={{ marginTop: 18 }}>
              <Link to="/" className="btn btn-primary">Extract your first page →</Link>
            </p>
          </div>
        ) : (
          <div className="gallery-grid">
            {items.map((it) => {
              const url = buildPublicUrl(it.slug);
              return (
                <Link
                  key={it.slug}
                  to={`/p/${it.slug}`}
                  className="gallery-card card rise"
                >
                  <h3 className="gallery-card-title">{it.title || it.url}</h3>
                  <p className="gallery-card-url">
                    <Icon name="globe" size={11} /> {it.url}
                  </p>
                  <div className="gallery-card-meta">
                    <span className="gallery-card-tag">{it.intent || "summary"}</span>
                    <span className="gallery-card-time">{timeAgo(it.created_at)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
