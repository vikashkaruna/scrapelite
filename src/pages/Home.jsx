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
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import HeroComposer from "../components/HeroComposer.jsx";
import RecentExtractions from "../components/RecentExtractions.jsx";
import OutcomeTiles from "../components/OutcomeTiles.jsx";
import TryExampleDemo from "../components/TryExampleDemo.jsx";
import TemplateGallery from "../components/TemplateGallery.jsx";
import CreditEstimator from "../components/CreditEstimator.jsx";
import TrustStrip from "../components/TrustStrip.jsx";
import OffersBanner from "../components/OffersBanner.jsx";
import { estimateCredits } from "../lib/creditEstimator.js";
import { usePersona } from "../components/PersonaProvider.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useSeo } from "../hooks/useSeo.js";
import { classifyInput, normalizeUrl, extractUrls } from "../lib/utils.js";
import { CONTACTS_PROMPT, QUICK_ACTIONS } from "../lib/extractionPresets.js";
import { CONTENT_FORMATS } from "../lib/aiService.js";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";
import { getStats, fmtStat } from "../lib/statsService.js";

// Derive the pricing prompt from the existing QUICK_ACTIONS config.
const PRICING_PROMPT = QUICK_ACTIONS.find((a) => a.key === "pricing")?.prompt || "";

// ── Intent chip definitions ────────────────────────────────────────────────
// Each chip auto-configures extraction options so users never touch toggles.
const INTENTS = [
  { key: "summary",  icon: "sparkles", label: "AI summary",    desc: "Page overview + key insights" },
  { key: "contacts", icon: "users",    label: "Find contacts",  desc: "Leadership, emails & board" },
  { key: "pricing",  icon: "hash",     label: "Scrape pricing", desc: "Tiers, prices & plan features" },
  { key: "map",      icon: "map",      label: "Map site",       desc: "Discover all indexed URLs" },
  { key: "custom",   icon: "code",     label: "Custom…",        desc: "Any field in plain English" },
];

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
    title: "DatIQ: The Unified Web Intelligence Platform | Intelligence from Web",
    description:
      "DatIQ is the unified web intelligence platform — paste any public URL and get headings, links, contacts, pricing, AI summary, and custom fields in seconds. DatIQ.app is the zero-code web data extraction platform.",
    canonical: "https://datiq.app/",
    // EA-04 (no named author) and EA-06 (no visible date) — both raised by a
    // discoverability audit of this very page. Anonymous, undated content is
    // systematically treated as lower-trust, and trust is what decides which of
    // several correct sources gets cited.
    //
    // `dateModified` is stamped from the last commit at build time (see
    // vite.config.js) rather than hand-typed, because a hand-typed date is a
    // claim that silently stops being true.
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "DatIQ: The Unified Web Intelligence Platform",
        url: "https://datiq.app/",
        description:
          "Paste any public URL and get headings, links, contacts, pricing and an AI summary in seconds — one page, a batch, or a scheduled run.",
        inLanguage: "en",
        ...(CONTENT_DATE ? { dateModified: CONTENT_DATE } : {}),
        author: AUTHOR_SCHEMA,
        publisher: {
          "@type": "Organization",
          name: "DatIQ",
          url: "https://datiq.app",
          logo: "https://datiq.app/favicon.svg",
        },
      },
    ],
  });
  const { personaId, userName, resetOnboarding } = usePersona();
  const billing = useBilling();
  const showToast = useToast();
  const navigate = useNavigate();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
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
    const mapped = CARD_TO_INTENT[featureKey];
    if (mapped) {
      setIntent(mapped);
      // Scroll extraction form into view smoothly
      document.querySelector(".intent-chips")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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
      planId: billing?.subscription?.planId || "free",
      bonusExtractions: billing?.subscription?.bonusExtractions || 0,
    }),
    [multiCount, billing?.subscription?.planId, billing?.subscription?.bonusExtractions, billing?.usage?.extractions],
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
  }, []);

  // ── Copy for hero section ─────────────────────────────────────────────
  // Primary tagline is "Intelligence from the Web." — sleek, single-statement,
  // futuristic. The functional subtext (what to paste, what to expect) sits
  // underneath so first-time visitors know what to do without us having to
  // squeeze the positioning into the H1.
  const eyebrow  = persona ? persona.badge   : "No code · structured in seconds";
  const headline = persona ? persona.tagline : "Intelligence from the Web.";
  const subtext  = persona
    ? persona.subtitle
    : "Paste any URL to pull a page's headings, links and an instant AI summary — then go further: extract any field in plain English, map an entire domain, or surface leadership contacts & emails.";
  const greeting = userName ? `Hi ${userName} —` : null;

  const DEFAULT_QUICK_CONTEXTS = [
    { label: "example.com",      url: "https://example.com",         icon: "globe" },
    { label: "stripe.com/pricing", url: "https://stripe.com/pricing", icon: "tag" },
    { label: "anthropic.com",    url: "https://anthropic.com",       icon: "sparkles" },
  ];

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

        {/* Eyebrow */}
        <div className="eyebrow rise" style={{ animationDelay: ".02s" }}>
          <Icon name="sparkles" size={14} />
          {greeting && <span style={{ fontWeight: 800 }}>{greeting}</span>}
          {eyebrow}
          {!persona && <span className="v2-pill">V1.0</span>}
        </div>

        {/* Headline */}
        <h1
          className="rise"
          style={{
            animationDelay: ".06s",
            fontSize: "clamp(30px, 5vw, 58px)",
            lineHeight: 1.08, letterSpacing: "-.03em",
            fontWeight: 800, margin: "20px 0 0", maxWidth: "760px",
          }}
        >
          {persona ? (
            <>
              {headline.split("—")[0]}
              {headline.includes("—") && (
                <><br />—{" "}
                  <span style={{ color: persona ? persona.color : "var(--accent)" }}>
                    {headline.split("—")[1]}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              Intelligence from the <span style={{ color: "var(--accent)" }}>Web.</span>
            </>
          )}
        </h1>

        {/* Subtext */}
        <p
          className="rise"
          style={{
            animationDelay: ".12s",
            fontSize: "clamp(15px, 1.8vw, 19px)",
            color: "var(--text-2)", maxWidth: "58ch",
            margin: "20px 0 0", lineHeight: 1.6, fontWeight: 450,
          }}
        >
          {subtext}
        </p>

        {/* ── Answer-first block (AC-01) ────────────────────────────────────
            A discoverability audit of this page found no passage that is a
            self-contained answer of even 15 words, so answer engines had
            nothing to lift even when the page ranked — they quote a passage,
            not a page.

            Rules this paragraph obeys, and must keep obeying:
              * 40-60 words, and it names its subject explicitly. It has to
                still make sense when quoted alone, with no page around it.
              * It never opens with "this", "it" or "as mentioned above".
              * It sits ABOVE the fold and above any narrative build-up.
            Persona copy is deliberately NOT substituted in: a passage that
            changes per visitor is not a stable thing to be cited. */}
        <p
          className="rise home-answer-block"
          style={{ animationDelay: ".14s" }}
        >
          DatIQ is a zero-code web intelligence platform that turns any public
          URL into structured data. Paste a link and DatIQ returns headings,
          links, contacts, pricing and an AI summary in seconds — for one page,
          a batch of up to 500, or a scheduled run that alerts you when the
          page changes.
        </p>

        {/* Persona hero stat */}
        {persona && (
          <div className="persona-stat rise" style={{ animationDelay: ".15s" }}>
            <span className="persona-stat-num" style={{ color: persona.color }}>{persona.heroStat}</span>
            <span className="persona-stat-label">{persona.heroStatLabel}</span>
          </div>
        )}

        {/* Guide tip */}
        {showTip && persona && (
          <div className="rise" style={{ animationDelay: ".16s", width: "100%", maxWidth: 620 }}>
            <GuideTip tip={persona.guideTip} onDismiss={dismissTip} />
          </div>
        )}

        {/* Q3 — Outcome tiles above the hero composer */}
        <div className="rise" style={{ animationDelay: ".17s", width: "100%", maxWidth: 880, margin: "8px 0 0" }}>
          <OutcomeTiles activeKey={activeTileKey} onToggle={handleTileToggle} />
        </div>

        {/* Quick-context chips */}
        {(() => {
          const contexts = persona
            ? persona.examples.map((ex, i) => ({
                label: ex, url: ex.startsWith("http") ? ex : `https://${ex}`,
                icon: ["target", "eye", "bar-chart"][i % 3],
              }))
            : DEFAULT_QUICK_CONTEXTS;
          return (
            <div className="persona-contexts rise" style={{ animationDelay: ".16s" }}>
              <span className="persona-ctx-label">
                <Icon name="sparkles" size={12} />
                {persona ? `${persona.badge} quick-start` : "Try a quick example"}
              </span>
              <div className="persona-ctx-chips">
                {contexts.map((ctx) => (
                  <button
                    key={ctx.url} type="button" className="persona-ctx-chip"
                    onClick={() => { setUrl(ctx.url); setTouched(false); setPreview(null); }}
                    title={`Use: ${ctx.url}`}
                  >
                    <Icon name={ctx.icon} size={11} /> {ctx.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Main extraction composer ─────────────────────────────────── */}
        <div
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

          {/* Active coupons/discounts — hidden entirely when nothing is active */}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
            <OffersBanner variant="compact" />
          </div>

          {/* F14 — in-product trust strip (under the composer) */}
          <TrustStrip />

          {/* Q2 — pre-flight credit estimator (single URL) */}
          {classification.kind === "single" && (
            <div style={{ marginTop: 8 }}>
              <CreditEstimator estimate={estimate} />
            </div>
          )}

{/* ── Intent chips ─────────────────────────────────────────── */}
          <div className="intent-chips">
            <span className="intent-chips-label">What do you want to extract?</span>
            <div className="intent-chips-row">
              {INTENTS.map((ic) => (
                <button
                  key={ic.key}
                  type="button"
                  className={"intent-chip" + (intent === ic.key ? " intent-chip-active" : "")}
                  onClick={() => handleIntentSelect(ic.key)}
                  title={ic.desc}
                  style={intent === ic.key && persona ? { "--chip-accent": persona.color } : {}}
                >
                  <Icon name={ic.icon} size={14} />
                  {ic.label}
                </button>
              ))}
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

        {/* TODO: DatIQ architecture (Pillar 0/1/2) banner hidden on 2026-08-06 —
            re-enable later. Kept in the DOM (display:none), not unmounted, so
            re-enabling is just removing the display:none below. */}
        <div className="rise" style={{ animationDelay: ".21s", width: "100%", maxWidth: 1080, display: "none" }}>
          <div className="home-pillars-banner">
            <div className="hp-banner-head">
              <span className="hp-banner-eyebrow">
                <Icon name="layers" size={12} />
                DatIQ architecture
              </span>
              <h3 className="hp-banner-title">
                Everything runs on <span className="hp-p0-tag">Pillar 0</span> — Web Intelligence (Core)
              </h3>
              <p className="hp-banner-sub">
                The proven single, batch, and scheduled URL-extraction engine is the foundation. Every
                capability below is layered on top of it.
              </p>
            </div>
            <div className="hp-pillar-row">
              <div className="hp-pillar hp-pillar-p0">
                <span className="hp-pillar-label">P0</span>
                <div className="hp-pillar-text">
                  <div className="hp-pillar-name">Web Intelligence (Core)</div>
                  <div className="hp-pillar-desc">Single · Batch · Scheduled URL extraction</div>
                </div>
                <span className="hp-pillar-badge hp-pillar-badge-live">Live</span>
              </div>
              <div className="hp-pillar">
                <span className="hp-pillar-label">P1</span>
                <div className="hp-pillar-text">
                  <div className="hp-pillar-name">Enrichment &amp; Insight</div>
                  <div className="hp-pillar-desc">AI summaries, leads, content briefs</div>
                </div>
                <span className="hp-pillar-badge hp-pillar-badge-live">Live</span>
              </div>
              <div className="hp-pillar">
                <span className="hp-pillar-label">P2</span>
                <div className="hp-pillar-text">
                  <div className="hp-pillar-name">Distribution &amp; Workflow</div>
                  <div className="hp-pillar-desc">Export, schedule, webhook, CRM sync</div>
                </div>
                <span className="hp-pillar-badge hp-pillar-badge-live">Live</span>
              </div>
            </div>
          </div>
        </div>

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
        <h2 className="home-section-h rise" style={{ animationDelay: ".25s" }}>
          What can DatIQ extract from a page?
        </h2>
        <div className="rise home-features" style={{ animationDelay: ".26s" }}>
          {ALL_FEATURES.map((f) => {
            const isHighlighted  = persona && persona.featuresHighlight?.includes(f.key);
            const mappedIntent   = CARD_TO_INTENT[f.key];
            const isSelected     = mappedIntent && intent === mappedIntent;
            const isClickable    = Boolean(mappedIntent);

            return (
              <div
                key={f.key}
                className={[
                  "feature-cell",
                  isHighlighted  ? "feature-cell-highlight" : "",
                  isClickable    ? "feature-cell-clickable" : "",
                  isSelected     ? "feature-cell-selected" : "",
                ].filter(Boolean).join(" ")}
                onClick={isClickable ? () => handleCardClick(f.key) : undefined}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardClick(f.key); }
                } : undefined}
                title={isClickable ? `Click to use: ${f.title}` : undefined}
              >
                <div
                  className="feature-ico"
                  style={
                    isSelected
                      ? { background: "var(--accent-soft)", color: "var(--accent-on-dark)" }
                      : isHighlighted
                      ? { background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }
                      : {}
                  }
                >
                  <Icon name={f.icon} size={19} />
                </div>
                <div className="feature-body">
                  <div className="feature-title-row">
                    <span className="feature-title">{f.title}</span>
                    {f.popular && !isSelected && (
                      <span
                        className="feature-tag"
                        style={{ background: "var(--accent-soft)", color: "var(--accent-on-dark)" }}
                      >
                        Popular
                      </span>
                    )}
                    {isSelected && (
                      <span
                        className="feature-tag"
                        style={{ background: "var(--accent-soft)", color: "var(--accent-on-dark)" }}
                      >
                        Active
                      </span>
                    )}
                    {isHighlighted && !isSelected && (
                      <span
                        className="feature-tag"
                        style={{
                          background: `color-mix(in srgb, ${persona.color} 12%, transparent)`,
                          color: persona.color,
                        }}
                      >
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="feature-desc">{f.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

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
        {CONTENT_DATE && (
          <p className="home-updated rise" style={{ animationDelay: ".31s" }}>
            Last updated{" "}
            <time dateTime={CONTENT_DATE}>
              {new Date(`${CONTENT_DATE}T00:00:00Z`).toLocaleDateString("en-GB", {
                day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
              })}
            </time>
            {" · "}
            <a href="/about">About DatIQ</a>
          </p>
        )}

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
