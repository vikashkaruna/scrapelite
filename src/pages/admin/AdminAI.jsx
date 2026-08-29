// AdminAI.jsx — configure the AI provider fallback chain (order, models, enable).
// The actual provider API keys live server-side (env); this screen only manages
// the non-secret routing config persisted to Supabase app_config via the
// admin-ai-config function. Auto-fallback always applies at request time.
import { useState, useEffect } from "react";
import { getAiConfig, saveAiConfig } from "../../lib/adminConfigService.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const RECOMMENDED_ORDER = ["gemini", "anthropic", "openai"]; // cost-first

// Client-side fallback metadata — used to render a usable screen when the
// admin-ai-config function is unreachable (e.g. plain `vite` dev). Mirrors the
// server registry in netlify/functions/lib/aiProviders.js.
const FALLBACK_PROVIDERS = {
  gemini:     { label: "Google Gemini",    keyEnv: "GEMINI_API_KEY" },
  anthropic:  { label: "Anthropic Claude", keyEnv: "AI_API_KEY" },
  openai:     { label: "OpenAI",           keyEnv: "OPENAI_API_KEY" },
  perplexity: { label: "Perplexity",       keyEnv: "PERPLEXITY_API_KEY" },
};
const FALLBACK_MODELS = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
  perplexity: "sonar",
};

// Mirrors PILLAR_KEYS in netlify/functions/lib/aiProviders.js. A pillar is an
// OPTIONAL override of the default chain above for one module — omit it and
// that module just uses the default chain. Perplexity is deliberately not in
// RECOMMENDED_ORDER (it's a live-retrieval engine with its own cost/latency
// profile), so it only shows up by default in the discoverability pillar,
// where its citation URLs are the actual point.
const PILLARS = [
  { key: "discoverability", label: "Discoverability & citation sampling",
    hint: "Used by the audit engine's AI evaluators and citation sampling (askAiChain / askPerplexity). Falls back to the default chain above for anything left unset here." },
];
const PILLAR_RECOMMENDED_ORDER = { discoverability: ["perplexity", "gemini", "anthropic", "openai"] };

export default function AdminAI() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState({});
  const [keyPresence, setKeyPresence] = useState({});
  const [persisted, setPersisted] = useState(true);

  const [order, setOrder] = useState([]);
  const [models, setModels] = useState({});
  const [enabled, setEnabled] = useState({});
  const [maxTokens, setMaxTokens] = useState(1024);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // Pillar overrides — each pillar key maps to its own {order, models,
  // enabled}, independent of the default chain above. `null` (rather than
  // missing) is what "no override, falls back to default" looks like once
  // loaded, so a pillar tab can tell "never customized" apart from
  // "customized to be the same as default".
  const [activePillar, setActivePillar] = useState(null); // null = "Default chain" tab
  const [pillars, setPillars] = useState({}); // { [key]: {order, models, enabled} | null }

  useEffect(() => { load(); }, []);

  function pillarDefaultOrder(key, known) {
    const rec = (PILLAR_RECOMMENDED_ORDER[key] || order).filter((p) => known.includes(p));
    for (const p of known) if (!rec.includes(p)) rec.push(p);
    return rec;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getAiConfig();
      const known = Object.keys(data.providers || {});
      // Perplexity is a genuine chain member (has a key-presence badge, a
      // model field, an enable toggle) but is deliberately excluded from the
      // DEFAULT chain's auto-append below — it's the discoverability pillar's
      // provider, not a silent addition to every enrichment/extraction call
      // the moment this feature ships. It's still fully visible under its
      // pillar tab.
      const knownForDefault = known.filter((p) => p !== "perplexity");
      setProviders(data.providers || {});
      setKeyPresence(data.keyPresence || {});
      setPersisted(data.persisted !== false);
      const cfg = data.config || {};
      // Ensure every known (non-pillar-only) provider is present in the ordered list.
      const ord = (cfg.order || RECOMMENDED_ORDER).filter((p) => knownForDefault.includes(p));
      for (const p of knownForDefault) if (!ord.includes(p)) ord.push(p);
      setOrder(ord);
      setModels({ ...(cfg.models || {}) });
      setEnabled(knownForDefault.reduce((m, p) => ({ ...m, [p]: cfg.enabled?.[p] !== false }), {}));
      setMaxTokens(cfg.maxTokens || 1024);

      const nextPillars = {};
      for (const p of PILLARS) {
        const stored = cfg.pillars?.[p.key];
        nextPillars[p.key] = stored
          ? {
              order: (stored.order?.length ? stored.order : pillarDefaultOrder(p.key, known)).filter((k) => known.includes(k)),
              models: { ...(stored.models || {}) },
              enabled: { ...(stored.enabled || {}) },
            }
          : null; // no override stored — this pillar just uses the default chain
      }
      setPillars(nextPillars);
    } catch (e) {
      // Function unreachable (e.g. plain vite dev) — render usable defaults so the
      // screen still works; saving will report not-persisted.
      setProviders(FALLBACK_PROVIDERS);
      setKeyPresence({});
      setPersisted(false);
      setOrder(RECOMMENDED_ORDER.slice());
      setModels({ ...FALLBACK_MODELS });
      setEnabled({ gemini: true, anthropic: true, openai: true });
      setMaxTokens(1024);
      setPillars(Object.fromEntries(PILLARS.map((p) => [p.key, null])));
      setError("Live config endpoint unreachable — showing defaults. Run with Netlify Functions to load/save server config.");
    } finally {
      setLoading(false);
    }
  }

  // Current view's order/models/enabled + setters — the same row UI below
  // renders either the default chain or whichever pillar tab is active.
  const known = Object.keys(providers);
  const viewingPillar = activePillar
    ? (pillars[activePillar] || { order: pillarDefaultOrder(activePillar, known), models: {}, enabled: {} })
    : null;
  const viewOrder = activePillar ? viewingPillar.order : order;
  const viewModels = activePillar ? viewingPillar.models : models;
  const viewEnabled = activePillar ? viewingPillar.enabled : enabled;

  function setPillarField(key, patch) {
    setPillars((prev) => ({
      ...prev,
      [key]: { ...(prev[key] || { order: pillarDefaultOrder(key, known), models: {}, enabled: {} }), ...patch },
    }));
  }

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= viewOrder.length) return;
    const next = viewOrder.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    if (activePillar) setPillarField(activePillar, { order: next });
    else setOrder(next);
  };

  const setViewModel = (p, value) => {
    if (activePillar) setPillarField(activePillar, { models: { ...viewModels, [p]: value } });
    else setModels((m) => ({ ...m, [p]: value }));
  };

  const setViewEnabled = (p, value) => {
    if (activePillar) setPillarField(activePillar, { enabled: { ...viewEnabled, [p]: value } });
    else setEnabled((m) => ({ ...m, [p]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const pillarsPayload = {};
      for (const p of PILLARS) {
        if (pillars[p.key]) pillarsPayload[p.key] = pillars[p.key];
      }
      const res = await saveAiConfig({
        order, models, enabled, maxTokens: Number(maxTokens) || 1024,
        pillars: pillarsPayload,
      });
      if (res.persisted === false) {
        showToast(res.warning || "Saved locally — Supabase not configured, not persisted.");
      } else {
        showToast("AI provider config saved.");
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1800);
      }
    } catch (e) {
      showToast(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const resetOrder = () => {
    if (activePillar) {
      setPillarField(activePillar, { order: pillarDefaultOrder(activePillar, known) });
      return;
    }
    const knownForDefault = known.filter((p) => p !== "perplexity");
    const ord = RECOMMENDED_ORDER.filter((p) => knownForDefault.includes(p));
    for (const p of knownForDefault) if (!ord.includes(p)) ord.push(p);
    setOrder(ord);
  };

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading"><Icon name="loader" size={18} className="spin" /> Loading AI config…</div>
      </div>
    );
  }

  const activePillarMeta = activePillar ? PILLARS.find((p) => p.key === activePillar) : null;

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">AI Providers</h2>
          <p className="admin-section-sub">
            {activePillar
              ? activePillarMeta?.hint
              : "Set the fallback order and model per provider. Requests try each enabled provider (with a key) top-to-bottom; the first success wins. Auto-fallback always applies."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={resetOrder}>Reset to recommended</Button>
      </div>

      {/* Pillar switcher — "Default chain" is the global order every enrichment
          call uses; each pillar tab is an optional, independently-ordered
          override for one module (see PILLARS above). Unset fields on a
          pillar fall back to the default chain field-by-field on the server
          (resolvePillarChain in aiProviders.js), so switching tabs never
          loses anything — it's just a different view onto the same config. */}
      <div className="admin-ai-pillar-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={!activePillar}
          className={"admin-ai-pillar-tab" + (!activePillar ? " active" : "")}
          onClick={() => setActivePillar(null)}
        >
          Default chain
        </button>
        {PILLARS.map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={activePillar === p.key}
            className={"admin-ai-pillar-tab" + (activePillar === p.key ? " active" : "")}
            onClick={() => setActivePillar(p.key)}
          >
            {p.label}
            {pillars[p.key] && <span className="admin-ai-pillar-tab-dot" title="Customized — overrides the default chain" />}
          </button>
        ))}
      </div>

      {!persisted && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} />
          <span>
            Supabase isn’t configured on the server (<code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_KEY</code>),
            so changes won’t persist. The server will use env / built-in defaults
            (Gemini → Claude → OpenAI).
          </span>
        </div>
      )}
      {error && (
        <div className="admin-ai-notice warn"><Icon name="alert-circle" size={15} /><span>{error}</span></div>
      )}

      <div className="admin-ai-chain">
        {viewOrder.map((p, i) => {
          const meta = providers[p] || {};
          const hasKey = !!keyPresence[p];
          const on = viewEnabled[p] !== false;
          return (
            <div key={p} className={"admin-ai-row card" + (on ? "" : " disabled")}>
              <div className="admin-ai-rank">{i + 1}</div>

              <div className="admin-ai-reorder">
                <button className="icon-action" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <Icon name="chevron-up" size={14} />
                </button>
                <button className="icon-action" disabled={i === viewOrder.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <Icon name="chevron-down" size={14} />
                </button>
              </div>

              <div className="admin-ai-main">
                <div className="admin-ai-name-row">
                  <span className="admin-ai-name">{meta.label || p}</span>
                  <span className={"admin-ai-keybadge" + (hasKey ? " ok" : "")}>
                    <Icon name={hasKey ? "check-circle" : "alert-circle"} size={12} />
                    {hasKey ? "Key configured" : `No key (${meta.keyEnv || "—"})`}
                  </span>
                </div>
                <div className="cf-field admin-ai-model">
                  <label>Model ID</label>
                  <input
                    type="text"
                    value={viewModels[p] || ""}
                    placeholder="provider model id"
                    onChange={(e) => setViewModel(p, e.target.value)}
                  />
                </div>
              </div>

              <label className="flag-label admin-ai-enable">
                <input type="checkbox" checked={on}
                  onChange={(e) => setViewEnabled(p, e.target.checked)} />
                Enabled
              </label>
            </div>
          );
        })}
      </div>

      <div className="admin-ai-footer card card-pad">
        {activePillar ? (
          <p className="admin-section-sub" style={{ margin: 0 }}>
            Max tokens per request is set on the Default chain tab and applies here too.
          </p>
        ) : (
          <div className="cf-field" style={{ maxWidth: 220 }}>
            <label>Default max tokens (per request)</label>
            <input type="number" min="64" max="8192" step="64" value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)} />
          </div>
        )}
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : savedTick ? "Saved!" : "Save configuration"}
        </Button>
      </div>
    </div>
  );
}
