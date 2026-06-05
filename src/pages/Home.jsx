// Home.jsx — the input interface (route "/").
import { useState } from "react";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import Toggle from "../components/Toggle.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { isValidUrl, normalizeUrl } from "../lib/utils.js";
import { QUICK_ACTIONS, resolveCustomPrompt, enrichMeta } from "../lib/extractionPresets.js";

const EXAMPLES = ["lumio.io", "stripe.com/pricing", "notion.so/help"];

// V1 capabilities — always available.
const FEATURES = [
  { icon: "list-tree", title: "Heading structure", desc: "Full H1–H6 outline, in order" },
  { icon: "link", title: "Every link", desc: "Internal & external, deduped" },
  { icon: "sparkles", title: "AI summary", desc: "Plain-language page overview" },
];

// V2.0 additions — surfaced at the bottom so users discover the new powers.
const V2_FEATURES = [
  { icon: "code", title: "Custom extraction", desc: "Ask for any field in plain English — Firecrawl's LLM pulls it out" },
  { icon: "map", title: "Domain mapping", desc: "Discover every indexed URL on a site, instantly" },
  { icon: "users", title: "Contacts & emails", desc: "Surface leadership, board & contact emails" },
  { icon: "wand", title: "Content generation", desc: "Turn any saved page into SEO outlines & briefs" },
  { icon: "sparkles", title: "Quick enrichment", desc: "One-click contacts, socials, mission & pricing — saved as tabs" },
];

export default function Home() {
  const { extract } = useExtraction();
  const [url, setUrl] = useState("https://lumio.io");
  const [touched, setTouched] = useState(false);
  const [renderJs, setRenderJs] = useState(false);
  const [mapMode, setMapMode] = useState(false);
  const [contactsMode, setContactsMode] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const valid = isValidUrl(url);

  const submit = (e) => {
    e?.preventDefault();
    if (!valid) {
      setTouched(true);
      return;
    }
    const target = normalizeUrl(url);
    if (mapMode) {
      // Domain mapping ignores per-page options — it just lists URLs.
      extract(target, { mapMode: true });
      return;
    }
    const prompt = resolveCustomPrompt({ customMode, customPrompt, contactsMode });
    const opts = { renderJs, customPrompt: prompt };
    // Tag a custom/contacts extraction so it persists as a named enrichment tab.
    if (prompt) opts.enrichMeta = enrichMeta(contactsMode ? "leadership" : "custom");
    extract(target, opts);
  };

  const applyPreset = (preset) => {
    setCustomMode(true);
    setCustomPrompt(preset.prompt);
  };

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
        <div className="hero-glow" />

        <div className="eyebrow rise" style={{ animationDelay: ".02s" }}>
          <Icon name="sparkles" size={14} /> No code · structured in seconds
          <span className="v2-pill">v2.0</span>
        </div>

        <h1
          className="rise"
          style={{
            animationDelay: ".06s",
            fontSize: "clamp(38px, 6vw, 68px)",
            lineHeight: 1.04,
            letterSpacing: "-.035em",
            fontWeight: 800,
            margin: "20px 0 0",
          }}
        >
          Extract &amp; enrich
          <br />
          web data in <span style={{ color: "var(--accent)" }}>seconds.</span>
        </h1>

        <p
          className="rise"
          style={{
            animationDelay: ".12s",
            fontSize: "clamp(16px, 2vw, 20px)",
            color: "var(--text-2)",
            maxWidth: "58ch",
            margin: "22px 0 0",
            lineHeight: 1.55,
            fontWeight: 450,
          }}
        >
          Paste any URL to pull a page's headings, links and an instant AI summary — then go
          further: extract <b>any field in plain English</b>, <b>map an entire domain</b>, or
          surface <b>leadership contacts &amp; emails</b>. No scraping scripts required.
        </p>

        <form
          className="rise"
          onSubmit={submit}
          style={{ animationDelay: ".18s", width: "100%", maxWidth: 620, margin: "38px 0 0" }}
        >
          <div className={"field-shell" + (touched && !valid ? " field-error" : "")}>
            <span className="field-lead">
              <Icon name="globe" size={20} />
            </span>
            <input
              className="field-input"
              type="text"
              inputMode="url"
              placeholder="https://example.com"
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
              style={{ height: 50, fontSize: "1em" }}
            >
              {mapMode ? "Map domain" : "Extract"}
            </Button>
          </div>

          {/* Custom Extraction text area (feature 3.1) — shown when toggled on */}
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

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 16,
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
                <span style={{ color: "var(--text-3)", fontSize: ".88em", fontWeight: 500 }}>
                  Try
                </span>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    className="example-chip"
                    onClick={() => {
                      setUrl("https://" + ex);
                      setTouched(false);
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </>
            )}
          </div>

          {/* Scrape options — toggles below the search box & examples */}
          <div className="scrape-opts">
            <Toggle
              icon="zap"
              label="Render JavaScript"
              hint="for dynamic / SPA pages — slower"
              checked={renderJs}
              onChange={setRenderJs}
              title="Waits for client-side JavaScript to render before capturing (Firecrawl waitFor). Best for SPAs and dynamic pages."
            />
            <Toggle
              icon="map"
              label="Map entire domain"
              hint={mapMode ? "lists every indexed URL" : "vs. scrape single page"}
              checked={mapMode}
              onChange={setMapMode}
              title="Discover all indexed URLs on the domain via Firecrawl's /map endpoint, instead of scraping one page."
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
              <Icon name="network" size={13} /> Domain mapping is active — other options apply to
              single-page scrapes.
            </p>
          )}
        </form>

        {/* All capabilities (V1 + V2), merged into one grid below the options */}
        <div className="rise home-features" style={{ animationDelay: ".26s" }}>
          {[...FEATURES, ...V2_FEATURES].map((f) => (
            <div key={f.title} className="feature-cell">
              <div className="feature-ico">
                <Icon name={f.icon} size={19} />
              </div>
              <div>
                <div className="feature-title">{f.title}</div>
                <div className="feature-desc">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
