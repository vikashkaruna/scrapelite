// AdminPricing.jsx — fully configurable plan pricing and limits editor.
import { useState } from "react";
import {
  getEffectivePlans, getEffectiveBundles,
  setPlanOverride, resetPlanOverride, resetAllOverrides,
  getGlobalDiscount, setGlobalDiscount,
  setTopupOverride,
} from "../../lib/pricingOverrides.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const INF_LABEL = "Unlimited";

function parseLimit(val) {
  if (!val || val === "" || val === INF_LABEL.toLowerCase() || val === "unlimited" || val === "∞") return Infinity;
  const n = Number(val);
  return isNaN(n) ? Infinity : n;
}
function displayLimit(val) {
  return val === Infinity ? INF_LABEL : String(val);
}

function PlanEditor({ plan, onSave, onReset }) {
  const [form, setForm] = useState({
    price_usd:   plan.price_usd,
    name:        plan.name,
    tagline:     plan.tagline ?? "",
    badge:       plan.badge ?? "",
    highlight:   plan.highlight ?? false,
    extractions: displayLimit(plan.limits.extractions),
    enrichments: displayLimit(plan.limits.enrichments_per_extraction),
    seats:       displayLimit(plan.limits.team_seats),
    schedules:   displayLimit(plan.limits.scheduled_monitoring),
    batch_max_urls:  plan.limits.batch_max_urls ?? 0,
    email_export:    plan.limits.email_export,
    api_access:      plan.limits.api_access,
    white_label_pdf: plan.limits.white_label_pdf,
  });
  const [open, setOpen] = useState(false);

  const save = () => {
    onSave(plan.id, {
      price_usd: Number(form.price_usd) || 0,
      name:      form.name,
      tagline:   form.tagline,
      badge:     form.badge || null,
      highlight: form.highlight,
      limits: {
        extractions:                   parseLimit(form.extractions),
        enrichments_per_extraction:    parseLimit(form.enrichments),
        team_seats:                    parseLimit(form.seats),
        scheduled_monitoring:          parseLimit(form.schedules),
        batch_max_urls:                Number(form.batch_max_urls) || 0,
        email_export:                  form.email_export,
        api_access:                    form.api_access,
        white_label_pdf:               form.white_label_pdf,
      },
    });
    setOpen(false);
  };

  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="plan-editor-card card">
      <div className="plan-editor-header" onClick={() => setOpen((o) => !o)}>
        <div className="plan-editor-info">
          <span className="plan-editor-name">{form.name}</span>
          <span className="plan-editor-price">${form.price_usd}/mo</span>
          {plan.highlight && <span className="plan-editor-badge">Highlighted</span>}
        </div>
        <div className="plan-editor-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-action" title="Reset to defaults" onClick={() => { onReset(plan.id); }}>
            <Icon name="refresh" size={14} />
          </button>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={16} style={{ color: "var(--text-3)" }} />
        </div>
      </div>

      {open && (
        <div className="plan-editor-body">
          <div className="cf-row">
            <div className="cf-field">
              <label>Plan name</label>
              <input type="text" value={form.name} onChange={(e) => f("name", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Price (USD / month)</label>
              <input type="number" min="0" step="0.01" value={form.price_usd}
                onChange={(e) => f("price_usd", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Badge text (empty = none)</label>
              <input type="text" placeholder="e.g. Most Popular" value={form.badge}
                onChange={(e) => f("badge", e.target.value)} />
            </div>
          </div>

          <div className="cf-field" style={{ marginBottom: 14 }}>
            <label>Tagline</label>
            <input type="text" value={form.tagline} onChange={(e) => f("tagline", e.target.value)} />
          </div>

          <div className="cf-row">
            <div className="cf-field">
              <label>Extractions / month ("Unlimited" or number)</label>
              <input type="text" value={form.extractions}
                onChange={(e) => f("extractions", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Enrichments / extraction</label>
              <input type="text" value={form.enrichments}
                onChange={(e) => f("enrichments", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Team seats</label>
              <input type="text" value={form.seats}
                onChange={(e) => f("seats", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Scheduled monitors</label>
              <input type="text" value={form.schedules}
                onChange={(e) => f("schedules", e.target.value)} />
            </div>
            <div className="cf-field">
              <label>Batch URL limit (0 = disabled)</label>
              <input type="number" min="0" step="50" value={form.batch_max_urls}
                onChange={(e) => f("batch_max_urls", e.target.value)} />
            </div>
          </div>

          <div className="plan-editor-flags">
            {[
              { key: "highlight",       label: "Highlight card (recommended)" },
              { key: "email_export",    label: "Email export" },
              { key: "api_access",      label: "API access" },
              { key: "white_label_pdf", label: "White-label PDF" },
            ].map(({ key, label }) => (
              <label key={key} className="flag-label">
                <input type="checkbox" checked={!!form[key]}
                  onChange={(e) => f(key, e.target.checked)} />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="cf-actions">
            <Button variant="primary" size="sm" onClick={save}>Save changes</Button>
            <Button variant="ghost"   size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BundleEditor({ bundle, onSave }) {
  const [form, setForm] = useState({ price_usd: bundle.price_usd, name: bundle.name, description: bundle.description });
  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  return (
    <div className="bundle-editor-row card card-pad">
      <div className="cf-row">
        <div className="cf-field" style={{ flex: 2 }}>
          <label>{bundle.id} — Name</label>
          <input type="text" value={form.name} onChange={(e) => f("name", e.target.value)} />
        </div>
        <div className="cf-field">
          <label>Price (USD)</label>
          <input type="number" min="0" step="0.01" value={form.price_usd}
            onChange={(e) => f("price_usd", e.target.value)} />
        </div>
      </div>
      <div className="cf-field">
        <label>Description</label>
        <input type="text" value={form.description} onChange={(e) => f("description", e.target.value)} />
      </div>
      <Button variant="secondary" size="sm" onClick={() => onSave(bundle.id, { price_usd: Number(form.price_usd), name: form.name, description: form.description })}>
        Save
      </Button>
    </div>
  );
}

function GlobalDiscountEditor() {
  const [disc, setDisc]  = useState(() => getGlobalDiscount());
  const [saved, setSaved] = useState(false);

  const save = () => {
    setGlobalDiscount(disc);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const f = (k, v) => setDisc((d) => ({ ...d, [k]: v }));

  return (
    <div className="card card-pad">
      <div className="admin-chart-title"><Icon name="percent" size={14} />Global Discount (applies to all paid plans)</div>
      <div className="cf-row" style={{ marginTop: 16 }}>
        <div className="cf-field">
          <label>Discount %</label>
          <input type="number" min="0" max="100" value={disc.percent}
            onChange={(e) => f("percent", Number(e.target.value))} />
        </div>
        <div className="cf-field" style={{ flex: 2 }}>
          <label>Label (shown on pricing page)</label>
          <input type="text" placeholder="e.g. Summer sale — 20% off" value={disc.label}
            onChange={(e) => f("label", e.target.value)} />
        </div>
        <div className="cf-field">
          <label>Expiry date (optional)</label>
          <input type="date" value={disc.expiresAt ?? ""}
            onChange={(e) => f("expiresAt", e.target.value || null)} />
        </div>
      </div>
      <div className="cf-row">
        <label className="flag-label">
          <input type="checkbox" checked={!!disc.active} onChange={(e) => f("active", e.target.checked)} />
          <span>Enable global discount</span>
        </label>
      </div>
      <div className="cf-actions" style={{ marginTop: 14 }}>
        <Button variant="primary" size="sm" onClick={save}>{saved ? "Saved!" : "Save discount"}</Button>
      </div>
    </div>
  );
}

export default function AdminPricing() {
  const [plans, setPlans]     = useState(() => getEffectivePlans());
  const [bundles, setBundles] = useState(() => getEffectiveBundles());
  const [resetKey, setResetKey] = useState(0);

  const handleSave = (planId, overrides) => {
    setPlanOverride(planId, overrides);
    setPlans(getEffectivePlans());
  };
  const handleReset = (planId) => {
    resetPlanOverride(planId);
    setPlans(getEffectivePlans());
  };
  const handleResetAll = () => {
    if (!window.confirm("Reset ALL plan pricing to defaults? This cannot be undone.")) return;
    resetAllOverrides();
    setPlans(getEffectivePlans());
    setResetKey((k) => k + 1);
  };
  const handleBundleSave = (bundleId, ov) => {
    setTopupOverride(bundleId, ov);
    setBundles(getEffectiveBundles());
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">Pricing Configuration</h2>
          <p className="admin-section-sub">
            Override plan prices and limits. Changes take effect immediately — no redeploy needed.
          </p>
        </div>
        <Button variant="danger" size="sm" onClick={handleResetAll}>Reset all to defaults</Button>
      </div>

      <GlobalDiscountEditor />

      <div className="admin-chart-title" style={{ marginBottom: 12 }}>
        <Icon name="layers" size={14} />Plan pricing &amp; limits
      </div>
      <div className="plan-editors" key={resetKey}>
        {plans.map((p) => (
          <PlanEditor key={p.id} plan={p} onSave={handleSave} onReset={handleReset} />
        ))}
      </div>

      <div className="admin-chart-title" style={{ marginTop: 28, marginBottom: 12 }}>
        <Icon name="zap" size={14} />Top-up bundle pricing
      </div>
      <div className="plan-editors">
        {bundles.map((b) => (
          <BundleEditor key={b.id} bundle={b} onSave={handleBundleSave} />
        ))}
      </div>
    </div>
  );
}
