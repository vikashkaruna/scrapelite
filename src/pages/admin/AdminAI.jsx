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
  gemini:    { label: "Google Gemini",    keyEnv: "GEMINI_API_KEY" },
  anthropic: { label: "Anthropic Claude", keyEnv: "AI_API_KEY" },
  openai:    { label: "OpenAI",           keyEnv: "OPENAI_API_KEY" },
};
const FALLBACK_MODELS = {
  gemini: "gemini-2.5-flash",
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4o-mini",
};

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

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getAiConfig();
      const known = Object.keys(data.providers || {});
      setProviders(data.providers || {});
      setKeyPresence(data.keyPresence || {});
      setPersisted(data.persisted !== false);
      const cfg = data.config || {};
      // Ensure every known provider is present in the ordered list.
      const ord = (cfg.order || RECOMMENDED_ORDER).filter((p) => known.includes(p));
      for (const p of known) if (!ord.includes(p)) ord.push(p);
      setOrder(ord);
      setModels({ ...(cfg.models || {}) });
      setEnabled(known.reduce((m, p) => ({ ...m, [p]: cfg.enabled?.[p] !== false }), {}));
      setMaxTokens(cfg.maxTokens || 1024);
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
      setError("Live config endpoint unreachable — showing defaults. Run with Netlify Functions to load/save server config.");
    } finally {
      setLoading(false);
    }
  }

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveAiConfig({ order, models, enabled, maxTokens: Number(maxTokens) || 1024 });
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
    const known = Object.keys(providers);
    const ord = RECOMMENDED_ORDER.filter((p) => known.includes(p));
    for (const p of known) if (!ord.includes(p)) ord.push(p);
    setOrder(ord);
  };

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading"><Icon name="loader" size={18} className="spin" /> Loading AI config…</div>
      </div>
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">AI Providers</h2>
          <p className="admin-section-sub">
            Set the fallback order and model per provider. Requests try each enabled provider
            (with a key) top-to-bottom; the first success wins. Auto-fallback always applies.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={resetOrder}>Reset to recommended</Button>
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
        {order.map((p, i) => {
          const meta = providers[p] || {};
          const hasKey = !!keyPresence[p];
          const on = enabled[p] !== false;
          return (
            <div key={p} className={"admin-ai-row card" + (on ? "" : " disabled")}>
              <div className="admin-ai-rank">{i + 1}</div>

              <div className="admin-ai-reorder">
                <button className="icon-action" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <Icon name="chevron-up" size={14} />
                </button>
                <button className="icon-action" disabled={i === order.length - 1} onClick={() => move(i, 1)} title="Move down">
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
                    value={models[p] || ""}
                    placeholder="provider model id"
                    onChange={(e) => setModels((m) => ({ ...m, [p]: e.target.value }))}
                  />
                </div>
              </div>

              <label className="flag-label admin-ai-enable">
                <input type="checkbox" checked={on}
                  onChange={(e) => setEnabled((m) => ({ ...m, [p]: e.target.checked }))} />
                Enabled
              </label>
            </div>
          );
        })}
      </div>

      <div className="admin-ai-footer card card-pad">
        <div className="cf-field" style={{ maxWidth: 220 }}>
          <label>Default max tokens (per request)</label>
          <input type="number" min="64" max="8192" step="64" value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)} />
        </div>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : savedTick ? "Saved!" : "Save configuration"}
        </Button>
      </div>
    </div>
  );
}
