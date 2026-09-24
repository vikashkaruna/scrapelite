// Home.jsx — single-URL + smart multi-URL extraction interface (route "/").
//
// Enhancements (home-screen-enhancement):
//   • Intent chips replace the 4 toggles — one click configures everything
//   • Smart input: detects multi-URL paste → progressive disclosure or /batch
//   • FAB (layers-2 icon) navigates to /batch for multi-URL extraction
//   • OG preview card (favicon + title + description) shown on valid URL blur
//   • Feature capability cards are clickable — click selects the matching intent
//   • Render JS stays as a collapsible Advanced option
//   • Post-extraction: /batch pre-populated via navigation state when routing there
import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, useNavigate, Link } from "react-router";
import Icon from "../components/Icon.jsx";
import HeroComposer from "../components/HeroComposer.jsx";
import RecentExtractions from "../components/RecentExtractions.jsx";
import OutcomeTiles from "../components/OutcomeTiles.jsx";
import TryExampleDemo from "../components/TryExampleDemo.jsx";
import TemplateGallery from "../components/TemplateGallery.jsx";
import CreditEstimator from "../components/CreditEstimator.jsx";
import TrustStrip from "../components/TrustStrip.jsx";
import { estimateCredits } from "../lib/creditEstimator.js";
import { usePersona } from "../components/PersonaProvider.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useSeo } from "../hooks/useSeo.js";
import { classifyInput, normalizeUrl, extractUrls } from "../lib/utils.js";
import { CONTACTS_PROMPT, QUICK_ACTIONS } from "../lib/extractionPresets.js";
import { CONTENT_FORMATS } from "../lib/aiService.js";
import { OUTCOME_TILES, homeTiles } from "../lib/outcomeTiles.js";
import { useAuth } from "../components/AuthProvider.jsx";
import { getAccess as getEngagementAccess } from "../lib/engagement/engagementClient.js";
import { getStats, fmtStat } from "../lib/statsService.js";
import { PLATFORM_MODULES, hasModuleCta, moduleStatusLabel } from "../lib/platformModules.js";

// Derive the pricing prompt from the existing QUICK_ACTIONS config.
const PRICING_PROMPT = QUICK_ACTIONS.find((a) => a.key === "pricing")?.prompt || "";

// ── Intent chip definitions ────────────────────────────────────────────────
// Each chip auto-configures extraction options so users never touch toggles.
const INTENTS = [
  { key: "summary",  icon: "sparkles", label: "AI summary",    desc: "Page overview + key insights" },
  { key: "contacts", icon: "users",    label: "Find contacts",  desc: "Leadership, emails & board" },
  { key: "pricing",  icon: "hash",     label: "Scrape pricing", desc: "Tiers, prices & plan features" },
  { key: "map",      icon: "map",      label: "Map site",       desc: "Discover all indexed URLs" },
  // Headings + links, moved here from the retired "What can DatIQ extract" grid
  // (owner 2026-09-24). Same extraction as a summary — every result carries the
  // page's structure — the chip just says so and labels the run.
  { key: "structure", icon: "list-tree", label: "Page structure", desc: "Headings & every link, in order" },
  { key: "custom",   icon: "code",     label: "Custom…",        desc: "Any field in plain English" },
];

const SHOW_FEATURE_GRID = false;

/** Persona recommendations (personaConfig `featuresHighlight` keys) mapped onto
 *  the chips and Common-jobs tiles, now that the feature grid is hidden. */
export const HIGHLIGHT_TO_CHIP = { summary: "summary", contacts: "contacts", pricing: "pricing", map: "map", custom: "custom", headings: "structure", links: "structure" };
export const HIGHLIGHT_TO_TILE = { contacts: "lead", pricing: "pricing", headings: "seo", content: "content" };
// The module tiles each role is pointed at, on top of its feature highlights.
export const ROLE_TO_TILES = {
  sales: ["account-brief", "outreach"],
  revops: ["account-brief", "send-to-crm"],
  "competitive-intel": ["watch-competitor"],
  pmm: ["ai-visibility", "watch-competitor"],
  seo: ["ai-visibility"],
  "brand-growth": ["ai-visibility"],
  "founder-vc": ["account-brief"],
  agency: ["ai-visibility", "send-to-crm"],
};

// Map feature card keys → intent chip key (null = post-extraction only)
const CARD_TO_INTENT = {
  headings: "summary",
  links:    "summary",
  summary:  "summary",
  custom:   "custom",
  map:      "map",
  contacts: "contacts",
  pricing:  "pricing",
  content:  null,
};

/**
 * The content freshness date, stamped from the last commit at build time (see
 * vite.config.js). `null` when git was unavailable — an absent date is better
 * than an invented one, since dateModified is a claim.
 */
const CONTENT_DATE = typeof __CONTENT_DATE__ === "string" ? __CONTENT_DATE__ : null;

/**
 * A named author, because anonymous content is systematically treated as
 * lower-trust and trust decides which of several correct sources gets cited.
 *
 * ⚠️ An ORGANIZATION, not a Person, and that is a deliberate accuracy call.
 * The obvious move is a Person block naming a founder, and the audit guidance
 * even suggests one — but the visible attribution on /about is the COMPANY,
 * Axiom Minds Private Limited, with a company LinkedIn. Schema that names an
 * individual the page never shows is markup describing something a reader
 * cannot see, which is the SH-07 defect this product exists to report, aimed at
 * ourselves.
 *
 * Every value below is copied from the founder block on /about. If that block
 * changes to name a person, change this to a Person and keep them matching.
 */
const AUTHOR_SCHEMA = {
  "@type": "Organization",
  name: "Axiom Minds Private Limited",
  url: "https://axiomminds.ai",
  sameAs: ["https://www.linkedin.com/company/axiom-minds/"],
};

const ALL_FEATURES = [
  { key: "headings", icon: "list-tree", title: "Heading structure", desc: "Full H1–H6 outline, in order" },
  { key: "links",    icon: "link",      title: "Every link",        desc: "Internal & external, deduped" },
  { key: "summary",  icon: "sparkles",  title: "AI summary",        desc: "Plain-language page overview", popular: true },
  { key: "custom",   icon: "code",      title: "Custom extraction",  desc: "Ask for any field in plain English", popular: true },
  { key: "map",      icon: "map",       title: "Domain mapping",    desc: "Discover every indexed URL on a site" },
  { key: "contacts", icon: "users",     title: "Contacts & emails",  desc: "Surface leadership & contact emails", popular: true },
  { key: "content",  icon: "wand",      title: "Content generation", desc: "Turn saved pages into SEO outlines & briefs" },
  { key: "pricing",  icon: "hash",      title: "Pricing extraction", desc: "Structured pricing tiers from any page" },
];

function DashboardReveal() {
  return (
    <aside className="home-dashboard-reveal rise" aria-label="DatIQ intelligence workflow preview">
      <div className="hdr-topline">
        <span className="hdr-mark"><Icon name="layers" size={14} /></span>
        <span>DatIQ intelligence</span>
        <span className="hdr-live-dot" aria-hidden="true" />
      </div>
      <div className="hdr-source-row">
        <Icon name="globe" size={14} />
        <span>Public web signal</span>
        <Icon name="arrow-right" size={13} />
        <span className="hdr-source-state">Structured</span>
      </div>
      <div className="hdr-signal-grid">
        <Link className="hdr-signal-tile" to="/discoverability" aria-label="Open Discoverability">
          <Icon name="scan-search" size={14} /><span>Discover</span>
        </Link>
        <Link className="hdr-signal-tile" to="/integrations" aria-label="Open Integrations">
          <Icon name="share" size={14} /><span>Connect</span>
        </Link>
        <Link className="hdr-signal-tile" to="/workflows" aria-label="Open the Workflow hub">
          <Icon name="eye" size={14} /><span>Compete</span>
        </Link>
        <Link className="hdr-signal-tile" to="/engagement" aria-label="Open Engagement (beta)">
          <Icon name="users" size={14} /><span>Engage</span>
          <span className="hdr-signal-beta">Beta</span>
        </Link>
      </div>
      <div className="hdr-evidence-row">
        <Icon name="check-circle" size={14} />
        <span>Evidence ready for the next decision</span>
      </div>
    </aside>
  );
}

function ModuleCard({ module, onAction }) {
  const hasCta = hasModuleCta(module);
  const status = moduleStatusLabel(module.status);
  return (
    <article
      className={`home-module-card${hasCta ? "" : " home-module-card-upcoming"}`}
      data-module-status={module.status}
    >
      <div className="home-module-topline">
        <span className="home-module-icon"><Icon name={module.icon} size={18} /></span>
        <span className={`home-module-status home-module-status-${module.status}`}>{status}</span>
      </div>
      <h3>{module.name}</h3>
      <p><strong>{module.headline}</strong> {module.description}</p>
      {hasCta && (
        <button type="button" className="home-module-cta" onClick={() => onAction(module)}>
          {module.cta} <Icon name="arrow-right" size={14} />
        </button>
      )}
    </article>
  );
}

function GuideTip({ tip, onDismiss }) {
  return (
    <div className="guide-tip rise">
      <div className="guide-tip-icon"><Icon name="info" size={14} /></div>
      <span className="guide-tip-text">{tip}</span>
      <button className="guide-tip-close" onClick={onDismiss} aria-label="Dismiss tip">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export default function Home() {
  useSeo({
    title: "DatIQ — Intelligence, Connected.",
    description:
      "DatIQ turns public web signals into structured intelligence and connected workflows. Extract, enrich, monitor and audit a URL with evidence you can use.",
    canonical: "https://datiq.app/",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "DatIQ — Intelligence, Connected.",
        url: "https://datiq.app/",
        description:
          "Turn public web signals into structured intelligence with extraction, enrichment, discoverability audits and connected workflows.",
        inLanguage: "en",
        ...(CONTENT_DATE ? { dateModified: CONTENT_DATE } : {}),
        author: AUTHOR_SCHEMA,
        publisher: {
          "@type": "Organization",
          "@id": "https://datiq.app/#organization",
          name: "DatIQ",
          legalName: "Axiom Minds Private Limited",
          url: "https://datiq.app",
          logo: "https://datiq.app/favicon.svg",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "DatIQ",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Web intelligence platform for structured extraction, enrichment, discoverability audits and connected workflows.",
        url: "https://datiq.app/",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          category: "Free tier with 10 free extractions and 1 free discoverability audit",
        },
        author: AUTHOR_SCHEMA,
      },
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: "DatIQ Web Intelligence Platform",
        description: "Web intelligence platform for structured extraction, enrichment, discoverability audits and connected workflows.",
        url: "https://datiq.app/",
        brand: {
          "@type": "Brand",
          name: "DatIQ",
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "Person",
        name: "DatIQ Editorial Team",
        email: "hello@datiq.app",
        worksFor: AUTHOR_SCHEMA,
      },
    ],
  });
  const { personaId, userName, resetOnboarding } = usePersona();
  const billing = useBilling();
  const showToast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const highlights = persona?.featuresHighlight || [];
  const recommendedChips = new Set(highlights.map((k) => HIGHLIGHT_TO_CHIP[k]).filter(Boolean));
  const recommendedTiles = new Set([
    ...highlights.map((k) => HIGHLIGHT_TO_TILE[k]).filter(Boolean),
    ...(ROLE_TO_TILES[personaId] || []),
  ]);

  // Engagement is a private beta: only an account the server says is in it
  // gets the outreach tile. Signed out, not in the beta, or an unreadable
  // answer all get the pricing-watch tile instead, keeping the row at 12.
  const { user } = useAuth() || {};
  const [engageAccess, setEngageAccess] = useState(false);
  useEffect(() => {
    if (!user) { setEngageAccess(false); return undefined; }
    let alive = true;
    getEngagementAccess()
      .then((a) => { if (alive) setEngageAccess(Boolean(a?.enabled)); })
      .catch(() => { if (alive) setEngageAccess(false); });
    return () => { alive = false; };
  }, [user]);
  const tiles = useMemo(() => homeTiles({ engageAccess }), [engageAccess]);
  const examples = persona ? persona.examples : ["lumio.io", "stripe.com/pricing", "notion.so/help"];
  const defaultUrl = persona ? `https://${examples[0]}` : "https://lumio.io";

  // ── Single-URL input state ─────────────────────────────────────────────
  const [url, setUrl]       = useState(defaultUrl);
  const [touched, setTouched] = useState(false);

  // ── Intent chip state ──────────────────────────────────────────────────
  const [intent, setIntent]         = useState("summary");
  const [customPrompt, setCustomPrompt] = useState("");

  // ── Advanced options (Render JS) ───────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Per-URL AI content generation (was /batch-only until now).
  const [genContentEnabled, setGenContentEnabled] = useState(false);
  const [genContentKey, setGenContentKey] = useState("seo-outline");
  const [renderJs, setRenderJs]         = useState(false);

  // ── OG Preview state ───────────────────────────────────────────────────
  const [preview, setPreview]         = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Multi-URL reveal (DeepSeq QW#4) REMOVED — the user can paste multiple
  //    URLs into the main composer; the smart auto-detect (Q1) routes
  //    multi-URL input to /batch. Keep the FAB → /batch link only. ──

  // ── Outcome tile single-select state (Q3) ─────────────────────────────
  // activeTileKey is the OUTCOME_TILES.key of the currently selected tile,
  // or null. Picking a tile pre-fills the composer (URL + intent + prompt);
  // clicking the active tile clears the selection. The first section above
  // the composer is a single-select picker; the precise intent lives on
  // the intent-chips row further down.
  const [activeTileKey, setActiveTileKey] = useState(null);

  // ── Social proof ───────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);

  // ── Persona tip ───────────────────────────────────────────────────────
  const [showTip, setShowTip] = useState(false);

  useEffect(() => { getStats().then(setStats).catch(() => {}); }, []);

  useEffect(() => {
    if (!persona) return;
    try {
      const tipKey = `datiq.tip.${persona.id}`;
      if (!localStorage.getItem(tipKey)) setShowTip(true);
    } catch { /* skip */ }
  }, [persona?.id]);

  const dismissTip = () => {
    setShowTip(false);
    if (!persona) return;
    try { localStorage.setItem(`datiq.tip.${persona.id}`, "1"); } catch { /* skip */ }
  };

  // ── OG preview: debounced fetch when the input is a single URL ─────────
  // The composer accepts URLs, URL lists, or raw text — only fetch a preview
  // when the whole input resolves to exactly one URL.
  const classification = classifyInput(url);
  const valid = classification.kind === "single";

  useEffect(() => {
    if (!valid) { setPreview(null); return; }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const target = normalizeUrl(classification.urls[0]);
        const res = await fetch(`/api/og-preview?url=${encodeURIComponent(target)}`);
        if (res.ok) {
          const data = await res.json();
          // Only show preview if we got at least a title or description
          setPreview(data?.title || data?.description ? data : null);
        } else {
          setPreview(null);
        }
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [url, valid]);

  // ── Intent chip selection → clear any stale custom prompt when switching away ─
  const handleIntentSelect = useCallback((key) => {
    setIntent(key);
    if (key !== "custom") setCustomPrompt("");
  }, []);

  // ── Feature card click → set matching intent chip ─────────────────────
  const handleCardClick = useCallback((featureKey) => {
    if (featureKey === "discoverability") {
      navigate("/discoverability", { state: { auditUrl: url } });
      return;
    }
    const mapped = CARD_TO_INTENT[featureKey];
    if (mapped) {
      setIntent(mapped);
      // Scroll extraction form into view smoothly
      document.querySelector(".intent-chips")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [navigate, url]);

  const focusComposer = useCallback((nextIntent, focusCustomInput = false) => {
    if (nextIntent) {
      setIntent(nextIntent);
      if (nextIntent !== "custom") setCustomPrompt("");
    }
    const composer = document.querySelector("#extract-composer");
    composer?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      const target = focusCustomInput
        ? composer?.querySelector(".custom-extract-input")
        : composer?.querySelector(".hero-composer-input, textarea");
      target?.focus();
    }, 240);
  }, []);

  // Preview's custom actions return the reader to the same single-URL
  // composer, with the custom intent visibly selected and ready for a prompt.
  // Replace the history state immediately so a later Home re-render never
  // replays the scroll/focus handoff.
  useEffect(() => {
    const handoff = location.state?.openCustomExtraction;
    if (!handoff) return;

    if (location.state?.url) setUrl(location.state.url);
    setTouched(false);
    setPreview(null);
    setActiveTileKey(null);
    setCustomPrompt(location.state?.customPrompt || "");
    focusComposer("custom", true);
    navigate(location.pathname, { replace: true, state: null });
  }, [focusComposer, location.pathname, location.state, navigate]);

  const handleModuleAction = useCallback((module) => {
    if (module.action === "composer") {
      focusComposer();
      return;
    }
    if (module.action === "enrich-composer") {
      focusComposer("contacts");
      return;
    }
    if (module.to) navigate(module.to);
  }, [focusComposer, navigate]);

  // Resolve the per-intent prompt that the composer carries into the extraction.
  // (contacts / pricing have canned prompts; custom uses the user's text.)
  const resolvedCustomPrompt =
    intent === "contacts" ? CONTACTS_PROMPT :
    intent === "pricing"  ? PRICING_PROMPT :
    intent === "custom"   ? customPrompt.trim() :
    "";

  // Q2 — pre-flight credit estimate for the current single-URL composer input.
  // multiCount = 1 for single URL, 0 if empty. (Q1 smart composer handles
  // multi-URL input by routing to /batch — no in-Home multi-URL state since
  // the duplicate multi-URL reveal was removed.)
  const multiCount = useMemo(() => {
    return classification.kind === "single" ? 1 : 0;
  }, [classification.kind]);
  const estimate = useMemo(
    () => estimateCredits({
      count: multiCount,
      planId: billing?.planId || billing?.subscription?.planId || "free",
      credits: billing?.credits || null,
    }),
    [multiCount, billing?.planId, billing?.subscription?.planId, billing?.credits],
  );

  // Q3 (single-select) — outcome tile click. Picking a tile seeds the
  // composer with the tile's example URL and the canned prompt for its
  // intent (contacts / pricing). Clicking the active tile clears the
  // selection. This replaced the earlier multi-select behaviour, which
  // duplicated the "What do you want to extract?" label and confused the
  // first-time UX (one tile is enough to start; combine prompts in the
  // Custom intent instead).
  const OUTCOME_TILES_BY_KEY = useMemo(
    () => Object.fromEntries(OUTCOME_TILES.map((t) => [t.key, t])),
    [],
  );
  // An OPEN tile goes to its module, prefilled from the composer's URL when the
  // composer holds exactly one. It starts nothing: every module there still
  // needs the user to press its own button.
  const handleTileOpen = useCallback((tile) => {
    const single = classifyInput(url || "");
    const current = single.kind === "single" ? normalizeUrl(single.urls[0]) : null;
    navigate(tile.open.to, { state: tile.open.state ? tile.open.state(current) : undefined });
  }, [url, navigate]);

  const handleTileToggle = useCallback((tile) => {
    // tile === null → the active tile was clicked again → clear selection
    if (!tile) {
      setActiveTileKey(null);
      setCustomPrompt("");
      return;
    }
    if (!tile.key) return;
    setActiveTileKey(tile.key);
    setUrl(tile.example.url);
    setTouched(false);
    setPreview(null);
    // Map tile to the matching intent chip (uses the existing CARD_TO_INTENT
    // map plus the tile→intent table). Summary/custom/contacts/pricing/map
    // tiles land on their own intent; "lead-list" and "competitor" land on
    // "custom" with the tile's prompt pre-filled.
    const tileToIntent = {
      summary:     "summary",
      "lead-list": "custom",
      pricing:     "pricing",
      competitor:  "custom",
      "job-board": "custom",
      contacts:    "contacts",
      map:         "map",
    };
    const targetIntent = tileToIntent[tile.key] || "custom";
    setIntent(targetIntent);
    if (targetIntent === "custom") {
      setCustomPrompt(tile.prompt || "");
    } else {
      setCustomPrompt("");
    }
    document.querySelector(".hero-composer, .intent-chips")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Q5 — template card click → pre-fill composer
  const handleTemplateSelect = useCallback((tpl) => {
    // A template may name a DESTINATION rather than an extraction. The
    // discoverability recipes do: they hand the URL to /discoverability with
    // the profile pre-selected, exactly as the composer's Discover button does,
    // rather than running a second copy of the audit flow from here.
    if (tpl.route) {
      navigate(tpl.route, {
        state: { auditUrl: tpl.exampleUrl, auditProfile: tpl.auditProfile || "balanced" },
      });
      return;
    }
    setUrl(tpl.exampleUrl);
    setTouched(false);
    setPreview(null);
    setIntent(tpl.intent);
    if (tpl.intent === "custom") {
      setCustomPrompt(tpl.prompt || "");
    } else {
      setCustomPrompt("");
    }
    document.querySelector(".hero-composer, .intent-chips")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [navigate]);

  // ── Copy for hero section ─────────────────────────────────────────────
  // The product positioning stays stable whether a persona is selected. A
  // persona changes quick starts and guidance, not the public brand promise.
  const eyebrow = persona ? persona.badge : null;
  const subtext = "Turn public web signals into structured intelligence, then move the evidence into the work that follows.";
  const greeting = userName ? `Hi ${userName} —` : null;

  return (
    <div className="page">
      <div
        className="container"
        style={{
          flex: 1, position: "relative",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "flex-start", textAlign: "center",
          paddingTop: "clamp(32px, 5vh, 64px)",
          paddingBottom: "clamp(32px, 5vh, 64px)",
        }}
      >
        <div className="hero-glow" style={persona ? { "--accent": persona.color } : {}} />

        <section className="home-rebrand-hero" aria-labelledby="home-rebrand-title">
          <div className="home-rebrand-copy">
            {eyebrow && (
              <div className="eyebrow rise" style={{ animationDelay: ".02s" }}>
                <Icon name="sparkles" size={14} />
                {greeting && <span style={{ fontWeight: 800 }}>{greeting}</span>}
                {eyebrow}
              </div>
            )}

            <h1 id="home-rebrand-title" className="home-rebrand-title rise" style={{ animationDelay: ".06s" }}>
              Intelligence, <span>Connected.</span>
            </h1>

            <p className="home-rebrand-sub rise" style={{ animationDelay: ".1s" }}>
              {subtext}
            </p>

            <div className="home-rebrand-actions rise" style={{ animationDelay: ".12s" }}>
              <button type="button" className="home-secondary-cta" onClick={() => focusComposer()}>
                <span className="home-secondary-cta-lead">Start free</span>, paste a URL and see it work <Icon name="chevron-down" size={15} />
              </button>
            </div>

          </div>
          <DashboardReveal />
        </section>

        {/* ── Main extraction composer ─────────────────────────────────── */}
        <div
          id="extract-composer"
          className="rise"
          style={{ animationDelay: ".18s", width: "100%", maxWidth: 760, margin: "12px 0 0" }}
        >
          <HeroComposer
            value={url}
            onChange={(v) => { setUrl(v); if (touched) setTouched(false); setPreview(null); }}
            intent={intent}
            customPrompt={resolvedCustomPrompt}
            renderJs={renderJs}
          generateContent={genContentEnabled && intent !== "map" ? CONTENT_FORMATS.find((f) => f.key === genContentKey) : null}
            accentColor={persona ? persona.color : undefined}
            placeholder={persona ? `https://${examples[0]}  ·  or paste any text to extract` : undefined}
          />

          {/* OG Preview card */}
          {(previewLoading || preview) && (
            <div className="url-preview-card">
              {previewLoading ? (
                <span className="url-preview-loading">
                  <Icon name="loader" size={14} /> Fetching preview…
                </span>
              ) : preview && (
                <>
                  <img
                    className="url-preview-favicon"
                    src={preview.favicon}
                    alt=""
                    width={20}
                    height={20}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                  <div className="url-preview-meta">
                    {preview.title && <div className="url-preview-title">{preview.title}</div>}
                    {preview.description && <div className="url-preview-desc">{preview.description}</div>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* F14 — in-product trust strip (under the composer) */}
          <TrustStrip />

          {/* Q2 — pre-flight credit estimator (single URL) */}
          {classification.kind === "single" && (
            <div style={{ marginTop: 8 }}>
              <CreditEstimator estimate={estimate} />
            </div>
          )}

{/* ── Intent chips ─────────────────────────────────────────── */}
          <div className="intent-chips intent-chips-wide">
            <span className="intent-chips-label">What do you want to extract?</span>
            <div className="intent-chips-row">
              {INTENTS.map((ic) => {
                const recommended = recommendedChips.has(ic.key);
                return (
                  <button
                    key={ic.key}
                    type="button"
                    className={"intent-chip" + (intent === ic.key ? " intent-chip-active" : "") + (recommended ? " intent-chip-recommended" : "")}
                    onClick={() => handleIntentSelect(ic.key)}
                    title={recommended ? `${ic.desc} — recommended for ${persona.label}` : ic.desc}
                    style={persona && (intent === ic.key || recommended) ? { "--chip-accent": persona.color } : {}}
                  >
                    <Icon name={ic.icon} size={14} />
                    {ic.label}
                    {recommended && <span className="intent-chip-rec" aria-label="Recommended">★</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom extraction textarea — shown when intent === "custom" */}
          {intent === "custom" && (
            <div className="custom-extract rise">
              <div className="custom-extract-head">
                <Icon name="code" size={14} />
                <span>Custom extraction</span>
                <span className="custom-extract-hint">describe exactly what to pull</span>
              </div>
              <textarea
                className="custom-extract-input"
                rows={2}
                placeholder='e.g. "Extract the product name, price, and customer rating"'
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                aria-label="Custom extraction instructions"
              />
              <div className="custom-extract-presets">
                <span className="preset-lead">Quick actions</span>
                {QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.key} type="button" className="preset-chip"
                    onClick={() => setCustomPrompt(a.prompt)}
                    title={a.prompt}
                  >
                    <Icon name={a.icon} size={12} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Map mode notice */}
          {intent === "map" && (
            <p className="opts-note">
              <Icon name="network" size={13} /> Domain mapping discovers all indexed URLs on the domain — no single-page extraction.
            </p>
          )}

          {/* ── Advanced options (Render JS) ─────────────────────────── */}
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button
              type="button"
              className="advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              <Icon name={showAdvanced ? "chevron-up" : "chevron-down"} size={13} />
              Advanced options
            </button>
          </div>
          {showAdvanced && (
            <div className="advanced-section">
              <label className="advanced-row">
                <input
                  type="checkbox"
                  checked={renderJs}
                  onChange={(e) => setRenderJs(e.target.checked)}
                  style={{ accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0 }}
                />
                <span className="advanced-row-label">
                  <Icon name="zap" size={14} />
                  Render JavaScript
                  <span className="advanced-row-hint">Waits 3 s for React/Vue/Angular SPAs to finish rendering</span>
                </span>
              </label>

              {/* Moved here from /batch, which was the only place it existed —
                  so the option vanished the moment you ran from Home, even
                  though Home routes multi-URL input straight to /batch. Applies
                  to single and batch runs alike. */}
              <label className="advanced-row">
                <input
                  type="checkbox"
                  checked={genContentEnabled}
                  onChange={(e) => setGenContentEnabled(e.target.checked)}
                  disabled={intent === "map"}
                  style={{ accentColor: "var(--accent)", width: 15, height: 15, flexShrink: 0 }}
                />
                <span className="advanced-row-label">
                  <Icon name="file-text" size={14} />
                  Generate AI content for each URL
                  <span className="advanced-row-hint">
                    {intent === "map"
                      ? "Not available in Map site mode"
                      : "Creates content per result (+1–2 s per URL)"}
                  </span>
                </span>
              </label>
              {genContentEnabled && intent !== "map" && (
                <div className="advanced-formats">
                  <span className="advanced-formats-label">Content type:</span>
                  {CONTENT_FORMATS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      className={"advanced-format-chip" + (genContentKey === f.key ? " on" : "")}
                      onClick={() => setGenContentKey(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Persona guidance follows the composer: the activation path stays first. */}
        {persona && (
          <div className="persona-stat rise" style={{ animationDelay: ".2s" }}>
            <span className="persona-stat-num" style={{ color: persona.color }}>{persona.heroStat}</span>
            <span className="persona-stat-label">{persona.heroStatLabel}</span>
          </div>
        )}

        {showTip && persona && (
          <div className="rise" style={{ animationDelay: ".21s", width: "100%", maxWidth: 620 }}>
            <GuideTip tip={persona.guideTip} onDismiss={dismissTip} />
          </div>
        )}

        <div className="rise" style={{ animationDelay: ".22s", width: "100%", maxWidth: 880, margin: "18px 0 0" }}>
          <OutcomeTiles tiles={tiles} activeKey={activeTileKey} onToggle={handleTileToggle} onOpen={handleTileOpen}
            recommendedKeys={recommendedTiles} recommendColor={persona?.color} personaLabel={persona?.label} />
        </div>

        <section className="home-module-overview rise" aria-labelledby="modules-title" style={{ animationDelay: ".24s" }}>
          <div className="home-module-intro">
            <h2 id="modules-title">From signal to next step.</h2>
            <p>Start with a URL, then use the right DatIQ module when the work needs to go further.</p>
            <span className="eyebrow"><Icon name="layers" size={13} /> One connected intelligence layer</span>
          </div>
          <div className="home-module-grid">
            {PLATFORM_MODULES.map((module) => (
              <ModuleCard key={module.key} module={module} onAction={handleModuleAction} />
            ))}
          </div>
        </section>

        {/* ── Recent extractions widget (QW#4) ─────────────────────────── */}
        <div className="rise" style={{ animationDelay: ".22s", width: "100%", maxWidth: 1080 }}>
          <RecentExtractions />
        </div>

        {/* ── Capabilities grid (clickable cards) ───────────────────────── */}
        {/* SH-10 / AC-07. The page had a single H1 and one H3, so the whole
            document was one undifferentiated chunk with nothing retrievable on
            its own — and no heading was phrased as a question a reader would
            actually type. Question headings are how a retrieval system matches
            a section to a query; a statement heading forces it to infer the
            match. These are real section labels, not keyword bait: each one
            names what the section below it genuinely answers. */}
        {/* Hidden (owner 2026-09-24): every card repeated a chip above or a Common
            jobs tile. Its three unique items moved: headings + links → the
            "Page structure" chip, content generation → the "Write a content brief"
            tile; persona recommendations now mark those instead. Kept, not
            deleted, so it can return. */}
        {SHOW_FEATURE_GRID && (<>
        <h2 className="home-section-h rise" style={{ animationDelay: ".25s" }}>
          What can DatIQ extract from a page?
        </h2>
        <ul className="rise home-features" role="list" style={{ animationDelay: ".26s", listStyle: "none", padding: 0 }}>
          {ALL_FEATURES.map((f) => {
            const isHighlighted  = persona && persona.featuresHighlight?.includes(f.key);
            const mappedIntent   = CARD_TO_INTENT[f.key];
            const isSelected     = mappedIntent && intent === mappedIntent;
            const isClickable    = Boolean(mappedIntent);

            return (
              <li
                key={f.key}
                className={[
                  "feature-cell",
                  isHighlighted  ? "feature-cell-highlight" : "",
                  isClickable    ? "feature-cell-clickable" : "",
                  isSelected     ? "feature-cell-selected" : "",
                ].filter(Boolean).join(" ")}
              >
                {isClickable ? (
                  <button
                    type="button"
                    className="feature-cell-action"
                    onClick={() => handleCardClick(f.key)}
                    title={`Click to use: ${f.title}`}
                  >
                    <span className="feature-ico" style={isSelected
                      ? { background: "var(--accent-soft)", color: "var(--accent-on-dark)" }
                      : isHighlighted
                      ? { background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }
                      : {}}
                    >
                      <Icon name={f.icon} size={19} />
                    </span>
                    <span className="feature-body">
                      <span className="feature-title-row">
                        <span className="feature-title">{f.title}</span>
                        {f.popular && !isSelected && <span className="feature-tag" style={{ background: "var(--accent-soft)", color: "var(--accent-on-dark)" }}>Popular</span>}
                        {isSelected && <span className="feature-tag" style={{ background: "var(--accent-soft)", color: "var(--accent-on-dark)" }}>Active</span>}
                        {isHighlighted && !isSelected && <span className="feature-tag" style={{ background: `color-mix(in srgb, ${persona.color} 12%, transparent)`, color: persona.color }}>Recommended</span>}
                      </span>
                      <span className="feature-desc">{f.desc}</span>
                    </span>
                  </button>
                ) : (
                  <div className="feature-cell-static">
                    <span className="feature-ico"><Icon name={f.icon} size={19} /></span>
                    <span className="feature-body">
                      <span className="feature-title-row"><span className="feature-title">{f.title}</span></span>
                      <span className="feature-desc">{f.desc}</span>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </>)}

        {/* Q1 (alt) — Interactive Try-an-Example demo.
            Previously this wrapper was nested INSIDE the template-gallery
            wrapper while its comment claimed it rendered above — it rendered
            after, inside someone else's box. Now a sibling, in the order the
            comment always described. */}
        <div className="rise" style={{ animationDelay: ".27s", width: "100%", maxWidth: 1080, marginTop: 32 }}>
          <TryExampleDemo />
        </div>

        {/* Q5 — Template library */}
        <h2 className="home-section-h rise" style={{ animationDelay: ".275s" }}>
          Which extraction should I start with?
        </h2>
        <div className="rise" style={{ animationDelay: ".28s", width: "100%", maxWidth: 1080, marginTop: 8 }}>
          <TemplateGallery onSelect={handleTemplateSelect} />
          {/* These are extraction PRESETS — one prompt, one page. The workflow
              templates are a different, larger thing (multi-page, synthesised,
              credit-costed, saved as a run), and a visitor who only ever sees
              this list never learns the product does that. Pointing rather
              than repeating: the library describes them once. */}
          <p className="home-template-more">
            Looking for finished business outputs rather than a single extraction?{" "}
            <Link to="/templates">See the workflow templates →</Link>
          </p>
        </div>

        {/* Social proof */}
        {stats && (stats.teams >= 10 || stats.extractions >= 100) && (
          <div className="home-social-proof rise" style={{ animationDelay: ".3s", marginTop: 48, width: "100%", maxWidth: 960 }}>
            <div className="home-sp-stats">
              {[
                ...(stats.teams       >= 10  ? [{ num: fmtStat(stats.teams),       label: "teams & researchers" }] : []),
                ...(stats.extractions >= 100 ? [{ num: fmtStat(stats.extractions), label: "extractions run" }]    : []),
                { num: "30s", label: "average time to insight" },
                { num: "7",   label: "export & enrichment types" },
              ].map((s) => (
                <div key={s.label} className="home-sp-stat">
                  <span className="home-sp-num">{s.num}</span>
                  <span className="home-sp-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Visible freshness date (EA-06) ───────────────────────────────
            Undated content is treated as worse than openly old content,
            because a reader cannot tell whether it is stale. The date has to
            be VISIBLE, not only in dateModified — markup describing something
            a reader cannot see is the defect this product reports on others.

            Stamped from the last commit at build time, never hand-typed: a
            hand-typed date is a claim that silently stops being true. Rendered
            only when we actually have one. */}
        <div className="home-updated rise" style={{ animationDelay: ".31s", textAlign: "center" }}>
          <p style={{ margin: "0 0 6px" }}>
            Published by{" "}
            <span className="author" rel="author">
              <strong>DatIQ Editorial Team</strong> (<a href="mailto:hello@datiq.app">hello@datiq.app</a>) · <a href="/about">Axiom Minds</a>
            </span>
            {CONTENT_DATE && (
              <>
                {" · "}Last updated{" "}
                <time dateTime={CONTENT_DATE}>
                  {new Date(`${CONTENT_DATE}T00:00:00Z`).toLocaleDateString("en-GB", {
                    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
                  })}
                </time>
              </>
            )}
            {" · "}
            <a href="/about">About DatIQ</a>
          </p>
          <p style={{ margin: 0, fontSize: "0.9em", color: "var(--text-3)" }}>
            Built on web standards compliant with <a href="https://schema.org/docs/documents.html" target="_blank" rel="noopener noreferrer">Schema.org</a> and <a href="https://www.w3.org/TR/html52/" target="_blank" rel="noopener noreferrer">W3C HTML5 Specifications</a>.
          </p>
        </div>

        {/* Persona footer */}
        {persona && (
          <div className="home-persona-footer rise" style={{ animationDelay: ".32s" }}>
            <span style={{ color: "var(--text-3)", fontSize: ".86em" }}>
              Viewing as <b style={{ color: "var(--text-2)" }}>{persona.label}</b>
            </span>
            <button className="ob-skip-link" onClick={() => { resetOnboarding(); navigate("/onboarding"); }}>
              Switch role
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
