// Home.jsx — the input interface (route "/"). V4: persona-adaptive hero + content.
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import Toggle from "../components/Toggle.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { isValidUrl, normalizeUrl } from "../lib/utils.js";
import { QUICK_ACTIONS, resolveCustomPrompt, enrichMeta } from "../lib/extractionPresets.js";

const DEFAULT_EXAMPLES = ["lumio.io", "stripe.com/pricing", "notion.so/help"];

// All capabilities — shown as cards at the bottom.
const ALL_FEATURES = [
  { key: "headings", icon: "list-tree", title: "Heading structure", desc: "Full H1–H6 outline, in order" },
  { key: "links",    icon: "link",      title: "Every link",       desc: "Internal & external, deduped" },
  { key: "summary",  icon: "sparkles",  title: "AI summary",       desc: "Plain-language page overview" },
  { key: "custom",   icon: "code",      title: "Custom extraction",desc: "Ask for any field in plain English" },
  { key: "map",      icon: "map",       title: "Domain mapping",   desc: "Discover every indexed URL on a site" },
  { key: "contacts", icon: "users",     title: "Contacts & emails",desc: "Surface leadership & contact emails" },
  { key: "content",  icon: "wand",      title: "Content generation",desc: "Turn saved pages into SEO outlines & briefs" },
  { key: "pricing",  icon: "hash",      title: "Pricing extraction",desc: "Structured pricing tiers from any page" },
];

// First-run tooltip shown after onboarding completes.
function GuideTip({ tip, onDismiss }) {
  return (
    <div className="guide-tip rise">
      <div className="guide-tip-icon">
        <Icon name="info" size={14} />
      </div>
      <span className="guide-tip-text">{tip}</span>
      <button className="guide-tip-close" onClick={onDismiss} aria-label="Dismiss tip">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export default function Home() {
  const { extract } = useExtraction();
  const { personaId, userName, resetOnboarding } = usePersona();
  const navigate = useNavigate();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const examples = persona ? persona.examples : DEFAULT_EXAMPLES;
  const defaultUrl = persona ? `https://${examples[0]}` : "https://lumio.io";

  const [url, setUrl] = useState(defaultUrl);
  const [touched, setTouched] = useState(false);
  const [renderJs, setRenderJs] = useState(false);
  const [mapMode, setMapMode] = useState(false);
  const [contactsMode, setContactsMode] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showTip, setShowTip] = useState(false);
  const valid = isValidUrl(url);

  // Show guide tip once per persona selection (cleared on dismiss).
  useEffect(() => {
    if (!persona) return;
    const tipKey = `scrapelite.tip.${persona.id}`;
    const seen = localStorage.getItem(tipKey);
    if (!seen) setShowTip(true);
  }, [persona?.id]);

  const dismissTip = () => {
    setShowTip(false);
    if (persona) localStorage.setItem(`scrapelite.tip.${persona.id}`, "1");
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!valid) {
      setTouched(true);
      return;
    }
    const target = normalizeUrl(url);
    if (mapMode) {
      extract(target, { mapMode: true });
      return;
    }
    const prompt = resolveCustomPrompt({ customMode, customPrompt, contactsMode });
    const opts = { renderJs, customPrompt: prompt };
    if (prompt) opts.enrichMeta = enrichMeta(contactsMode ? "leadership" : "custom");
    extract(target, opts);
  };

  const applyPreset = (preset) => {
    setCustomMode(true);
    setCustomPrompt(preset.prompt);
  };

  const tryExample = (ex) => {
    const full = ex.startsWith("http") ? ex : "https://" + ex;
    setUrl(full);
    setTouched(false);
  };

  // ── Hero copy (persona-adaptive) ──
  const eyebrow = persona ? persona.badge : "No code · structured in seconds";
  const headline = persona ? persona.tagline : "Extract & enrich web data in seconds.";
  const subtext = persona
    ? persona.subtitle
    : "Paste any URL to pull a page's headings, links and an instant AI summary — then go further: extract any field in plain English, map an entire domain, or surface leadership contacts & emails.";

  // ── Greeting ──
  const greeting = userName ? `Hi ${userName} —` : null;

  return (
    <div className="page">
      <div
        className="container"
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          textAlign: "center",
          paddingTop: "clamp(32px, 5vh, 64px)",
          paddingBottom: "clamp(32px, 5vh, 64px)",
        }}
      >
        <div className="hero-glow" style={persona ? { "--accent": persona.color } : {}} />

        {/* Persona-adaptive eyebrow */}
        <div className="eyebrow rise" style={{ animationDelay: ".02s" }}>
          <Icon name="sparkles" size={14} />
          {greeting && <span style={{ fontWeight: 800 }}>{greeting}</span>}
          {eyebrow}
          {!persona && <span className="v2-pill">v2.0</span>}
        </div>

        {/* Persona-specific hero headline */}
        <h1
          className="rise"
          style={{
            animationDelay: ".06s",
            fontSize: "clamp(30px, 5vw, 58px)",
            lineHeight: 1.08,
            letterSpacing: "-.03em",
            fontWeight: 800,
            margin: "20px 0 0",
            maxWidth: "760px",
          }}
        >
          {persona ? (
            <>
              {headline.split("—")[0]}
              {headline.includes("—") && (
                <>
                  <br />—{" "}
                  <span style={{ color: persona ? persona.color : "var(--accent)" }}>
                    {headline.split("—")[1]}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              Extract &amp; enrich
              <br />
              web data in{" "}
              <span style={{ color: "var(--accent)" }}>seconds.</span>
            </>
          )}
        </h1>

        <p
          className="rise"
          style={{
            animationDelay: ".12s",
            fontSize: "clamp(15px, 1.8vw, 19px)",
            color: "var(--text-2)",
            maxWidth: "58ch",
            margin: "20px 0 0",
            lineHeight: 1.6,
            fontWeight: 450,
          }}
        >
          {subtext}
        </p>

        {/* Persona stat badge */}
        {persona && (
          <div className="persona-stat rise" style={{ animationDelay: ".15s" }}>
            <span className="persona-stat-num" style={{ color: persona.color }}>
              {persona.heroStat}
            </span>
            <span className="persona-stat-label">{persona.heroStatLabel}</span>
          </div>
        )}

        {/* Guide tip */}
        {showTip && persona && (
          <div className="rise" style={{ animationDelay: ".16s", width: "100%", maxWidth: 620 }}>
            <GuideTip tip={persona.guideTip} onDismiss={dismissTip} />
          </div>
        )}

        {/* URL extraction form */}
        <form
          className="rise"
          onSubmit={submit}
          style={{ animationDelay: ".18s", width: "100%", maxWidth: 620, margin: "32px 0 0" }}
        >
          <div className={"field-shell" + (touched && !valid ? " field-error" : "")}>
            <span className="field-lead">
              <Icon name="globe" size={20} />
            </span>
            <input
              className="field-input"
              type="text"
              inputMode="url"
              placeholder={persona ? `https://${examples[0]}` : "https://example.com"}
              value={url}
              autoFocus
              onChange={(e) => {
                setUrl(e.target.value);
                if (touched) setTouched(false);
              }}
              aria-label="Page URL to extract"
            />
            <Button
              variant="primary"
              type="submit"
              iconRight="arrow-right"
              style={{ height: 50, fontSize: "1em", background: persona ? persona.color : undefined }}
            >
              {mapMode ? "Map domain" : "Extract"}
            </Button>
          </div>

          {/* Custom Extraction textarea */}
          {customMode && !mapMode && (
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
                    key={a.key}
                    type="button"
                    className="preset-chip"
                    onClick={() => applyPreset(a)}
                    title={a.prompt}
                  >
                    <Icon name={a.icon} size={12} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Example chips / error */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 14,
              flexWrap: "wrap",
              minHeight: 22,
            }}
          >
            {touched && !valid ? (
              <span style={{ color: "#e0556b", fontSize: ".9em", fontWeight: 550 }}>
                Hmm, that doesn't look like a valid URL.
              </span>
            ) : (
              <>
                <span style={{ color: "var(--text-3)", fontSize: ".88em", fontWeight: 500 }}>Try</span>
                {examples.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="example-chip"
                    onClick={() => tryExample(ex)}
                  >
                    {ex}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Scrape options toggles */}
          <div className="scrape-opts">
            <Toggle
              icon="zap"
              label="Render JavaScript"
              hint="for dynamic / SPA pages — slower"
              checked={renderJs}
              onChange={setRenderJs}
              title="Waits for client-side JavaScript to render before capturing. Best for SPAs and dynamic pages."
            />
            <Toggle
              icon="map"
              label="Map entire domain"
              hint={mapMode ? "lists every indexed URL" : "vs. scrape single page"}
              checked={mapMode}
              onChange={setMapMode}
              title="Discover all indexed URLs on the domain via Firecrawl's /map endpoint."
            />
            <Toggle
              icon="users"
              label="Contacts & emails"
              hint="leadership & board"
              checked={contactsMode}
              onChange={setContactsMode}
              title="Extract names, titles and emails of senior leadership and board members."
            />
            <Toggle
              icon="code"
              label="Custom extraction"
              hint="ask in plain English"
              checked={customMode}
              onChange={setCustomMode}
              title="Reveal a prompt box to extract any specific fields you describe."
            />
          </div>

          {mapMode && (
            <p className="opts-note">
              <Icon name="network" size={13} /> Domain mapping is active — other options apply to single-page scrapes.
            </p>
          )}
        </form>

        {/* Capabilities grid */}
        <div className="rise home-features" style={{ animationDelay: ".26s" }}>
          {ALL_FEATURES.map((f) => (
            <div
              key={f.key}
              className={"feature-cell" + (persona && persona.featuresHighlight?.includes(f.key) ? " feature-cell-highlight" : "")}
            >
              <div
                className="feature-ico"
                style={
                  persona && persona.featuresHighlight?.includes(f.key)
                    ? { background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }
                    : {}
                }
              >
                <Icon name={f.icon} size={19} />
              </div>
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
              {persona && persona.featuresHighlight?.includes(f.key) && (
                <div className="feature-tag" style={{ background: `color-mix(in srgb, ${persona.color} 12%, transparent)`, color: persona.color }}>
                  Recommended
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Change persona / switch role CTA */}
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
