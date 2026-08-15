// src/pages/Gallery.jsx — Q6 (public sample gallery) listing page.
//
// Two distinct sections, deliberately not merged into one list:
//
//  1. Curated showcase — admin-verified example reports tagged with a
//     persona (see admin-gallery.js / 0025_gallery_curation.sql). Always
//     read from Supabase: a showcase has to look the same to every visitor,
//     not just the browser that happened to share something.
//
//  2. "Recently shared" — the existing local-only feed (getGallery()), an
//     uncurated mirror of whatever this browser has shared. Left completely
//     unchanged so its sync contract (and the tests that assert it) keeps
//     working.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { getGallery, getCuratedGallery, buildPublicUrl } from "../lib/shareService.js";
import { PERSONAS, PERSONA_BY_ID } from "../lib/personaConfig.js";
import { setMeta , canonicalUrl } from "../lib/seoMeta.js";

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function GalleryCard({ it }) {
  return (
    <Link to={`/p/${it.slug}`} className="gallery-card card rise">
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
}

export default function Gallery() {
  const [items, setItems] = useState(() => getGallery(100));
  const [curated, setCurated] = useState([]);
  const [curatedLoading, setCuratedLoading] = useState(true);
  const [activePersona, setActivePersona] = useState(null);

  useEffect(() => {
    setMeta({
      title: "Public extraction gallery — DatIQ",
      description: "Browse real, anonymized public reports extracted with DatIQ. See what structured data looks like for pricing pages, directories, articles, and more.",
      url: canonicalUrl("/gallery"),
    });
    // Refresh the local gallery in case it was updated since mount.
    setItems(getGallery(100));

    getCuratedGallery({ limit: 100 })
      .then(setCurated)
      .finally(() => setCuratedLoading(false));
  }, []);

  // Only offer a chip for a persona that actually has a curated entry — an
  // empty chip would read as "we have examples for you" and then show none.
  const availablePersonas = useMemo(() => {
    const present = new Set(curated.map((c) => c.persona).filter(Boolean));
    return PERSONAS.filter((p) => present.has(p.id));
  }, [curated]);

  const visibleCurated = activePersona
    ? curated.filter((c) => c.persona === activePersona)
    : curated;

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

        {!curatedLoading && curated.length > 0 && (
          <section style={{ marginBottom: 40 }}>
            <div className="gallery-section-head">
              <h2 className="gallery-section-title">
                <Icon name="sparkles" size={15} /> Showcase by use case
              </h2>
              {availablePersonas.length > 0 && (
                <div className="persona-filter-chips" role="tablist" aria-label="Filter by persona">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePersona === null}
                    className={`persona-chip${activePersona === null ? " active" : ""}`}
                    onClick={() => setActivePersona(null)}
                  >
                    All
                  </button>
                  {availablePersonas.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={activePersona === p.id}
                      className={`persona-chip${activePersona === p.id ? " active" : ""}`}
                      style={activePersona === p.id ? { borderColor: p.color, color: p.color } : undefined}
                      onClick={() => setActivePersona(p.id)}
                    >
                      <Icon name={p.icon} size={12} /> {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="gallery-grid">
              {visibleCurated.map((it) => (
                <div key={it.slug} className="gallery-curated-wrap">
                  {it.persona && PERSONA_BY_ID[it.persona] && (
                    <span className="gallery-persona-badge" style={{ "--persona-color": PERSONA_BY_ID[it.persona].color }}>
                      <Icon name={PERSONA_BY_ID[it.persona].icon} size={11} />
                      {PERSONA_BY_ID[it.persona].label}
                    </span>
                  )}
                  <GalleryCard it={it} />
                </div>
              ))}
            </div>
          </section>
        )}

        <h2 className="gallery-section-title" style={{ marginBottom: 16 }}>Recently shared</h2>

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
            {items.map((it) => <GalleryCard key={it.slug} it={it} />)}
          </div>
        )}
      </div>
    </div>
  );
}
