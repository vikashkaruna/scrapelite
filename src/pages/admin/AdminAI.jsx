// AdminAI.jsx — the Providers console.
//
// One screen for EVERY external service DatIQ depends on: the AI models, the
// scrape providers, and the measurement APIs — with a live Test button on each
// one, and an explicit mapping from every provider to the product feature it
// powers.
//
// ── WHY THIS SCREEN WAS REBUILT ──────────────────────────────────────────────
// The old version listed three AI providers, showed a green tick when an env
// var was non-empty, and said nothing about Firecrawl, Spider, Jina or
// PageSpeed at all. In production that meant: all three AI keys present, all
// three dead (one invalid, two out of credit), console green, every enrichment
// silently returning nothing, and no way to find out from inside the product.
//
// Three principles fixed that:
//   1. PRESENCE IS NOT HEALTH. Every provider has a Test button that makes a
//      real call. Nothing on this screen claims a provider works because a
//      string is non-empty.
//   2. SHOW WHAT BREAKS. Each provider lists the functional areas it powers,
//      so "can I disable this?" has an answer on screen.
//   3. SHOW THE EFFECTIVE VALUE, NOT THE STORED ONE. An area running on a
//      registry default used to look unconfigured. Every row now shows what
//      the server would actually use on the next request.
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  getAiConfig, saveAiConfig, testProvider, testAllProviders,
} from "../../lib/adminConfigService.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";
import {
  PROVIDERS, AI_PROVIDERS, SCRAPE_PROVIDERS_LIST, INTEL_PROVIDERS,
  FUNCTION_AREAS, AI_AREA_KEYS, FUNCTION_AREA_KEYS, MODEL_TIER, defaultModel,
} from "../../lib/providerRegistry.js";

const TABS = [
  { key: "models",    label: "AI models",       icon: "sparkles" },
  { key: "services",  label: "Data services",   icon: "network" },
  { key: "areas",     label: "Where they're used", icon: "layers" },
  { key: "engines",   label: "Answer engines",  icon: "radio" },
];

/**
 * The engines that can read the live web on our behalf.
 *
 * Kept as its own surface because the question an operator has here is not
 * "does the key work" — the models tab answers that — but "is this engine
 * actually RETRIEVING". A key can be valid, the model can answer, and grounding
 * can still return nothing, in which case every citation metric silently
 * becomes a measurement of the model's memory.
 */
const ANSWER_ENGINES = [
  {
    key: "perplexity",
    note: "Retrieval with citations is the product here, not a mode of it. Preferred first for that reason.",
  },
  {
    key: "gemini",
    note: "Needs Google Search grounding enabled for the key. Without it the model still answers — with no sources — and samples degrade to recall.",
  },
];

// Result codes → the operator action. Mirrors PROVIDER_ERROR_COPY server-side;
// duplicated here so the screen still explains itself if the endpoint is down.
const CODE_COPY = {
  ok:            { tone: "ok",   text: "Responding normally." },
  no_key:        { tone: "warn", text: "No API key set." },
  bad_key:       { tone: "bad",  text: "Key rejected — reissue it and update the env var." },
  no_credit:     { tone: "bad",  text: "Key valid, account out of credit — top up billing." },
  rate_limited:  { tone: "warn", text: "Rate-limited right now. The key is fine." },
  bad_model:     { tone: "bad",  text: "That model id isn't available to this key." },
  provider_down: { tone: "bad",  text: "The provider returned a server error." },
  truncated:     { tone: "bad",  text: "The model reasoned past its output budget before answering — raise max tokens, or run a non-reasoning model here." },
  timeout:       { tone: "bad",  text: "No answer before OUR deadline — the provider refused nothing. Check its status and rate limits, then retry." },
  network:       { tone: "bad",  text: "Could not reach the provider." },
  error:         { tone: "bad",  text: "The provider rejected the request." },
};

function ResultPill({ result, busy }) {
  if (busy) return <span className="prov-pill prov-pill-busy">Testing…</span>;
  if (!result) return <span className="prov-pill prov-pill-idle">Not tested</span>;
  const copy = CODE_COPY[result.code] || CODE_COPY.error;
  const tone = result.ok ? "ok" : copy.tone;
  return (
    <span className={`prov-pill prov-pill-${tone}`} title={result.error || copy.text}>
      {result.ok ? "Working" : (result.code || "failed").replace(/_/g, " ")}
      {typeof result.latencyMs === "number" ? ` · ${result.latencyMs}ms` : ""}
    </span>
  );
}

function KeyLine({ info }) {
  if (!info) return null;
  const names = (info.envVars || []).join(" or ");
  if (!info.present) {
    return (
      <div className="prov-key prov-key-missing">
        <Icon name="alert-circle" size={13} />
        <span>Not set — add <code>{names}</code>{info.required ? "" : " (optional)"}</span>
      </div>
    );
  }
  return (
    <div className="prov-key">
      <Icon name="check" size={13} />
      <span>
        <code>{info.resolvedFrom || names}</code> = {info.fingerprint}
        {/* A value sitting in the legacy VITE_ fallback while the operator
            edits the primary var is a real trap — name which one won. */}
        {info.resolvedFrom && info.envVars.length > 1 && info.resolvedFrom !== info.envVars[0]
          ? ` — note: read from the fallback, not ${info.envVars[0]}`
          : ""}
      </span>
    </div>
  );
}

export default function AdminAI() {
  const showToast = useToast();
  const [tab, setTab] = useState("models");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [persisted, setPersisted] = useState(true);
  const [catalogue, setCatalogue] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  // True when the stored row predates fast/deep tiers — see merge() in
  // aiProviders.js. Surfaced as a banner with a migration the operator runs;
  // nothing acts on it automatically.
  const [legacyConfig, setLegacyConfig] = useState(false);
  const [effective, setEffective] = useState({});

  // Editable global chain
  const [order, setOrder] = useState([]);
  const [models, setModels] = useState({});      // deep tier
  const [modelsFast, setModelsFast] = useState({});
  const [enabled, setEnabled] = useState({});
  const [maxTokens, setMaxTokens] = useState(4096);
  // Per-area overrides: null = "no override, uses the registry default".
  const [areas, setAreas] = useState({});

  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState({});   // providerKey -> test result
  const [busy, setBusy] = useState({});         // providerKey -> bool

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await getAiConfig();
      const cfg = data.config || {};
      setCatalogue(data.catalogue || null);
      setSavedAt(data.config?.updatedAt || null);
      setLegacyConfig(data.config?.legacyModelConfig === true);
      setEffective(data.effective || {});
      setPersisted(data.persisted !== false);
      setOrder(cfg.order || AI_AREA_KEYS.length ? (cfg.order || []) : []);
      setModels(cfg.models || {});
      setModelsFast(cfg.modelsFast || {});
      setEnabled(cfg.enabled || {});
      setMaxTokens(cfg.maxTokens || 4096);
      const stored = cfg.pillars || {};
      setAreas(Object.fromEntries(AI_AREA_KEYS.map((a) => [
        a, stored[a] && Object.keys(stored[a]).length ? { ...stored[a] } : null,
      ])));
    } catch (e) {
      // A dead endpoint must not produce a blank screen: the registry is
      // bundled in the browser, so the catalogue still renders read-only.
      setError(e.message || "Could not load provider config.");
      setCatalogue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Grounded probe: does this engine return SOURCES?
   *
   * Deliberately separate from the ping. A green ping and an ungrounded engine
   * is the exact combination that makes a citation score look measured when it
   * is remembered.
   */
  const runEngineTest = useCallback(async (providerKey) => {
    setBusy((b) => ({ ...b, [`engine:${providerKey}`]: true }));
    try {
      const r = await testProvider(providerKey, undefined, { grounded: true });
      setResults((s) => ({ ...s, [`engine:${providerKey}`]: r }));
      showToast?.(r.ok
        ? (r.grounded ? `${providerKey}: grounded, ${r.citationCount} source(s)` : `${providerKey}: answered with NO sources`)
        : `${providerKey}: ${r.error || "failed"}`);
    } catch (e) {
      setResults((s) => ({ ...s, [`engine:${providerKey}`]: { ok: false, error: e.message } }));
      showToast?.(e.message || "Probe failed");
    } finally {
      setBusy((b) => ({ ...b, [`engine:${providerKey}`]: false }));
    }
  }, [showToast]);

  const runTest = useCallback(async (providerKey, model) => {
    setBusy((b) => ({ ...b, [providerKey]: true }));
    try {
      const r = await testProvider(providerKey, model);
      setResults((s) => ({ ...s, [providerKey]: r }));
      showToast?.(r.ok
        ? `${r.label || providerKey}: working${r.latencyMs ? ` (${r.latencyMs}ms)` : ""}`
        : `${r.label || providerKey}: ${r.hint || r.error || "failed"}`);
    } catch (e) {
      setResults((s) => ({ ...s, [providerKey]: { ok: false, code: "error", error: e.message } }));
      showToast?.(e.message || "Test failed");
    } finally {
      setBusy((b) => ({ ...b, [providerKey]: false }));
    }
  }, [showToast]);

  const runAllTests = useCallback(async (keys) => {
    const list = keys || (catalogue?.providers || []).map((p) => p.key);
    setBusy(Object.fromEntries(list.map((k) => [k, true])));
    try {
      const rs = await testAllProviders(list);
      setResults((s) => ({ ...s, ...Object.fromEntries(rs.map((r) => [r.provider, r])) }));
      const bad = rs.filter((r) => !r.ok && r.code !== "no_key");
      showToast?.(bad.length
        ? `${bad.length} of ${rs.length} providers failing — see the badges.`
        : `All ${rs.length} tested providers responding.`);
    } catch (e) {
      showToast?.(e.message || "Test run failed");
    } finally {
      setBusy({});
    }
  }, [catalogue, showToast]);

  // One-click split of a pre-tier config. Keeps the operator's stored model on
  // the FAST tier — that is what a single pre-tier entry meant, since the
  // shipped defaults then were the fast models — and restores registry deep
  // defaults for deep work. Deliberately an explicit action, never automatic:
  // it changes which model real extractions run on, and that is the operator's
  // call to make and to see happen.
  const splitTiers = useCallback(async () => {
    setSaving(true);
    try {
      const fast = { ...models };                 // what they had = fast
      const deep = {};
      for (const p of Object.keys(models)) deep[p] = defaultModel(p, MODEL_TIER.DEEP);
      const res = await saveAiConfig({ order, models: deep, modelsFast: fast, enabled, maxTokens });
      showToast?.(res.persisted === false
        ? (res.warning || "Split locally — Supabase is not configured, so this will not persist.")
        : "Split into fast and deep tiers. Deep work now uses the deep models below.");
      await load();
    } catch (e) {
      showToast?.(e.message || "Could not split the tiers");
    } finally {
      setSaving(false);
    }
  }, [order, models, enabled, maxTokens, showToast, load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const pillars = {};
      for (const [k, v] of Object.entries(areas)) if (v) pillars[k] = v;
      const res = await saveAiConfig({
        order, models, modelsFast, enabled, maxTokens,
        ...(Object.keys(pillars).length ? { pillars } : {}),
      });
      showToast?.(res.persisted === false
        ? (res.warning || "Saved locally — Supabase is not configured, so this will not persist.")
        : "Saved. Live on this screen now; other functions pick it up within 60 seconds.");
      // Re-read so the screen shows the EFFECTIVE values the server resolved,
      // not the ones we optimistically typed.
      await load();
    } catch (e) {
      showToast?.(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [order, models, modelsFast, enabled, maxTokens, areas, showToast, load]);

  // "Saved" and "live everywhere" are different moments, and conflating them
  // is what made a working save look broken: each Netlify function holds its
  // own 60s config cache, so a template run can still use the previous model
  // for up to a minute after the console already shows the new one.
  const savedLabel = savedAt
    ? `Stored config last written ${new Date(savedAt).toLocaleString()}`
    : "No stored config — running on built-in defaults";

  const providerRows = useMemo(() => {
    if (catalogue?.providers?.length) return catalogue.providers;
    // Offline fallback from the bundled registry.
    return Object.keys(PROVIDERS).map((k) => ({
      key: k, kind: PROVIDERS[k].kind, label: PROVIDERS[k].label,
      docsUrl: PROVIDERS[k].docsUrl, capabilities: PROVIDERS[k].capabilities || null,
      structured: PROVIDERS[k].structured === true,
      requiresKey: PROVIDERS[k].requiresKey !== false && Boolean(PROVIDERS[k].keyEnv),
      models: PROVIDERS[k].models ? {
        catalogue: PROVIDERS[k].models.catalogue,
        defaultFast: defaultModel(k, MODEL_TIER.FAST),
        defaultDeep: defaultModel(k, MODEL_TIER.DEEP),
      } : null,
      apiKey: null,
      areas: FUNCTION_AREA_KEYS.filter((a) => FUNCTION_AREAS[a].defaultOrder.includes(k)),
    }));
  }, [catalogue]);

  const byKey = useMemo(
    () => Object.fromEntries(providerRows.map((p) => [p.key, p])),
    [providerRows],
  );

  // How many providers are actually PROVEN working, per kind. This is the
  // number the old console could never show.
  const health = useMemo(() => {
    const tally = (keys) => {
      const tested = keys.filter((k) => results[k]);
      return {
        tested: tested.length,
        working: tested.filter((k) => results[k].ok).length,
        total: keys.length,
      };
    };
    return { ai: tally(AI_PROVIDERS), scrape: tally(SCRAPE_PROVIDERS_LIST), intel: tally(INTEL_PROVIDERS) };
  }, [results]);

  if (loading) return <div className="admin-page"><p className="muted">Loading providers…</p></div>;

  return (
    <div className="admin-page prov-page">
      <div className="admin-head">
        <div>
          <h1>Providers</h1>
          <p className="muted">
            Every external service DatIQ calls, what it powers, and whether it is
            actually working right now. Keys live in server environment variables and are
            never shown here — only whether they resolve and whether the vendor accepts them.
          </p>
        </div>
        <div className="prov-head-actions">
          <Button variant="secondary" onClick={() => load()}>Reload</Button>
          <Button onClick={() => runAllTests()}>Test all providers</Button>
        </div>
      </div>

      {error ? (
        <div className="prov-banner prov-banner-bad">
          <Icon name="alert-circle" size={15} />
          <span>{error} Showing the built-in catalogue read-only — testing and saving need the admin API.</span>
        </div>
      ) : null}

      {!persisted ? (
        <div className="prov-banner prov-banner-warn">
          <Icon name="alert-circle" size={15} />
          <span>
            Supabase is not configured, so changes here cannot be persisted server-side.
            The chain will keep running on environment variables and built-in defaults.
          </span>
        </div>
      ) : null}

      {/* The headline an operator needs first: is the AI chain alive at all?
          Untested is stated as untested — never implied to be healthy. */}
      <div className="prov-summary">
        {[
          { k: "ai", label: "AI models", keys: AI_PROVIDERS },
          { k: "scrape", label: "Scrape providers", keys: SCRAPE_PROVIDERS_LIST },
          { k: "intel", label: "Measurement APIs", keys: INTEL_PROVIDERS },
        ].map(({ k, label, keys }) => {
          const h = health[k];
          const configured = keys.filter((x) => byKey[x]?.apiKey?.present || byKey[x]?.requiresKey === false).length;
          return (
            <div key={k} className="prov-summary-card">
              <div className="prov-summary-label">{label}</div>
              <div className="prov-summary-value">
                {h.tested === 0
                  ? <span className="muted">{configured} configured · not tested</span>
                  : <span className={h.working === 0 ? "prov-bad" : h.working < h.tested ? "prov-warn" : "prov-ok"}>
                      {h.working} of {h.tested} tested working
                    </span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="prov-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key} role="tab" aria-selected={tab === t.key}
            className={`prov-tab${tab === t.key ? " on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "models" ? (
        <ModelsTab
          providers={providerRows.filter((p) => p.kind === "ai")}
          results={results} busy={busy} onTest={runTest}
          legacyConfig={legacyConfig} onSplitTiers={splitTiers}
          models={models} setModels={setModels}
          modelsFast={modelsFast} setModelsFast={setModelsFast}
          enabled={enabled} setEnabled={setEnabled}
          maxTokens={maxTokens} setMaxTokens={setMaxTokens}
          saving={saving} onSave={save} savedLabel={savedLabel}
          onTestAll={() => runAllTests(AI_PROVIDERS)}
        />
      ) : null}

      {tab === "services" ? (
        <ServicesTab
          providers={providerRows.filter((p) => p.kind !== "ai")}
          results={results} busy={busy} onTest={runTest}
          onTestAll={() => runAllTests([...SCRAPE_PROVIDERS_LIST, ...INTEL_PROVIDERS])}
        />
      ) : null}

      {tab === "areas" ? (
        <AreasTab
          effective={effective} areas={areas} setAreas={setAreas}
          byKey={byKey} results={results}
          saving={saving} onSave={save} savedLabel={savedLabel}
        />
      ) : null}

      {tab === "engines" ? (
        <EnginesTab byKey={byKey} results={results} busy={busy} onProbe={runEngineTest} />
      ) : null}
    </div>
  );
}

// ── Answer engines ───────────────────────────────────────────────────────────
//
// The one screen that answers "is citation sampling actually measuring the live
// web". Everything else on this page answers "does the key work", which is a
// different and much weaker question.
function EnginesTab({ byKey, results, busy, onProbe }) {
  return (
    <div className="prov-pane">
      <p className="prov-pane-intro">
        Citation sampling asks a live engine what it says about a domain. An engine that answers
        without returning sources has told us what a model <em>remembers</em>, not what the web
        says — those samples are recorded <code>live: false</code> and are excluded from the live
        trend. Probe each engine to see which you are actually getting.
      </p>

      {ANSWER_ENGINES.map(({ key, note }) => {
        const meta = byKey?.[key] || {};
        const r = results?.[`engine:${key}`];
        const probing = busy?.[`engine:${key}`];
        return (
          <div key={key} className="prov-engine">
            <div className="prov-engine-head">
              <b>{meta.label || key}</b>
              <span className={`prov-key${meta.hasKey ? " on" : ""}`}>
                {meta.hasKey ? `key set via ${meta.keyEnv}` : `${meta.keyEnv || "key"} not set`}
              </span>
              <Button size="sm" variant="secondary" loading={probing}
                disabled={!meta.hasKey || probing}
                onClick={() => onProbe(key)}>
                Probe grounding
              </Button>
            </div>
            <p className="prov-engine-note">{note}</p>

            {r ? (
              <div className={`prov-engine-result${r.ok && r.grounded ? " is-good" : " is-bad"}`}>
                <b>
                  {!r.ok ? "Probe failed"
                    : r.grounded ? `Grounded — ${r.citationCount} source${r.citationCount === 1 ? "" : "s"} returned`
                    : "Answered with NO sources"}
                </b>
                <span>{r.verdict || r.error}</span>
                {r.sample?.length ? (
                  <ul className="prov-engine-sample">
                    {r.sample.map((u) => <li key={u}>{u}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      <p className="prov-pane-foot">
        With neither key set, sampling falls back to the AI chain and every run is recorded
        <code> live: false</code> — honest, but a measurement of model recall rather than of the
        open web. Set <code>DISABLE_AI_CITATION_SAMPLING=1</code> to stop sampling entirely rather
        than record recall.
      </p>
    </div>
  );
}

// ── AI models ────────────────────────────────────────────────────────────────
function ModelsTab({
  providers, results, busy, onTest, models, setModels, modelsFast, setModelsFast,
  legacyConfig, onSplitTiers,
  enabled, setEnabled, maxTokens, setMaxTokens, saving, onSave, onTestAll, savedLabel,
}) {
  return (
    <section className="prov-section">
      {/* A stored config written before fast/deep tiers existed holds ONE model
          per provider, and the shipped defaults then were the FAST ones. It is
          applied to both tiers so a live operator setting is never quietly
          retired — but that means DEEP work (extraction, summaries, briefs)
          runs on a fast model, which was invisible from every screen until
          this banner. The split is offered, never applied automatically: it
          changes which model real extractions use. */}
      {legacyConfig && (
        <div className="prov-legacy">
          <Icon name="alert-triangle" size={15} />
          <div>
            <strong>Your saved configuration predates fast/deep tiers.</strong>{" "}
            It holds one model per provider, so <em>deep</em> work — extraction,
            summaries and briefs — is currently running on it too. If that model
            was your old default, deep work is running on a fast model.
            <div className="prov-legacy-actions">
              <Button variant="secondary" size="sm" onClick={onSplitTiers} disabled={saving}>
                Split into fast &amp; deep
              </Button>
              <span>Keeps your model on <em>fast</em> and restores recommended deep models. You can edit both afterwards.</span>
            </div>
          </div>
        </div>
      )}
      <div className="prov-section-head">
        <p className="muted">
          Each provider runs two model tiers. <strong>Fast</strong> handles bulk classification
          (link tagging); <strong>Deep</strong> handles extraction and synthesis, where model quality
          shows up directly in what the customer reads. Model ids are free text — vendors ship new ones
          faster than we deploy — so use <strong>Test</strong> to confirm one before saving it.
        </p>
        <Button variant="secondary" onClick={onTestAll}>Test AI providers</Button>
      </div>

      <div className="prov-grid">
        {providers.map((p) => {
          const r = results[p.key];
          const isOff = enabled[p.key] === false;
          return (
            <article key={p.key} className={`prov-card${isOff ? " prov-card-off" : ""}`}>
              <header className="prov-card-head">
                <div>
                  <h3>{p.label}</h3>
                  <KeyLine info={p.apiKey} />
                </div>
                <ResultPill result={r} busy={busy[p.key]} />
              </header>

              {/* The server's `advice` is a remedy the test established for
                  CERTAIN — which key format this API wants, whose stopwatch
                  ran out — and it OUTRANKS the local copy below. Showing the
                  generic line instead is how a PageSpeed key that was simply
                  the wrong KIND of Google key read as "reissue it", and a
                  provider slower than our own 15s deadline read as "the
                  provider rejected the request". CODE_COPY stays as the
                  fallback for when the endpoint itself is unreachable. */}
              {r && !r.ok ? (
                <div className="prov-error">
                  <strong>{r.advice || (CODE_COPY[r.code] || CODE_COPY.error).text}</strong>
                  {r.error ? <div className="prov-error-raw">{r.error}</div> : null}
                </div>
              ) : null}

              <div className="prov-fields">
                <label className="prov-field">
                  <span>Deep model <em>extraction, summaries, briefs</em></span>
                  <input
                    list={`cat-${p.key}`}
                    value={models[p.key] ?? ""}
                    placeholder={p.models?.defaultDeep || ""}
                    onChange={(e) => setModels({ ...models, [p.key]: e.target.value })}
                  />
                </label>
                <label className="prov-field">
                  <span>Fast model <em>link tagging, bulk classification</em></span>
                  <input
                    list={`cat-${p.key}`}
                    value={modelsFast[p.key] ?? ""}
                    placeholder={p.models?.defaultFast || ""}
                    onChange={(e) => setModelsFast({ ...modelsFast, [p.key]: e.target.value })}
                  />
                </label>
                <datalist id={`cat-${p.key}`}>
                  {(p.models?.catalogue || []).map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>

              <div className="prov-meta">
                {p.structured ? (
                  <span className="prov-tag" title="Schema-guided extraction is enforced by the provider, not recovered by parsing prose.">
                    Native structured output
                  </span>
                ) : (
                  <span className="prov-tag prov-tag-dim" title="Schemas are sent as prompt instructions and the reply is parsed leniently.">
                    Prompt-guided output only
                  </span>
                )}
                {(p.areas || []).map((a) => (
                  <span key={a} className="prov-tag prov-tag-area">{FUNCTION_AREAS[a]?.label || a}</span>
                ))}
              </div>

              <footer className="prov-card-foot">
                <label className="prov-toggle">
                  <input
                    type="checkbox"
                    checked={enabled[p.key] !== false}
                    onChange={(e) => setEnabled({ ...enabled, [p.key]: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
                <div className="prov-card-actions">
                  {p.docsUrl ? (
                    <a className="prov-link" href={p.docsUrl} target="_blank" rel="noreferrer">Get a key</a>
                  ) : null}
                  <Button
                    size="sm" variant="secondary" disabled={busy[p.key]}
                    onClick={() => onTest(p.key, models[p.key] || undefined)}
                  >
                    {busy[p.key] ? "Testing…" : "Test"}
                  </Button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>

      <div className="prov-save-row">
        <label className="prov-field prov-field-inline">
          <span>Default max output tokens</span>
          <input
            type="number" min={256} max={8192} value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value) || 4096)}
          />
        </label>
        <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save models"}</Button>
        {/* "Saved" and "live everywhere" are different moments. Each Netlify
            function holds its own 60s config cache, so a run can still use the
            previous model for up to a minute after this screen shows the new
            one — which is what made a working save look broken. */}
        <span className="prov-savedat" title="Each function caches this config for up to 60 seconds, so a change reaches every code path within a minute.">{savedLabel}</span>
      </div>
    </section>
  );
}

// ── Scrape + measurement services ────────────────────────────────────────────
const CAPABILITY_COPY = {
  render_js:          "Renders JavaScript",
  main_content:       "Isolates main content",
  structured_extract: "Server-side structured extraction",
  map:                "Domain mapping",
};

function ServicesTab({ providers, results, busy, onTest, onTestAll }) {
  return (
    <section className="prov-section">
      <div className="prov-section-head">
        <p className="muted">
          Scrape providers are a quality-ordered fallback chain: the first one that returns
          usable HTML wins. <strong>Direct fetch</strong> needs no key and is always last —
          it cannot render JavaScript or isolate main content, so it is the floor, not the default.
        </p>
        <Button variant="secondary" onClick={onTestAll}>Test data services</Button>
      </div>

      <div className="prov-grid">
        {providers.map((p) => {
          const r = results[p.key];
          return (
            <article key={p.key} className="prov-card">
              <header className="prov-card-head">
                <div>
                  <h3>{p.label}</h3>
                  {p.requiresKey === false && !p.apiKey?.present ? (
                    <div className="prov-key prov-key-optional">
                      <Icon name="check" size={13} />
                      <span>Works without a key{p.key === "pagespeed" ? " — but heavily rate-limited" : " at a lower rate limit"}</span>
                    </div>
                  ) : <KeyLine info={p.apiKey} />}
                </div>
                <ResultPill result={r} busy={busy[p.key]} />
              </header>

              {r && !r.ok ? (
                <div className="prov-error">
                  <strong>{(CODE_COPY[r.code] || CODE_COPY.error).text}</strong>
                  {r.error ? <div className="prov-error-raw">{r.error}</div> : null}
                </div>
              ) : null}
              {r && r.ok && r.note ? <div className="prov-note">{r.note}</div> : null}
              {r && r.ok && r.detail ? (
                <div className="prov-note">
                  Fetched <code>{r.detail.testUrl}</code>
                  {r.detail.htmlBytes ? ` — ${r.detail.htmlBytes.toLocaleString()} bytes` : ""}
                  {r.detail.returnedText ? ", with readable text" : ""}
                  {typeof r.detail.performanceScore === "number" ? ` — performance ${r.detail.performanceScore}` : ""}
                </div>
              ) : null}

              <div className="prov-meta">
                {(p.capabilities || []).map((c) => (
                  <span key={c} className="prov-tag">{CAPABILITY_COPY[c] || c}</span>
                ))}
                {(p.areas || []).map((a) => (
                  <span key={a} className="prov-tag prov-tag-area">{FUNCTION_AREAS[a]?.label || a}</span>
                ))}
              </div>

              <footer className="prov-card-foot">
                <span className="muted prov-foot-note">
                  {p.key === "firecrawl"
                    ? "The only provider that renders JS, isolates main content AND extracts structured data server-side."
                    : ""}
                </span>
                <div className="prov-card-actions">
                  {p.docsUrl ? (
                    <a className="prov-link" href={p.docsUrl} target="_blank" rel="noreferrer">Get a key</a>
                  ) : null}
                  <Button size="sm" variant="secondary" disabled={busy[p.key]} onClick={() => onTest(p.key)}>
                    {busy[p.key] ? "Testing…" : "Test"}
                  </Button>
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ── Function areas ───────────────────────────────────────────────────────────
// The "regions" view: which chain and tier each product feature runs on, shown
// as the EFFECTIVE value with its default clearly labelled, and changeable.
function AreasTab({ effective, areas, setAreas, byKey, results, saving, onSave, savedLabel }) {
  const setArea = (key, patch) =>
    setAreas((a) => ({ ...a, [key]: { ...(a[key] || {}), ...patch } }));
  const resetArea = (key) => setAreas((a) => ({ ...a, [key]: null }));

  const move = (key, provider, dir) => {
    const eff = effective[key];
    const current = areas[key]?.order || eff?.order || [];
    const i = current.indexOf(provider);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= current.length) return;
    const next = current.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setArea(key, { order: next });
  };

  return (
    <section className="prov-section">
      <p className="muted prov-section-intro">
        Each product feature runs its own provider chain and model tier. Anything left on
        <strong> Default</strong> follows the shipped configuration; change one and only that feature
        moves. This is also the answer to “if I disable a provider, what breaks?”.
      </p>

      {AI_AREA_KEYS.map((key) => {
        const eff = effective[key] || {
          label: FUNCTION_AREAS[key].label, blurb: FUNCTION_AREAS[key].blurb,
          userVisibleAs: FUNCTION_AREAS[key].userVisibleAs,
          order: FUNCTION_AREAS[key].defaultOrder, tier: FUNCTION_AREAS[key].defaultTier,
          resolvedModels: {}, isDefault: true,
          defaultOrder: FUNCTION_AREAS[key].defaultOrder, defaultTier: FUNCTION_AREAS[key].defaultTier,
        };
        const override = areas[key];
        const order = override?.order || eff.order;
        const tier = override?.tier || eff.tier;
        const customised = Boolean(override);

        return (
          <article key={key} className="prov-area">
            <header className="prov-area-head">
              <div>
                <h3>{eff.label}</h3>
                <p className="muted">{eff.blurb}</p>
                <p className="prov-area-visible">
                  <Icon name="eye" size={12} /> Seen by users as: {eff.userVisibleAs}
                </p>
              </div>
              <span className={`prov-pill ${customised ? "prov-pill-warn" : "prov-pill-idle"}`}>
                {customised ? "Customised" : "Default"}
              </span>
            </header>

            <div className="prov-area-body">
              <div className="prov-area-chain">
                <span className="prov-area-label">Provider order</span>
                <ol className="prov-chain">
                  {order.map((p, i) => {
                    const r = results[p];
                    return (
                      <li key={p} className="prov-chain-item">
                        <span className="prov-chain-rank">{i + 1}</span>
                        <span className="prov-chain-name">{byKey[p]?.label || PROVIDERS[p]?.label || p}</span>
                        <code className="prov-chain-model">{eff.resolvedModels?.[p] || defaultModel(p, tier)}</code>
                        {r ? (
                          <span className={`prov-dot prov-dot-${r.ok ? "ok" : "bad"}`}
                                title={r.ok ? "Tested working" : (r.hint || r.error || "Failing")} />
                        ) : null}
                        <span className="prov-chain-moves">
                          <button type="button" aria-label="Move up" disabled={i === 0}
                                  onClick={() => move(key, p, -1)}>↑</button>
                          <button type="button" aria-label="Move down" disabled={i === order.length - 1}
                                  onClick={() => move(key, p, 1)}>↓</button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="prov-area-tier">
                <span className="prov-area-label">Model tier</span>
                <div className="prov-tier-choice">
                  {[MODEL_TIER.FAST, MODEL_TIER.DEEP].map((t) => (
                    <button
                      key={t} type="button"
                      className={`prov-tier${tier === t ? " on" : ""}`}
                      onClick={() => setArea(key, { tier: t })}
                    >
                      {t === MODEL_TIER.FAST ? "Fast" : "Deep"}
                      {eff.defaultTier === t ? <em> (default)</em> : null}
                    </button>
                  ))}
                </div>
                <p className="muted prov-tier-hint">
                  {tier === MODEL_TIER.FAST
                    ? "Cheap and quick. Right for high-volume, low-judgement work."
                    : "Higher quality. Right for anything a customer reads as a deliverable."}
                </p>
                {customised ? (
                  <button type="button" className="prov-reset" onClick={() => resetArea(key)}>
                    Reset to default
                  </button>
                ) : null}
              </div>
            </div>
            <p className="prov-area-callsite"><code>{eff.callsite || FUNCTION_AREAS[key].callsite}</code></p>
          </article>
        );
      })}

      {/* Scrape/map/vitals chains are set by environment variable, not stored
          config — showing them read-only here is honest, and better than
          leaving an operator to guess where the order comes from. */}
      {FUNCTION_AREA_KEYS.filter((k) => FUNCTION_AREAS[k].kind !== "ai").map((key) => (
        <article key={key} className="prov-area prov-area-readonly">
          <header className="prov-area-head">
            <div>
              <h3>{FUNCTION_AREAS[key].label}</h3>
              <p className="muted">{FUNCTION_AREAS[key].blurb}</p>
              <p className="prov-area-visible">
                <Icon name="eye" size={12} /> Seen by users as: {FUNCTION_AREAS[key].userVisibleAs}
              </p>
            </div>
            <span className="prov-pill prov-pill-idle">Set by environment</span>
          </header>
          <ol className="prov-chain">
            {FUNCTION_AREAS[key].defaultOrder.map((p, i) => (
              <li key={p} className="prov-chain-item">
                <span className="prov-chain-rank">{i + 1}</span>
                <span className="prov-chain-name">{byKey[p]?.label || PROVIDERS[p]?.label || p}</span>
                {results[p] ? (
                  <span className={`prov-dot prov-dot-${results[p].ok ? "ok" : "bad"}`} />
                ) : null}
              </li>
            ))}
          </ol>
          <p className="prov-area-callsite">
            Override with <code>{key === "vitals" ? "PAGESPEED_API_KEY" : "SCRAPE_PROVIDER_ORDER"}</code> ·{" "}
            <code>{FUNCTION_AREAS[key].callsite}</code>
          </p>
        </article>
      ))}

      <div className="prov-save-row">
        <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save area settings"}</Button>
      </div>
    </section>
  );
}
