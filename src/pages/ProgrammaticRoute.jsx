// src/pages/ProgrammaticRoute.jsx — F11 (programmatic SEO landing pages).
//
// One component, many URLs. Renders the same template for /for-sales,
// /for-seo, /for-ci, /extract-pricing, /extract-contacts, /extract-headings
// (and any future additions to PROGRAMMATIC_ROUTES).
//
// Pattern: each page is rich in target keywords, has a clear H1 + sub, lists
// concrete bullets (no fluff), and ends with a pre-filled CTA that routes the
// user into the real extraction flow on Home.

import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { getRouteBySlug } from "../lib/programmaticRoutes.js";
import { setMeta , canonicalUrl } from "../lib/seoMeta.js";

export default function ProgrammaticRoute() {
  const location = useLocation();
  // First path segment is the full slug ("for-sales", "extract-pricing").
  // We register the routes explicitly in App.jsx so this is always exact.
  const fullSlug = (location.pathname || "").replace(/^\//, "").split("/")[0];
  const route = getRouteBySlug(fullSlug);
  const navigate = useNavigate();

  useEffect(() => {
    if (!route) return;
    setMeta({
      title: `${route.h1} — DatIQ`,
      description: route.description,
      url: canonicalUrl(`/${fullSlug}`),
    });
  }, [route, fullSlug]);

  if (!route) {
    return (
      <div className="page">
        <div className="container" style={{ paddingTop: 80, textAlign: "center" }}>
          <Icon name="search-x" size={40} />
          <h1 style={{ marginTop: 16 }}>Page not found</h1>
          <p style={{ color: "var(--text-2)" }}>
            <Link to="/">← Back to DatIQ</Link>
          </p>
        </div>
      </div>
    );
  }

  const handlePrimary = () => {
    // Route the user to Home with the example URL pre-filled so the demo
    // takes one click, not three.
    const params = new URLSearchParams();
    if (route.ctaPrimary.prefilled) params.set("url", route.ctaPrimary.prefilled);
    if (route.ctaPrimary.intent) params.set("intent", route.ctaPrimary.intent);
    if (route.persona) params.set("persona", route.persona);
    navigate(`/?${params.toString()}`);
  };

  return (
    <div className="page pr-page">
      <div className="container pr-container">
        <header className="pr-head rise">
          <span className="ws-eyebrow">
            <Icon name={route.icon} size={12} />
            {route.kind === "persona"
              ? `For ${route.personaLabel}`
              : route.kind === "industry"
              ? `${route.industryLabel}`
              : `Extract ${route.intentLabel}`}
          </span>
          <h1 className="pr-title">{route.h1}</h1>
          <p className="pr-sub">{route.sub}</p>

          <div className="pr-ctas">
            <Button variant="primary" icon="zap" onClick={handlePrimary}>
              {route.ctaPrimary.label}
            </Button>
            {route.ctaSecondary?.href && (
              route.ctaSecondary.href.startsWith("/onboarding") ? (
                <Button
                  variant="secondary"
                  icon="user-plus"
                  onClick={() => navigate(route.ctaSecondary.href)}
                >
                  {route.ctaSecondary.label}
                </Button>
              ) : route.ctaSecondary.href.startsWith("/#") ? (
                <a
                  className="pr-cta-secondary"
                  href={route.ctaSecondary.href}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(route.ctaSecondary.href);
                  }}
                >
                  {route.ctaSecondary.label} →
                </a>
              ) : (
                <Link className="pr-cta-secondary" to={route.ctaSecondary.href}>
                  {route.ctaSecondary.label} →
                </Link>
              )
            )}
          </div>
        </header>

        <section className="pr-bullets rise" aria-labelledby="pr-bullets-heading">
          <h2 id="pr-bullets-heading" className="pr-section-title">
            What you can do
          </h2>
          <ul className="pr-bullet-list">
            {route.bullets.map((b, i) => (
              <li key={i}>
                <Icon name="check" size={14} className="pr-bullet-icon" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="pr-keywords rise" aria-label="Related topics">
          <h2 className="pr-section-title">Related</h2>
          <div className="pr-keyword-row">
            {route.keywords.map((k) => (
              <span key={k} className="pr-keyword-pill">{k}</span>
            ))}
          </div>
        </section>

        <footer className="pr-foot">
          <p>
            <Link to="/">← Back to DatIQ</Link>
            <span> · </span>
            <Link to="/changelog">Changelog</Link>
            <span> · </span>
            <Link to="/pricing">Pricing</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
