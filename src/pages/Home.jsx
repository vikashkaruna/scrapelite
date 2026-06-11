// Home.jsx — single-URL and batch-URL extraction interface (route "/").
import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import Toggle from "../components/Toggle.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { isValidUrl, normalizeUrl, csvDownload, markdownDownload, jsonDownload } from "../lib/utils.js";
import { QUICK_ACTIONS, resolveCustomPrompt, enrichMeta } from "../lib/extractionPresets.js";
import { getStats, fmtStat } from "../lib/statsService.js";
import { runBatch } from "../lib/batchService.js";

const DEFAULT_EXAMPLES = ["lumio.io", "stripe.com/pricing", "notion.so/help"];

const DEFAULT_QUICK_CONTEXTS = [
  { label: "SaaS pricing page", url: "https://stripe.com/pricing", icon: "tag" },
  { label: "Company about page", url: "https://notion.so/about", icon: "info" },
  { label: "Blog / content",     url: "https://moz.com/blog",     icon: "book-open" },
];

const ALL_FEATURES = [
  { key: "headings", icon: "list-tree", title: "Heading structure", desc: "Full H1–H6 outline, in order" },
  { key: "links",    icon: "link",      title: "Every link",       desc: "Internal & external, deduped" },
  { key: "summary",  icon: "sparkles",  title: "AI summary",       desc: "Plain-language page overview", popular: true },
  { key: "custom",   icon: "code",      title: "Custom extraction",desc: "Ask for any field in plain English", popular: true },
  { key: "map",      icon: "map",       title: "Domain mapping",   desc: "Discover every indexed URL on a site" },
  { key: "contacts", icon: "users",     title: "Contacts & emails",desc: "Surface leadership & contact emails", popular: true },
  { key: "content",  icon: "wand",      title: "Content generation",desc: "Turn saved pages into SEO outlines & briefs" },
  { key: "pricing",  icon: "hash",      title: "Pricing extraction",desc: "Structured pricing tiers from any page" },
];

// Parse a textarea/text value into valid and invalid URL lists.
// Supports newline, comma, semicolon, pipe, tab, space as delimiters.
function parseMultiUrls(text) {
  const parts = text.split(/[\n,;|\t\s]+/).map((s) => s.trim()).filter(Boolean);
  const valid = [], invalid = [], seen = new Set();
  for (const p of parts) {
    const norm = /^https?:\/\//i.test(p) ? p : "https://" + p;
    const key = norm.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isValidUrl(p)) valid.push(norm);
    else invalid.push(p);
  }
  return { valid, invalid };
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

// Mini results panel shown inline after a batch run completes.
function BatchResultsPanel({ results, onClear, checkCanExport }) {
  const showToast = useToast();
  const success = results.filter((r) => r?._status === "success");
  const failed  = results.filter((r) => r?._status === "error");

  const onCsv = () => {
    if (!checkCanExport("csv")) { showToast("CSV export unavailable on your plan."); return; }
    csvDownload(success);
    showToast(`Exported ${success.length} pages to CSV`, "download");
  };
  const onMd = () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export requires the Select plan or higher."); return; }
    markdownDownload(success);
    showToast(`Exported ${success.length} pages to Markdown`, "file-code");
  };
  const onJson = () => {
    if (!checkCanExport("json")) { showToast("JSON export requires the Pro plan or higher."); return; }
    jsonDownload(success);
    showToast(`Exported ${success.length} pages to JSON`, "file-json");
  };
  const onPdf = async () => {
    if (!checkCanExport("pdf")) { showToast("PDF export requires the Select plan or higher."); return; }
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      extractionsToPdf(success);
      showToast(`Exported ${success.length} pages to PDF`, "file");
    } catch (e) {
      showToast("PDF export failed.");
    }
  };

  return (
    <div className="batch-inline-results rise">
      <div className="batch-inline-header">
        <span className="batch-inline-badge">
          <Icon name="check-circle" size={16} />
          {success.length} extracted
          {failed.length > 0 && <span className="batch-inline-fail"> · {failed.length} failed</span>}
        </span>
        <div className="batch-inline-exports">
          {success.length > 0 && (
            <>
              <button className="batch-inline-btn" onClick={onCsv} title="Export as CSV"><Icon name="download" size={13} /> CSV</button>
              <button className="batch-inline-btn" onClick={onPdf} title="Export as PDF (Select+)"><Icon name="file" size={13} /> PDF</button>
              <button className="batch-inline-btn" onClick={onMd} title="Export as Markdown (Select+)"><Icon name="file-code" size={13} /> MD</button>
              <button className="batch-inline-btn" onClick={onJson} title="Export as JSON (Pro+)"><Icon name="file-json" size={13} /> JSON</button>
            </>
          )}
          <button className="batch-inline-btn clear-btn" onClick={onClear} title="Clear and run a new batch">
            <Icon name="x" size={13} /> Clear
          </button>
        </div>
      </div>
      <div className="batch-inline-rows">
        {results.map((r, i) => (
          r && (
            <div key={r.id || i} className={"batch-inline-row" + (r._status === "error" ? " error" : "")}>
              <span className={"batch-inline-dot" + (r._status === "error" ? " err" : " ok")} />
              <span className="batch-inline-url">{r.page_title || r.url}</span>
              {r._status === "error" && <span className="batch-inline-errmsg">{r._error}</span>}
              {r._status === "success" && (
                <span className="batch-inline-meta">{r.headings?.length ?? 0}h · {r.links?.length ?? 0}l</span>
              )}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { extract } = useExtraction();
  const { personaId, userName, resetOnboarding } = usePersona();
  const billing = useBilling();
  const navigate = useNavigate();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const examples = persona ? persona.examples : DEFAULT_EXAMPLES;
  const defaultUrl = persona ? `https://${examples[0]}` : "https://lumio.io";

  // ── Single URL state ──
  const [url, setUrl]                   = useState(defaultUrl);
  const [touched, setTouched]           = useState(false);

  // ── Batch mode state ──
  const [batchMode, setBatchMode]       = useState(false);
  const [batchText, setBatchText]       = useState("");
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchResults, setBatchResults] = useState(null);
  const abortRef = useRef(null);

  // ── Shared options ──
  const [renderJs, setRenderJs]         = useState(false);
  const [mapMode, setMapMode]           = useState(false);
  const [contactsMode, setContactsMode] = useState(false);
  const [customMode, setCustomMode]     = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showTip, setShowTip]           = useState(false);
  const [stats, setStats]               = useState(null);

  const valid = isValidUrl(url);

  const { valid: batchUrls, invalid: batchInvalidUrls } = useMemo(
    () => (batchMode ? parseMultiUrls(batchText) : { valid: [], invalid: [] }),
    [batchMode, batchText],
  );

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

  // ── Single URL submit ──
  const submitSingle = (e) => {
    e?.preventDefault();
    if (!valid) { setTouched(true); return; }
    const target = normalizeUrl(url);
    if (mapMode) { extract(target, { mapMode: true }); return; }
    const prompt = resolveCustomPrompt({ customMode, customPrompt, contactsMode });
    const opts = { renderJs, customPrompt: prompt };
    if (prompt) opts.enrichMeta = enrichMeta(contactsMode ? "leadership" : "custom");
    extract(target, opts);
  };

  // ── Batch submit ──
  const handleBatchExtract = async () => {
    if (batchUrls.length < 1) return;

    const batchCheck = billing?.checkCanBatch?.(batchUrls.length);
    if (batchCheck && !batchCheck.allowed) {
      navigate("/pricing");
      return;
    }
    const quotaCheck = billing?.checkCanExtractBatch?.(batchUrls.length);
    if (quotaCheck && !quotaCheck.allowed) {
      navigate("/pricing");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBatchRunning(true);
    setBatchResults(null);
    setBatchProgress({ completed: 0, total: batchUrls.length });

    const opts = {};
    if (renderJs) opts.renderJs = true;
    const prompt = resolveCustomPrompt({ customMode, customPrompt, contactsMode });
    if (prompt) opts.customPrompt = prompt;

    try {
      const allResults = await runBatch(
        batchUrls,
        opts,
        (completed, total, result) => {
          setBatchProgress({ completed, total });
          if (result._status === "success") billing?.trackExtraction?.(1);
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setBatchResults(allResults);
      }
    } catch (err) {
      console.error("[DatIQ] Batch failed:", err);
    } finally {
      setBatchRunning(false);
    }
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (batchMode) {
      handleBatchExtract();
    } else {
      submitSingle(e);
    }
  };

  const cancelBatch = () => {
    abortRef.current?.abort();
    setBatchRunning(false);
  };

  const applyPreset = (preset) => { setCustomMode(true); setCustomPrompt(preset.prompt); };

  const tryExample = (ex) => {
    const full = ex.startsWith("http") ? ex : "https://" + ex;
    if (batchMode) {
      setBatchText((t) => (t ? t + "\n" + full : full));
    } else {
      setUrl(full);
      setTouched(false);
    }
  };

  const progressPct = batchProgress.total > 0
    ? Math.round((batchProgress.completed / batchProgress.total) * 100)
    : 0;

  const eyebrow  = persona ? persona.badge   : "No code · structured in seconds";
  const headline = persona ? persona.tagline : "Extract & enrich web data in seconds.";
  const subtext  = persona
    ? persona.subtitle
    : "Paste any URL to pull a page's headings, links and an instant AI summary — then go further: extract any field in plain English, map an entire domain, or surface leadership contacts & emails.";
  const greeting = userName ? `Hi ${userName} —` : null;

  const urlCountColor =
    batchUrls.length === 0 ? "var(--text-3)" :
    batchUrls.length > 500 ? "var(--danger, #e0556b)" :
    "var(--success, #22c55e)";

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

        <div className="eyebrow rise" style={{ animationDelay: ".02s" }}>
          <Icon name="sparkles" size={14} />
          {greeting && <span style={{ fontWeight: 800 }}>{greeting}</span>}
          {eyebrow}
          {!persona && <span className="v2-pill">v2.0</span>}
        </div>

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
              Extract &amp; enrich<br />
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
            color: "var(--text-2)", maxWidth: "58ch",
            margin: "20px 0 0", lineHeight: 1.6, fontWeight: 450,
          }}
        >
          {subtext}
        </p>

        {persona && (
          <div className="persona-stat rise" style={{ animationDelay: ".15s" }}>
            <span className="persona-stat-num" style={{ color: persona.color }}>{persona.heroStat}</span>
            <span className="persona-stat-label">{persona.heroStatLabel}</span>
          </div>
        )}

        {showTip && persona && (
          <div className="rise" style={{ animationDelay: ".16s", width: "100%", maxWidth: 620 }}>
            <GuideTip tip={persona.guideTip} onDismiss={dismissTip} />
          </div>
        )}

        {/* Persona quick-context chips */}
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
                    onClick={() => { setUrl(ctx.url); setTouched(false); }}
                    title={`Use: ${ctx.url}`}
                  >
                    <Icon name={ctx.icon} size={11} /> {ctx.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Main extraction form ── */}
        <form
          className="rise"
          onSubmit={handleSubmit}
          style={{ animationDelay: ".18s", width: "100%", maxWidth: 620, margin: "12px 0 0" }}
        >
          {/* URL input — single or batch */}
          {batchMode ? (
            <div className="batch-field-wrap">
              <div className="batch-field-header">
                <span className="batch-field-label">
                  <Icon name="layers-2" size={13} /> Batch mode
                </span>
                <span className="batch-field-count" style={{ color: urlCountColor }}>
                  {batchUrls.length} URL{batchUrls.length !== 1 ? "s" : ""}
                  {batchInvalidUrls.length > 0 && (
                    <span className="batch-field-invalid"> · {batchInvalidUrls.length} invalid skipped</span>
                  )}
                </span>
              </div>
              <textarea
                className="batch-field-textarea"
                placeholder={"Paste URLs — one per line or comma / semicolon / pipe separated:\n\nhttps://stripe.com/pricing\nhttps://notion.so/about\nhttps://moz.com/blog"}
                value={batchText}
                onChange={(e) => setBatchText(e.target.value)}
                rows={5}
                autoFocus
                aria-label="URLs to extract in batch"
              />
            </div>
          ) : (
            <div className={"field-shell" + (touched && !valid ? " field-error" : "")}>
              <span className="field-lead"><Icon name="globe" size={20} /></span>
              <input
                className="field-input"
                type="text"
                inputMode="url"
                placeholder={persona ? `https://${examples[0]}` : "https://example.com"}
                value={url}
                autoFocus
                onChange={(e) => { setUrl(e.target.value); if (touched) setTouched(false); }}
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
          )}

          {/* Batch mode: extract button + progress */}
          {batchMode && (
            <div className="batch-field-footer">
              {batchRunning ? (
                <div className="batch-field-progress">
                  <div className="batch-progress-bar-wrap" style={{ flex: 1 }}>
                    <div
                      className="batch-progress-bar"
                      style={{ width: `${progressPct}%` }}
                      role="progressbar"
                      aria-valuenow={batchProgress.completed}
                      aria-valuemax={batchProgress.total}
                    />
                  </div>
                  <span className="batch-field-progress-label">
                    {batchProgress.completed}/{batchProgress.total}
                  </span>
                  <button
                    type="button"
                    className="batch-cancel-btn"
                    onClick={cancelBatch}
                    aria-label="Cancel batch"
                  >
                    <Icon name="x" size={14} /> Cancel
                  </button>
                </div>
              ) : (
                <Button
                  variant="primary"
                  type="submit"
                  iconRight="arrow-right"
                  disabled={batchUrls.length < 1}
                  style={{
                    width: "100%",
                    background: persona ? persona.color : undefined,
                  }}
                >
                  {batchUrls.length > 0
                    ? `Extract ${batchUrls.length} URL${batchUrls.length !== 1 ? "s" : ""}`
                    : "Extract"}
                </Button>
              )}
            </div>
          )}

          {/* Batch inline results */}
          {batchResults && !batchRunning && (
            <BatchResultsPanel
              results={batchResults}
              onClear={() => { setBatchResults(null); setBatchText(""); }}
              checkCanExport={billing?.checkCanExport ?? (() => true)}
            />
          )}

          {/* Custom extraction textarea */}
          {customMode && !mapMode && !batchMode && (
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
                    onClick={() => applyPreset(a)} title={a.prompt}
                  >
                    <Icon name={a.icon} size={12} /> {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Example chips / error — single mode only */}
          {!batchMode && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 14, flexWrap: "wrap", minHeight: 22 }}>
              {touched && !valid ? (
                <span style={{ color: "#e0556b", fontSize: ".9em", fontWeight: 550 }}>
                  Hmm, that doesn't look like a valid URL.
                </span>
              ) : (
                <>
                  <span style={{ color: "var(--text-3)", fontSize: ".88em", fontWeight: 500 }}>Try</span>
                  {examples.map((ex) => (
                    <button key={ex} type="button" className="example-chip" onClick={() => tryExample(ex)}>
                      {ex}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Scrape options — 2-column grid */}
          <div className="scrape-opts scrape-opts-grid">
            <Toggle
              icon="layers-2"
              label="Batch mode"
              hint={batchMode ? "multi-URL active" : "multi-URL off"}
              checked={batchMode}
              onChange={(v) => {
                setBatchMode(v);
                if (v) { setMapMode(false); }
                setBatchResults(null);
              }}
              tooltip="Paste 10–500 URLs and extract them all at once. Business & Agency plans, or purchase a Batch Pack."
            />
            <Toggle
              icon="zap"
              label="Render JavaScript"
              hint="dynamic / SPA pages"
              checked={renderJs}
              onChange={setRenderJs}
              tooltip="Waits for client-side JavaScript to render before capturing. Best for React/Vue/Angular SPAs."
            />
            <Toggle
              icon="map"
              label="Map entire domain"
              hint={mapMode ? "all indexed URLs" : "vs. single page"}
              checked={mapMode && !batchMode}
              onChange={(v) => { if (!batchMode) setMapMode(v); }}
              tooltip="Discover all indexed URLs on the domain via Firecrawl's /map endpoint."
            />
            <Toggle
              icon="users"
              label="Contacts & emails"
              hint="leadership & board"
              checked={contactsMode}
              onChange={(val) => { setContactsMode(val); if (val) setCustomMode(true); }}
              tooltip="Extract names, titles and emails of senior leadership and board members."
            />
            <Toggle
              icon="code"
              label="Custom extraction"
              hint="ask in plain English"
              checked={customMode}
              onChange={setCustomMode}
              tooltip="Reveal a prompt box to extract any specific fields you describe in plain English."
            />
          </div>

          {mapMode && !batchMode && (
            <p className="opts-note">
              <Icon name="network" size={13} /> Domain mapping is active — other options apply to single-page scrapes.
            </p>
          )}
          {batchMode && (
            <p className="opts-note">
              <Icon name="layers-2" size={13} /> Batch mode — paste URLs above using any delimiter (newline, comma, semicolon, pipe).
              {" "}Each URL uses one extraction from your monthly quota.
            </p>
          )}
        </form>

        {/* Capabilities grid */}
        <div className="rise home-features" style={{ animationDelay: ".26s" }}>
          {ALL_FEATURES.map((f) => {
            const isHighlighted = persona && persona.featuresHighlight?.includes(f.key);
            return (
              <div
                key={f.key}
                className={"feature-cell" + (isHighlighted ? " feature-cell-highlight" : "")}
              >
                <div
                  className="feature-ico"
                  style={isHighlighted
                    ? { background: `color-mix(in srgb, ${persona.color} 14%, transparent)`, color: persona.color }
                    : {}}
                >
                  <Icon name={f.icon} size={19} />
                </div>
                <div className="feature-body">
                  <div className="feature-title-row">
                    <span className="feature-title">{f.title}</span>
                    {f.popular && (
                      <span
                        className="feature-tag"
                        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                      >
                        Popular
                      </span>
                    )}
                    {isHighlighted && (
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
