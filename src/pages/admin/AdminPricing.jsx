// AdminPricing.jsx — fully configurable plan pricing and limits editor.
import { useState } from "react";
import {
  getEffectivePlans, getEffectiveBundles, getEffectiveCreditPacks,
  setPlanOverride, resetPlanOverride, resetAllOverrides,
  getGlobalDiscount, setGlobalDiscount,
  setTopupOverride, setCreditPackOverride, resetCreditPackOverrides,
} from "../../lib/pricingOverrides.js";
import { getCoupons } from "../../lib/adminService.js";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

// Chargeable plan ids that the server (pricingSource.js) knows about.
// 🔴 DERIVED, NOT LISTED. This was the hand-written set
// ["select","pro","business","agency"] — which omitted **go** and
// **developer**, so an admin repricing Go got SQL that never mentioned it: the
// pricing page would show the new price while the server went on charging the
// static one. That is the single most expensive shape of drift this screen can
// produce, and a literal array is how it happened. Every purchasable plan is
// every plan with a price.
const serverPlanIds = (plans) => plans.filter((p) => Number(p.price_usd) > 0).map((p) => p.id);

const INF_LABEL = "Unlimited";

function parseLimit(val) {
  if (!val || val === "" || val === INF_LABEL.toLowerCase() || val === "unlimited" || val === "∞") return Infinity;
  const n = Number(val);
  return isNaN(n) ? Infinity : n;
}
function displayLimit(val) {
  return val === Infinity ? INF_LABEL : String(val);
}

function inrGst(v) {
  const n = Number(v);
  return n > 0 ? `₹${Math.round(n * 1.18).toLocaleString("en-IN")} incl. GST` : null;
}

function PlanEditor({ plan, onSave, onReset }) {
  const [form, setForm] = useState({
    price_usd:        plan.price_usd,
    price_usd_annual: plan.price_usd_annual ?? plan.price_usd,
    price_inr:        plan.price_inr ?? 0,
    price_inr_annual: plan.price_inr_annual ?? 0,
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
    priority_support: plan.limits.priority_support,
  });
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    onSave(plan.id, {
      price_usd:        Number(form.price_usd)        || 0,
      price_usd_annual: Number(form.price_usd_annual) || 0,
      price_inr:        Number(form.price_inr)        || 0,
      price_inr_annual: Number(form.price_inr_annual) || 0,
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
        priority_support:              form.priority_support,
      },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setOpen(false);
  };

  const f = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const inrMonthly = Number(form.price_inr);
  const inrAnnual  = Number(form.price_inr_annual);

  return (
    <div className="plan-editor-card card">
      <div className="plan-editor-header" onClick={() => setOpen((o) => !o)}>
        <div className="plan-editor-info">
          <span className="plan-editor-name">{form.name}</span>
          <span className="plan-editor-price">
            ${form.price_usd}/mo
            {inrMonthly > 0 && (
              <span className="plan-editor-price-inr"> · ₹{inrMonthly.toLocaleString("en-IN")}/mo</span>
            )}
          </span>
          {saved && <span className="plan-editor-badge" style={{ background: "var(--success-soft)", color: "var(--success)" }}>Saved</span>}
          {plan.highlight && !saved && <span className="plan-editor-badge">Highlighted</span>}
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
              <label>Badge text (empty = none)</label>
              <input type="text" placeholder="e.g. Most Popular" value={form.badge}
                onChange={(e) => f("badge", e.target.value)} />
            </div>
          </div>

          {/* USD Pricing */}
          <div className="admin-price-section-label">
            <Icon name="dollar-sign" size={13} /> USD Pricing
          </div>
          <div className="cf-row">
            <div className="cf-field">
              <label>Monthly price (USD)</label>
              <div className="price-input-wrap">
                <span className="price-prefix">$</span>
                <input type="number" min="0" step="0.01" value={form.price_usd}
                  onChange={(e) => f("price_usd", e.target.value)} />
              </div>
            </div>
            <div className="cf-field">
              <label>Annual monthly equiv. (USD)</label>
              <div className="price-input-wrap">
                <span className="price-prefix">$</span>
                <input type="number" min="0" step="0.01" value={form.price_usd_annual}
                  onChange={(e) => f("price_usd_annual", e.target.value)} />
              </div>
              <p className="cf-hint">Shown on /pricing when "Annual" is selected.</p>
            </div>
          </div>

          {/* INR Pricing */}
          <div className="admin-price-section-label">
            <Icon name="indian-rupee" size={13} /> INR Pricing
            <span className="admin-price-section-hint">Base prices (pre-GST). 18% GST added at checkout.</span>
          </div>
          <div className="cf-row">
            <div className="cf-field">
              <label>Monthly price (INR, base)</label>
              <div className="price-input-wrap">
                <span className="price-prefix">₹</span>
                <input type="number" min="0" step="1" value={form.price_inr}
                  onChange={(e) => f("price_inr", e.target.value)} />
              </div>
              {inrGst(form.price_inr) && <p className="cf-hint">{inrGst(form.price_inr)}/mo charged</p>}
            </div>
            <div className="cf-field">
              <label>Annual monthly equiv. (INR, base)</label>
              <div className="price-input-wrap">
                <span className="price-prefix">₹</span>
                <input type="number" min="0" step="1" value={form.price_inr_annual}
                  onChange={(e) => f("price_inr_annual", e.target.value)} />
              </div>
              {inrGst(form.price_inr_annual) && <p className="cf-hint">{inrGst(form.price_inr_annual)}/mo charged (annual billing)</p>}
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
              { key: "white_label_pdf", label: "White-label PDF (Business + Agency)" },
              { key: "priority_support", label: "Priority support (Business + Agency)" },
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
  const [form, setForm] = useState({
    price_usd:   bundle.price_usd,
    price_inr:   bundle.price_inr ?? 0,
    name:        bundle.name,
    description: bundle.description,
  });
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
          <div className="price-input-wrap">
            <span className="price-prefix">$</span>
            <input type="number" min="0" step="0.01" value={form.price_usd}
              onChange={(e) => f("price_usd", e.target.value)} />
          </div>
        </div>
        <div className="cf-field">
          <label>Price (INR, base)</label>
          <div className="price-input-wrap">
            <span className="price-prefix">₹</span>
            <input type="number" min="0" step="1" value={form.price_inr}
              onChange={(e) => f("price_inr", e.target.value)} />
          </div>
          {inrGst(form.price_inr) && <p className="cf-hint">{inrGst(form.price_inr)} charged</p>}
        </div>
      </div>
      <div className="cf-field">
        <label>Description</label>
        <input type="text" value={form.description} onChange={(e) => f("description", e.target.value)} />
      </div>
      <Button variant="secondary" size="sm" onClick={() => onSave(bundle.id, { price_usd: Number(form.price_usd), price_inr: Number(form.price_inr), name: form.name, description: form.description })}>
        Save
      </Button>
    </div>
  );
}

/**
 * Credit packs — price AND the number of credits the purchase grants.
 *
 * 🔴 `credits` IS EDITABLE AND MUST REACH THE SERVER. It is what
 * `verify-payment` reads to decide how many credits the ledger is granted, so
 * a screen that let an admin change the price and not the grant would sell
 * "2,000 credits" at a new price and deliver whatever the server still held.
 * `buildServerConfig` carries it into the generated SQL for the same reason.
 *
 * ⚠️ The per-credit rate is shown live because it is the number that actually
 * matters: a pack must stay worse value than every plan, or nobody upgrades.
 * pricingConfig.test.js asserts that property against the shipped table; this
 * shows an operator the same thing before they save something that breaks it.
 */
function CreditPackEditor({ pack, onSave }) {
  const [form, setForm] = useState({
    price_usd: pack.price_usd,
    price_inr: pack.price_inr ?? 0,
    credits:   pack.credits,
    name:      pack.name,
  });
  const [saved, setSaved] = useState(false);
  const f = (k, v) => { setForm((p) => ({ ...p, [k]: v })); setSaved(false); };

  const credits = Number(form.credits) || 0;
  const perCredit = credits > 0 ? Number(form.price_usd) / credits : 0;

  return (
    <div className="bundle-editor-row card card-pad">
      <div className="cf-row">
        <div className="cf-field" style={{ flex: 2 }}>
          <label>{pack.id} — Name</label>
          <input type="text" value={form.name} onChange={(e) => f("name", e.target.value)} />
        </div>
        <div className="cf-field">
          <label>Credits granted</label>
          <input type="number" min="1" step="1" value={form.credits}
            onChange={(e) => f("credits", e.target.value)} />
        </div>
        <div className="cf-field">
          <label>Price (USD)</label>
          <div className="price-input-wrap">
            <span className="price-prefix">$</span>
            <input type="number" min="0" step="0.01" value={form.price_usd}
              onChange={(e) => f("price_usd", e.target.value)} />
          </div>
        </div>
        <div className="cf-field">
          <label>Price (INR, base)</label>
          <div className="price-input-wrap">
            <span className="price-prefix">₹</span>
            <input type="number" min="0" step="1" value={form.price_inr}
              onChange={(e) => f("price_inr", e.target.value)} />
          </div>
          {inrGst(form.price_inr) && <p className="cf-hint">{inrGst(form.price_inr)} charged</p>}
        </div>
      </div>
      <p className="cf-hint">
        ${perCredit.toFixed(4)} per credit · packs must stay dearer per credit than every plan,
        or a customer is better off buying credits than upgrading.
      </p>
      <Button variant="secondary" size="sm" onClick={() => {
        onSave(pack.id, {
          price_usd: Number(form.price_usd),
          price_inr: Number(form.price_inr),
          credits:   Number(form.credits),
          name:      form.name,
        });
        setSaved(true);
      }}>
        {saved ? "Saved" : "Save"}
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

// Builds the operator-managed server config (mirrors netlify/functions/lib/pricingSource.js
// shapes) from the current effective plans/bundles/coupons/global discount.
function buildServerConfig(plans, bundles, packs = []) {
  const ids = new Set(serverPlanIds(plans));
  const planMap = {};
  for (const p of plans) {
    if (!ids.has(p.id)) continue;
    planMap[p.id] = {
      usd:        Number(p.price_usd)        || 0,
      usd_annual: Number(p.price_usd_annual) || 0,
      inr:        Number(p.price_inr)        || 0,
      inr_annual: Number(p.price_inr_annual) || 0,
    };
  }
  // Packs and capacity add-ons share one server row: `pricing_config.bundles` is
  // keyed by purchasable id and does not care which kind a thing is.
  // ⚠️ A pack carries `credits`, which decides how many credits the purchase
  // GRANTS (verify-payment reads it). Omitting it here would sell 2,000 credits
  // at the new price and deliver whatever the static table still says.
  const bundleMap = {};
  for (const b of bundles) {
    bundleMap[b.id] = { usd: Number(b.price_usd) || 0, inr: Number(b.price_inr) || 0 };
  }
  for (const p of packs) {
    bundleMap[p.id] = {
      usd: Number(p.price_usd) || 0,
      inr: Number(p.price_inr) || 0,
      credits: Number(p.credits) || 0,
    };
  }
  const coupons = {};
  for (const c of getCoupons()) {
    if (c.type !== "percent") continue; // only percent coupons affect charges
    coupons[c.code.toUpperCase()] = {
      value:     Number(c.value) || 0,
      planId:    c.planId || null,
      expiresAt: c.expiresAt || null,
      active:    !!c.active,
      maxUses:   Number(c.maxUses) || 0, // 0 = unlimited; enforced via redeem_coupon RPC
    };
  }
  const g = getGlobalDiscount();
  const global = { percent: Number(g.percent) || 0, active: !!g.active, expiresAt: g.expiresAt || null };
  return { plans: planMap, bundles: bundleMap, coupons, global };
}

function toSql(config) {
  const row = (key) => `  ('${key}', '${JSON.stringify(config[key]).replace(/'/g, "''")}'::jsonb)`;
  return (
    "insert into public.pricing_config (key, value) values\n" +
    ["plans", "bundles", "coupons", "global"].map(row).join(",\n") +
    "\non conflict (key) do update set value = excluded.value, updated_at = now();"
  );
}

function ServerConfigPanel({ plans, bundles, packs = [] }) {
  const [sql, setSql]     = useState("");
  const [copied, setCopied] = useState(false);

  const generate = () => { setSql(toSql(buildServerConfig(plans, bundles, packs))); setCopied(false); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="card card-pad" style={{ marginTop: 28 }}>
      <div className="admin-chart-title"><Icon name="database" size={14} />Live-charge config (server source of truth)</div>
      <p className="admin-section-sub" style={{ marginTop: 6 }}>
        Plan, pack and add-on prices above take effect on the <strong>pricing page</strong> immediately.
        To make them apply to <strong>real charges</strong>, run this SQL in Supabase (table&nbsp;
        <code>pricing_config</code>). The server uses the static table until a row exists, then operator
        overrides prevail. Coupons and the global discount are included.
      </p>
      <div className="cf-actions" style={{ marginBottom: 12 }}>
        <Button variant="primary" size="sm" onClick={generate}>Generate SQL</Button>
        {sql && <Button variant="secondary" size="sm" onClick={copy}>{copied ? "Copied!" : "Copy SQL"}</Button>}
      </div>
      {sql && (
        <textarea readOnly value={sql} spellCheck={false}
          style={{ width: "100%", minHeight: 180, fontFamily: "var(--font-mono, monospace)", fontSize: 12,
                   padding: 12, borderRadius: 8, border: "1px solid var(--border-1, #ddd)", background: "var(--bg-2, #fafafa)" }} />
      )}
    </div>
  );
}

export default function AdminPricing() {
  const [plans, setPlans]     = useState(() => getEffectivePlans());
  const [bundles, setBundles] = useState(() => getEffectiveBundles());
  const [packs, setPacks]     = useState(() => getEffectiveCreditPacks());
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
    resetCreditPackOverrides();
    setPlans(getEffectivePlans());
    setPacks(getEffectiveCreditPacks());
    setResetKey((k) => k + 1);
  };
  const handleBundleSave = (bundleId, ov) => {
    setTopupOverride(bundleId, ov);
    setBundles(getEffectiveBundles());
  };
  const handlePackSave = (packId, ov) => {
    setCreditPackOverride(packId, ov);
    setPacks(getEffectiveCreditPacks());
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
        <Icon name="zap" size={14} />Credit pack pricing
      </div>
      <p className="admin-section-sub" style={{ marginTop: -6, marginBottom: 12 }}>
        Packs buy credits outright and never expire. Both the price and the number of credits
        granted are editable — the grant is what <code>verify-payment</code> writes to the ledger.
      </p>
      <div className="plan-editors" key={`packs-${resetKey}`}>
        {packs.map((p) => (
          <CreditPackEditor key={p.id} pack={p} onSave={handlePackSave} />
        ))}
      </div>

      <div className="admin-chart-title" style={{ marginTop: 28, marginBottom: 12 }}>
        <Icon name="layers" size={14} />Capacity add-on pricing
      </div>
      <p className="admin-section-sub" style={{ marginTop: -6, marginBottom: 12 }}>
        An add-on buys the right to do something; the doing still costs credits. Changing a price
        here does not change what a run consumes.
      </p>
      <div className="plan-editors">
        {bundles.map((b) => (
          <BundleEditor key={b.id} bundle={b} onSave={handleBundleSave} />
        ))}
      </div>

      <ServerConfigPanel plans={plans} bundles={bundles} packs={packs} />
    </div>
  );
}
