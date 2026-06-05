// Home.jsx — the input interface (route "/").
import { useState } from "react";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { isValidUrl, normalizeUrl } from "../lib/utils.js";

const EXAMPLES = ["lumio.io", "stripe.com/pricing", "notion.so/help"];

const FEATURES = [
  { icon: "list-tree", title: "Heading structure", desc: "Full H1–H6 outline, in order" },
  { icon: "link", title: "Every link", desc: "Internal & external, deduped" },
  { icon: "sparkles", title: "AI summary", desc: "Plain-language page overview" },
];

export default function Home() {
  const { extract } = useExtraction();
  const [url, setUrl] = useState("https://lumio.io");
  const [touched, setTouched] = useState(false);
  const [renderJs, setRenderJs] = useState(false);
  const valid = isValidUrl(url);

  const submit = (e) => {
    e?.preventDefault();
    if (!valid) {
      setTouched(true);
      return;
    }
    extract(normalizeUrl(url), { renderJs });
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
          Extract web data
          <br />
          in <span style={{ color: "var(--accent)" }}>seconds.</span>
        </h1>

        <p
          className="rise"
          style={{
            animationDelay: ".12s",
            fontSize: "clamp(16px, 2vw, 20px)",
            color: "var(--text-2)",
            maxWidth: "52ch",
            margin: "22px 0 0",
            lineHeight: 1.55,
            fontWeight: 450,
          }}
        >
          Paste any URL and ScrapeLite pulls the page's headings and links into clean, structured
          data — with an instant AI summary. No scraping scripts required.
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
              Extract
            </Button>
          </div>

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

          <label className="js-toggle" title="Waits for client-side JavaScript to render before capturing (uses Firecrawl waitFor). Best for SPAs and dynamic pages.">
            <input
              type="checkbox"
              checked={renderJs}
              onChange={(e) => setRenderJs(e.target.checked)}
            />
            <span className="js-toggle-track">
              <span className="js-toggle-thumb" />
            </span>
            <span className="js-toggle-label">
              <Icon name="zap" size={14} /> Render JavaScript
              <span className="js-toggle-hint">for dynamic / SPA pages — slower</span>
            </span>
          </label>
        </form>

        <div className="rise feature-trio" style={{ animationDelay: ".26s" }}>
          {FEATURES.map((f) => (
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
