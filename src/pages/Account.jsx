// Account.jsx — V5 billing & usage: plan details, usage, alerts, coupon, payment history.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { getEffectivePlans, getEffectivePlanById } from "../lib/pricingOverrides.js";
import { formatPrice, convertPrice } from "../lib/currencyService.js";
import { getAlertConfig, saveAlertConfig } from "../lib/alertService.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { allows } from "../lib/entitlementModel.js";
import { resolveTemplateUserId } from "../lib/whiteLabelTemplate.js";
import { PROVIDER_META } from "../lib/paymentConfig.js";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import InvoiceModal from "../components/InvoiceModal.jsx";
import WhiteLabelTemplateUploader from "../components/WhiteLabelTemplateUploader.jsx";
import IntegrationConnectModal from "../components/IntegrationConnectModal.jsx";
import EditIntegrationModal from "../components/EditIntegrationModal.jsx";
import { useToast } from "../components/Toast.jsx";
import { testIntegrationConnection } from "../lib/integrationsClient.js";
import { formatMoney } from "../lib/invoiceModel.js";
import { fetchInvoices } from "../lib/billingRepo.js";
import { useSeo } from "../hooks/useSeo.js";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import DangerZone from "../components/DangerZone.jsx";
import DiscoverabilityStats from "../components/DiscoverabilityStats.jsx";
import PersonaUsage from "../components/PersonaUsage.jsx";
import { fetchAccountState } from "../lib/accountStateService.js";

// ── Integrations catalog ─────────────────────────────────────────────────
// One row per provider; status is fetched from /api/integrations/{slug}/status.
const INTEGRATION_PROVIDERS = [
  { slug: "hubspot",  name: "HubSpot",  icon: "trending-up",   desc: "Push contacts and companies to your HubSpot CRM." },
  { slug: "notion",   name: "Notion",   icon: "bookmark",      desc: "Export extraction pages to a Notion database." },
  { slug: "airtable", name: "Airtable", icon: "layers",        desc: "Append rows to an Airtable base with field mapping." },
  { slug: "slack",    name: "Slack",    icon: "message-square", desc: "Get change alerts + new-extraction notifications." },
  { slug: "zapier",   name: "Zapier",   icon: "share",         desc: "Trigger 5,000+ apps on new extractions, enrichments, and monitoring alerts." },
];

function UsageMeter({ label, used, limit, icon }) {
  const isUnlimited = limit === Infinity || limit == null;
  const pct    = isUnlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const danger = !isUnlimited && pct >= 90;
  const warn   = !isUnlimited && pct >= 70 && !danger;
  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <div className="usage-meter-label"><Icon name={icon} size={15} /><span>{label}</span></div>
        <div className={"usage-meter-count" + (danger ? " danger" : warn ? " warn" : "")}>
          {isUnlimited
            ? <span className="usage-unlimited">Unlimited</span>
            : <>{used.toLocaleString()} <span>/ {limit.toLocaleString()}</span></>}
        </div>
      </div>
      {!isUnlimited && (
        <div className="usage-bar-track">
          <div className={"usage-bar-fill" + (danger ? " danger" : warn ? " warn" : "")}
               style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function AlertsSection() {
  const [config, setConfig] = useState(() => getAlertConfig());
  const [saved, setSaved]   = useState(false);
  const update = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const toggleThreshold = (t) => {
    const ts = config.thresholds.includes(t)
      ? config.thresholds.filter((x) => x !== t)
      : [...config.thresholds, t].sort((a, b) => a - b);
    update({ thresholds: ts });
  };
  const save = () => { saveAlertConfig(config); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  return (
    <div className="card card-pad alerts-section">
      <div className="card-section-title"><Icon name="mail" size={15} />Usage alerts</div>
      <div className="alert-toggle-row">
        <label className="alert-toggle-label">
          <input type="checkbox" checked={config.enabled}
            onChange={(e) => update({ enabled: e.target.checked })} />
          <span>Enable email alerts when usage hits a threshold</span>
        </label>
      </div>
      {config.enabled && (
        <>
          <div className="cf-field" style={{ marginTop: 14 }}>
            <label>Notification email</label>
            <input type="email" className="coupon-input" placeholder="you@example.com"
              value={config.email} onChange={(e) => update({ email: e.target.value })}
              style={{ textTransform: "none", letterSpacing: "normal" }} />
          </div>
          <div className="alert-thresholds">
            <div className="alert-thresholds-label">Alert me when I reach:</div>
            <div className="alert-threshold-chips">
              {[50, 70, 80, 90, 95].map((t) => (
                <button key={t}
                  className={"threshold-chip" + (config.thresholds.includes(t) ? " active" : "")}
                  onClick={() => toggleThreshold(t)}>{t}%</button>
              ))}
            </div>
          </div>
          <div className="alert-notify-row">
            <label className="alert-notify-label">
              <input type="checkbox" checked={config.notifyOn?.extractions ?? true}
                onChange={(e) => update({ notifyOn: { ...config.notifyOn, extractions: e.target.checked } })} />
              <span>Extractions threshold</span>
            </label>
          </div>
        </>
      )}
      <div className="alert-save-row">
        <Button variant="primary" size="sm" onClick={save}>{saved ? "Saved!" : "Save alert settings"}</Button>
        {saved && <div className="coupon-msg success"><Icon name="check-circle" size={13} />Settings saved.</div>}
      </div>
    </div>
  );
}

/**
 * Invoices & receipts.
 *
 * Tabular list; clicking a row opens the document to view and download.
 * Deliberately separate from "Payment history" below: payment_events is a
 * gateway audit trail, whereas an invoice is the legal document a customer
 * files with their accountant. They can also legitimately differ — a
 * reconstructed invoice, or a payment recorded offline by an admin.
 */
function InvoiceHistorySection({ invoices, loading, onOpen }) {
  if (loading) {
    return (
      <div className="card card-pad">
        <div className="card-section-title"><Icon name="receipt" size={15} />Invoices &amp; receipts</div>
        <div className="inv-empty">Loading your invoices…</div>
      </div>
    );
  }

  return (
    <div className="card card-pad invoice-history-card">
      <div className="card-section-title"><Icon name="receipt" size={15} />Invoices &amp; receipts</div>

      {!invoices.length ? (
        // Unlike PaymentHistorySection (which renders null when empty), an
        // explicit empty state tells the user where invoices WILL appear.
        <div className="inv-empty">
          <Icon name="file" size={22} />
          <p>No invoices yet. Your invoice appears here as soon as a payment completes, and a copy is emailed to you automatically.</p>
        </div>
      ) : (
        <div className="ph-table-wrap">
          <table className="ph-table inv-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Plan</th>
                <th className="inv-col-amt">Amount</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="inv-row"
                  onClick={() => onOpen(inv)}
                  tabIndex={0}
                  role="button"
                  aria-label={`View invoice ${inv.invoice_no}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(inv);
                    }
                  }}
                >
                  <td className="inv-no">{inv.invoice_no}</td>
                  <td className="ph-date">{new Date(inv.issued_at).toLocaleDateString()}</td>
                  <td><span className="ph-plan">{inv.plan_id || "—"}</span></td>
                  <td className="inv-col-amt">{formatMoney(inv.total_minor, inv.currency)}</td>
                  <td>
                    <span className={`status-badge ${inv.status}`}>{inv.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="inv-col-act">
                    <Icon name="chevron-right" size={15} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentHistorySection({ history, dbSubscription }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="card card-pad payment-history-card">
      <div className="card-section-title"><Icon name="credit-card" size={15} />Payment history</div>
      <div className="ph-table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Plan</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id}>
                <td className="ph-date">{new Date(row.created_at).toLocaleDateString()}</td>
                <td>
                  <span className="ph-plan">{row.plan_id || "—"}</span>
                  {row.provider && (
                    <span className="ph-provider">{PROVIDER_META[row.provider]?.name || row.provider}</span>
                  )}
                </td>
                <td className="ph-amount">
                  {row.amount_cents
                    ? `${row.currency?.toUpperCase() || ""} ${(row.amount_cents / 100).toFixed(2)}`
                    : "—"}
                </td>
                <td><span className={"status-badge " + (row.status || "active")}>{row.status || "completed"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dbSubscription?.provider && (
        <div className="ph-provider-row">
          <Icon name="shield" size={13} />
          <span>Subscription managed via <strong>{PROVIDER_META[dbSubscription.provider]?.name || dbSubscription.provider}</strong></span>
          {dbSubscription.current_period_end && (
            <span className="ph-next-billing">
              · Next billing: {new Date(dbSubscription.current_period_end).toLocaleDateString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function Account() {
  useSeo({
    title: "DatIQ Account — plan, billing, invoices, API keys | DatIQ.app",
    description:
      "DatIQ Account — manage your plan, billing, invoices, API keys, white-label template, and integrations. DatIQ.app is the zero-code web data extraction platform for individuals and teams.",
    canonical: "https://datiq.app/account",
  });
  const navigate = useNavigate();
  const {
    plan: ctxPlan, planId, usage, bonus, currency, rates,
    applyCoupon, redeemAdminGrant, adminGrantCoupon, removeCoupon, couponError, couponSuccess,
    subscription, initiatePayment, paymentLoading, paymentError, setPaymentError,
    paymentHistory, dbSubscription, hasPayment,
  } = useBilling();
  const { user } = useAuth();

  const plan     = getEffectivePlanById(planId);
  const allPlans = getEffectivePlans();
  const planMap  = Object.fromEntries(allPlans.map((p) => [p.id, p]));

  // The white-label PDF uploader is only available to plans with
  // `limits.white_label_pdf === true` (Business 2026-08-02 and Agency).
  // We resolve the entitlement via the shared model so the cap stays
  // consistent with the rest of the app.
  const canWhiteLabel = allows(
    { plan_id: planId, status: "active", source: "payment", period_end: null },
    "white_label_pdf",
    { planMap },
  );

  const [couponInput, setCouponInput] = useState("");
  const [applying, setApplying]       = useState(false);

  const [invoices, setInvoices]             = useState([]);
  const [invoicesLoading, setInvoicesLoad]  = useState(true);
  const [openInvoice, setOpenInvoice]       = useState(null);

  // ── Account state (freeze / pending deletion) ───────────────────────────
  // Read once on mount and then owned locally: every mutation returns the new
  // state, so there is no reason to re-fetch and no window where the panel
  // shows something the last action already changed.
  const [accountState, setAccountState] = useState({ available: false });
  useEffect(() => {
    if (!user) { setAccountState({ available: false }); return; }
    let alive = true;
    fetchAccountState().then((s) => { if (alive) setAccountState(s); });
    return () => { alive = false; };
  }, [user]);

  // ── Integrations state ──────────────────────────────────────────────────
  // Map of provider slug → full server status object (connected, account_label,
  // token_hint, base_id, table_id, database_id, field_map, table_name, ...).
  // The server returns the full shape; the Account UI renders only the
  // provider-specific subset that's relevant for that row.
  const [intStatus, setIntStatus] = useState({});
  const [intStatusLoading, setIntStatusLoading] = useState(false);
  // Which provider's connect modal is open (null = closed)
  const [connectProvider, setConnectProvider] = useState(null);
  // Which provider's edit modal is open (null = closed)
  const [editProvider, setEditProvider] = useState(null);
  // The provider currently being disconnected (for spinner state)
  const [disconnecting, setDisconnecting] = useState(null);
  // The provider whose connection is currently being tested (for spinner)
  const [testingProvider, setTestingProvider] = useState(null);

  const toast = useToast();

  const refreshIntegrations = async () => {
    setIntStatusLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setIntStatus({});
        return;
      }
      const results = await Promise.all(
        INTEGRATION_PROVIDERS.map(async (p) => {
          const r = await fetch(`/api/integrations/${p.slug}/status`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const data = await r.json().catch(() => ({}));
          return [p.slug, data];
        }),
      );
      setIntStatus(Object.fromEntries(results));
    } catch (err) {
      // network error — leave existing state
    } finally {
      setIntStatusLoading(false);
    }
  };

  useEffect(() => {
    if (user) refreshIntegrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleDisconnect = async (slug) => {
    if (!confirm(`Disconnect ${slug}? You'll need to reconnect to use it again.`)) return;
    setDisconnecting(slug);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/integrations/${slug}/connect`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      if (!r.ok) {
        toast("Failed to disconnect. Please try again.", "error");
      } else {
        toast(`${slug} disconnected.`, "success");
        await refreshIntegrations();
      }
    } catch (err) {
      toast(`Network error: ${err?.message}`, "error");
    } finally {
      setDisconnecting(null);
    }
  };

  // Test the stored connection. Per-provider feedback is rendered from
  // the server's response body so the user sees something concrete
  // (e.g. "HubSpot: connected as Portal 12345", "Airtable: 12 columns
  // in 'Leads' table", "Slack: welcome message posted").
  const handleTest = async (slug) => {
    setTestingProvider(slug);
    try {
      const result = await testIntegrationConnection(slug);
      const name = INTEGRATION_PROVIDERS.find((p) => p.slug === slug)?.name || slug;
      if (result?.ok) {
        // Build a human-readable summary from the per-provider result
        // shape. The server returns provider-specific fields; we extract
        // the most useful one for the toast. Falling back to "Connection
        // verified" for providers that don't return extra context.
        let detail = "Connection verified";
        if (slug === "hubspot" && result.portalId) {
          detail = `Connected · portal ${result.portalId}`;
        } else if (slug === "notion") {
          const cols = result.columnCount ?? result.properties ? Object.keys(result.properties || {}).length : null;
          const title = result.title || result.titleColumn || "database";
          detail = `Schema loaded · "${title}"${cols ? ` · ${cols} column${cols !== 1 ? "s" : ""}` : ""}`;
        } else if (slug === "airtable") {
          const tn = result.tableName || "table";
          const matched = result.matched ?? null;
          const total = result.fieldCount ?? null;
          if (matched != null && total != null) {
            detail = `Table "${tn}" · ${matched}/${total} field${total !== 1 ? "s" : ""} auto-mapped`;
          } else {
            detail = `Table "${tn}" · ${total ?? "?"} field${total !== 1 ? "s" : ""}`;
          }
        } else if (slug === "slack") {
          detail = "Welcome message posted to your channel";
        } else if (slug === "zapier") {
          // Zapier's /test is for the Zapier private app, not the user
          // — we re-use /status here to confirm a token is stored.
          detail = "Token stored and ready";
        }
        toast(`${name}: ${detail}.`, "success");
      } else {
        const errMsg = result?.error || "Test failed";
        toast(`${name}: ${errMsg}`, "error");
      }
    } catch (err) {
      toast(`Network error: ${err?.message || "unknown"}`, "error");
    } finally {
      setTestingProvider(null);
    }
  };

  // Auto-scroll to the Integrations section if the URL hash is #integrations
  useEffect(() => {
    if (window.location.hash === "#integrations") {
      // Defer to let the section render
      setTimeout(() => {
        const el = document.getElementById("integrations");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchInvoices()
      .then((rows) => { if (!cancelled) setInvoices(rows); })
      .finally(() => { if (!cancelled) setInvoicesLoad(false); });
    return () => { cancelled = true; };
  }, []);

  const totalExtractionLimit = plan.limits.extractions === Infinity
    ? Infinity
    : plan.limits.extractions + (bonus || 0);

  const enrichmentEntries = Object.entries(usage?.enrichments ?? {});
  const totalEnrichments  = enrichmentEntries.reduce((s, [, v]) => s + v, 0);

  const batchUrlLimit  = (plan.limits.batch_max_urls || 0) + (subscription.bonusBatchUrls || 0);
  const hasBatchAccess = batchUrlLimit > 0;

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    setApplying(true);
    await new Promise((r) => setTimeout(r, 600));
    const code = couponInput.trim().toUpperCase();
    if (adminGrantCoupon?.code === code) await redeemAdminGrant(code);
    else applyCoupon(code);
    setCouponInput("");
    setApplying(false);
  };

  const handleUpgrade = async (targetPlanId) => {
    const result = await initiatePayment?.(targetPlanId, "monthly");
    if (result?.status === "free") {
      toast("Your plan is now active — 100% off applied, no payment required.");
    }
    if (result?.status === "demo_mode" || result?.status === "success" || result?.status === "free") {
      navigate("/account");
    }
  };

  const nextTier = allPlans.find((p) => p.price_usd > plan.price_usd);

  return (
    <div className="page account-page">
      <div className="container">
        <div className="account-header">
          <div>
            <div className="eyebrow"><Icon name="user" />Billing &amp; Usage</div>
            <h1 className="account-title">Your plan &amp; usage</h1>
          </div>
        </div>

        {paymentError && (
          <div className="payment-error-banner" style={{ marginBottom: 16 }}>
            <Icon name="alert-circle" size={16} />
            <span>{paymentError}</span>
            <button className="peb-close" onClick={() => setPaymentError?.("")}>
              <Icon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="account-grid">
          {/* Left column */}
          <div className="account-main">
            {/* Current plan card */}
            <div className="card card-pad account-plan-card">
              <div className="apc-top">
                <div>
                  <div className="apc-label">Current plan</div>
                  <div className="apc-plan-name">
                    {plan.name}
                    {planId === "free" && <span className="apc-free-badge">Free</span>}
                    {dbSubscription?.provider && (
                      <span className="apc-provider-badge">
                        <Icon name={PROVIDER_META[dbSubscription.provider]?.icon || "credit-card"} size={12} />
                        {PROVIDER_META[dbSubscription.provider]?.name || dbSubscription.provider}
                      </span>
                    )}
                  </div>
                  {subscription.activatedAt && (
                    <div className="apc-since">
                      Active since {new Date(subscription.activatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  )}
                  {subscription.discountPercent > 0 && (
                    <div className="apc-discount-note">
                      <Icon name="tag" size={13} />{subscription.discountPercent}% discount applied via coupon
                    </div>
                  )}
                  {dbSubscription?.status && dbSubscription.status !== "active" && (
                    <div className="apc-status-warn">
                      <Icon name="alert-circle" size={13} />
                      Subscription status: <strong>{dbSubscription.status}</strong>
                    </div>
                  )}
                </div>
                {plan.price_usd > 0 && (
                  <div className="apc-price">
                    <span className="appc-amount">
                      {formatPrice(convertPrice(plan.price_usd, rates, currency), currency)}
                    </span>
                    <span className="appc-period">/ mo</span>
                  </div>
                )}
              </div>
              {nextTier && (
                <div className="apc-upgrade-hint">
                  <Icon name="trending-up" size={14} />
                  <span>
                    Upgrade to <strong>{nextTier.name}</strong> for{" "}
                    {nextTier.limits.extractions === Infinity
                      ? "unlimited extractions"
                      : `${nextTier.limits.extractions.toLocaleString()} extractions / month`}
                  </span>
                  <Button variant="primary" size="sm"
                    onClick={() => handleUpgrade(nextTier.id)}
                    disabled={paymentLoading}>
                    {paymentLoading ? "…" : "Upgrade"}
                  </Button>
                </div>
              )}
            </div>

            {/* Usage meters */}
            <div className="card card-pad">
              <div className="card-section-title">
                <Icon name="bar-chart" size={16} />
                Usage this month ({usage?.month ?? "—"})
              </div>
              <div className="usage-meters">
                <UsageMeter label="Extractions used"   icon="zap"       used={usage?.extractions ?? 0} limit={totalExtractionLimit} />
                <UsageMeter label="Enrichments (total)" icon="sparkles"  used={totalEnrichments}        limit={plan.limits.enrichments_per_extraction === Infinity ? Infinity : null} />
                {hasBatchAccess && (
                  <div className="usage-meter">
                    <div className="usage-meter-head">
                      <div className="usage-meter-label"><Icon name="layers-2" size={15} /><span>Batch mode (URLs per batch)</span></div>
                      <div className="usage-meter-count">{batchUrlLimit === Infinity ? <span className="usage-unlimited">Unlimited</span> : batchUrlLimit.toLocaleString()}</div>
                    </div>
                  </div>
                )}
              </div>
              {bonus > 0 && (
                <div className="usage-bonus-note">
                  <Icon name="zap" size={13} />
                  <span>+{bonus} bonus extractions from top-up bundle or coupon.</span>
                </div>
              )}
              {!hasBatchAccess && (
                <div className="usage-bonus-note" style={{ color: "var(--text-2)" }}>
                  <Icon name="layers-2" size={13} />
                  <span>Batch mode: not available on your current plan. <a href="/pricing" style={{ color: "var(--accent)" }}>Upgrade →</a></span>
                </div>
              )}
            </div>

            {/* Plan features */}
            <div className="card card-pad">
              <div className="card-section-title"><Icon name="check-circle" size={16} />{plan.name} plan includes</div>
              <div className="plan-features-grid">
                {plan.features.map((f) => (
                  <div key={f.label} className={"plan-feat-pill" + (f.included ? "" : " excluded")}>
                    <Icon name={f.included ? "check" : "x"} size={13} />
                    <span>{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment history (only if there are records) */}
            <InvoiceHistorySection
              invoices={invoices}
              loading={invoicesLoading}
              onOpen={setOpenInvoice}
            />
            <PaymentHistorySection
              history={paymentHistory}
              dbSubscription={dbSubscription}
            />

            {/* Metering alerts */}
            <AlertsSection />

            {/* Integrations */}
            <div id="integrations" className="card card-pad int-section">
              <div className="int-section-title">
                <Icon name="plug" size={15} />
                Integrations
              </div>
              <p className="int-section-sub">
                Connect DatIQ to your CRM, databases, and notification tools.
                Each integration is server-side — your credentials are encrypted
                and never exposed to the browser after the initial setup.
              </p>
              <div className="int-list">
                {INTEGRATION_PROVIDERS.map((p) => {
                  const status = intStatus[p.slug] || {};
                  const connected = status.connected === true;
                  const conn = status.connection || {};
                  return (
                    <div key={p.slug} className="int-row">
                      <div className="int-row-icon">
                        <Icon name={p.icon} size={18} />
                      </div>
                      <div className="int-row-meta">
                        <div className="int-row-name">{p.name}</div>
                        <div className={"int-row-status" + (connected ? " connected" : "")}>
                          <span className="int-row-status-dot" />
                          {connected
                            ? `Connected${conn.account_label ? ` · ${conn.account_label}` : ""}`
                            : "Not connected"}
                        </div>
                        {connected && (
                          // Per-provider rich status — shows whatever the
                          // server returned that helps the user confirm
                          // "yes, this is the right connection". Each
                          // provider has different fields, so we render
                          // them inline rather than via a fixed table.
                          <div className="int-row-detail">
                            {p.slug === "hubspot" && conn.token_hint && (
                              <div className="int-row-detail-line">
                                <span className="int-row-detail-key">Token</span>
                                <code className="int-row-detail-val">{conn.token_hint}</code>
                              </div>
                            )}
                            {p.slug === "notion" && (
                              <>
                                {conn.token_hint && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Token</span>
                                    <code className="int-row-detail-val">{conn.token_hint}</code>
                                  </div>
                                )}
                                {conn.database_id && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Database</span>
                                    <code className="int-row-detail-val" title={conn.database_id}>
                                      {shortenId(conn.database_id, 10)}
                                    </code>
                                  </div>
                                )}
                                {conn.title_column && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Title column</span>
                                    <span className="int-row-detail-val">{conn.title_column}</span>
                                  </div>
                                )}
                                {conn.column_count != null && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Columns</span>
                                    <span className="int-row-detail-val">{conn.column_count}</span>
                                  </div>
                                )}
                              </>
                            )}
                            {p.slug === "airtable" && (
                              <>
                                {conn.token_hint && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Token</span>
                                    <code className="int-row-detail-val">{conn.token_hint}</code>
                                  </div>
                                )}
                                {conn.base_id && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Base</span>
                                    <code className="int-row-detail-val" title={conn.base_id}>
                                      {shortenId(conn.base_id, 10)}
                                    </code>
                                  </div>
                                )}
                                {conn.table_id && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Table</span>
                                    <code className="int-row-detail-val" title={conn.table_id}>
                                      {shortenId(conn.table_id, 10)}
                                    </code>
                                  </div>
                                )}
                                {conn.table_meta?.tableName && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Table name</span>
                                    <span className="int-row-detail-val">{conn.table_meta.tableName}</span>
                                  </div>
                                )}
                                {conn.field_map_summary && (
                                  <div className="int-row-detail-line int-row-detail-chips">
                                    <span className="int-row-detail-key">Field map</span>
                                    <span className="int-row-detail-val">
                                      {conn.field_map_summary}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                            {p.slug === "slack" && (
                              <>
                                {conn.webhook_hint && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Webhook</span>
                                    <code className="int-row-detail-val">{conn.webhook_hint}</code>
                                  </div>
                                )}
                              </>
                            )}
                            {p.slug === "zapier" && (
                              <>
                                {conn.token_hint && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Token</span>
                                    <code className="int-row-detail-val">{conn.token_hint}</code>
                                  </div>
                                )}
                                {conn.created_at && (
                                  <div className="int-row-detail-line">
                                    <span className="int-row-detail-key">Issued</span>
                                    <span className="int-row-detail-val">
                                      {new Date(conn.created_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="int-row-actions">
                        {connected ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleTest(p.slug)}
                              disabled={testingProvider === p.slug}
                              loading={testingProvider === p.slug}
                              title={`Test the ${p.name} connection`}
                            >
                              {testingProvider === p.slug ? "Testing…" : "Test"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditProvider(p.slug)}
                              title={`Edit ${p.name} connection`}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDisconnect(p.slug)}
                              disabled={disconnecting === p.slug}
                              title={`Disconnect ${p.name}`}
                            >
                              {disconnecting === p.slug ? "Disconnecting…" : "Disconnect"}
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setConnectProvider(p.slug)}
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!isSupabaseEnabled && (
                <div className="int-section-sub" style={{ marginTop: 12, color: "var(--text-3)" }}>
                  <Icon name="info" size={13} /> Sign in to manage integrations.
                </div>
              )}
              {/* Entitlement flag only — no shipping extension yet (see
                  entitlementModel.js "browser_extension"). Shown only to
                  plans that carry the flag (Select and up) so it reads as
                  "coming to your plan", not a generic teaser everyone sees. */}
              {plan?.limits?.browser_extension && (
                <div className="int-row" style={{ marginTop: 8 }}>
                  <div className="int-row-icon">
                    <Icon name="puzzle" size={18} />
                  </div>
                  <div className="int-row-meta">
                    <div className="int-row-name">Browser extension</div>
                    <div className="int-row-status">
                      <span className="int-row-status-dot" />
                      Coming soon — included on your plan once it ships
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Danger zone ──────────────────────────────────────────────
                Last in the left column, below everything routine, and only for
                a signed-in account. Its position is the point: the two actions
                in it are the only ones on this page you cannot casually undo,
                so nothing should be able to lead you into them on the way to
                something else. */}
            {user && <DangerZone state={accountState} onChange={setAccountState} />}
          </div>

          {/* Right column */}
          <div className="account-aside">
            {/* Explore plans & top-up bundles — moved to the top of the right
                column (2026-08-11). It's the highest-ROI conversion CTA
                on this page (users on free / starter plans need a clear
                upgrade path before they engage with the coupon or white-
                label features), so it gets prime real estate above both. */}
            <Button variant="ghost" size="sm" icon="zap" fullWidth onClick={() => navigate("/pricing")}>
              Explore plans &amp; top-up bundles
            </Button>

            {/* White-label PDF template (Business + Agency, 2026-08-02) */}
            <WhiteLabelTemplateUploader
              userId={resolveTemplateUserId({ user })}
              canManage={canWhiteLabel}
            />

            {/* Your offers — a user-specific, one-time complimentary plan grant
                or bonus extractions. Grant state comes from the authenticated
                server endpoint, never from editable browser metadata. */}
            {(adminGrantCoupon || user?.user_metadata?.bonus_extractions > 0) && (
              <div className="card card-pad">
                <div className="card-section-title"><Icon name="gift" size={15} />Your offers</div>
                {adminGrantCoupon && (
                  <div className="my-offer-row">
                    <span className="user-coupon-pill">
                      {adminGrantCoupon.code}
                    </span>
                    <span className="my-offer-meta">
                      {getEffectivePlanById(adminGrantCoupon.planId)?.name || adminGrantCoupon.planId}
                      {adminGrantCoupon.validityMonths ? ` · ${adminGrantCoupon.validityMonths} month${adminGrantCoupon.validityMonths === 1 ? "" : "s"}` : ""}
                    </span>
                    {adminGrantCoupon.status === "redeemed" ? (
                      <span className="my-offer-applied"><Icon name="check-circle" size={13} />Redeemed</span>
                    ) : adminGrantCoupon.status === "expired" || adminGrantCoupon.status === "revoked" ? (
                      <span className="my-offer-meta">{adminGrantCoupon.status}</span>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => redeemAdminGrant(adminGrantCoupon.code)}>
                        Apply grant
                      </Button>
                    )}
                  </div>
                )}
                {user?.user_metadata?.bonus_extractions > 0 && (
                  <div className="my-offer-row">
                    <Icon name="zap" size={13} />
                    <span>+{user.user_metadata.bonus_extractions} bonus extractions granted by admin</span>
                  </div>
                )}
              </div>
            )}

            {/* Coupon */}
            <div className="card card-pad">
              <div className="card-section-title"><Icon name="bookmark" size={15} />Coupon / promo code</div>
              <form className="coupon-form" onSubmit={handleApplyCoupon}>
                <input
                  className="coupon-input"
                  type="text"
                  placeholder="Enter code (e.g. LAUNCH20)"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  maxLength={32}
                />
                <Button variant="primary" size="sm" type="submit" disabled={applying || !couponInput.trim()}>
                  {applying ? "Applying…" : "Apply"}
                </Button>
              </form>
              {couponError   && <div className="coupon-msg error"><Icon name="alert-triangle" size={13} />{couponError}</div>}
              {couponSuccess && <div className="coupon-msg success"><Icon name="check-circle" size={13} />{couponSuccess}</div>}
              {subscription.coupon && (
                <div className="applied-coupon">
                  <Icon name="bookmark" size={13} />
                  <span><strong>{subscription.coupon.code}</strong> applied on {new Date(subscription.coupon.appliedAt).toLocaleDateString()}</span>
                  <button className="remove-coupon-btn" onClick={removeCoupon} title="Remove coupon">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* ── Discoverability ─────────────────────────────────────────
                Its own card because audits have their OWN monthly budget
                rather than debiting extraction credits — folding them into
                the extraction counter would misreport both. */}
            {user && <DiscoverabilityStats auditLimit={plan.limits?.audits ?? 0} />}

            {/* ── Usage by role ───────────────────────────────────────────
                A breakdown OF the totals below, computed from the same record
                so the two can never disagree about the month. */}
            {user && <PersonaUsage usage={usage} />}

            {/* Quick stats */}
            <div className="card card-pad account-stats">
              <div className="card-section-title"><Icon name="database" size={15} />Quick stats</div>
              <div className="astat-row">
                <span className="astat-label">Extractions used</span>
                <span className="astat-val">{(usage?.extractions ?? 0).toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Remaining this month</span>
                <span className="astat-val">
                  {totalExtractionLimit === Infinity
                    ? "∞"
                    : Math.max(0, totalExtractionLimit - (usage?.extractions ?? 0)).toLocaleString()}
                </span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Enrichments total</span>
                <span className="astat-val">{totalEnrichments.toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Plan tier</span>
                <span className="astat-val plan-tier-val">{plan.name}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Batch executions</span>
                <span className="astat-val">{(usage?.batchRuns ?? 0).toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Content generations</span>
                <span className="astat-val">{(usage?.contentGenerations ?? 0).toLocaleString()}</span>
              </div>
              <div className="astat-row">
                <span className="astat-label">Batch mode limit</span>
                <span className="astat-val">
                  {hasBatchAccess
                    ? (batchUrlLimit === Infinity ? "Unlimited" : `${batchUrlLimit} URLs/batch`)
                    : <a href="/pricing" style={{ color: "var(--accent)", fontSize: "0.85em" }}>Upgrade to unlock</a>}
                </span>
              </div>
              {plan.limits.scheduled_monitoring > 0 && (
                <div className="astat-row">
                  <span className="astat-label">Scheduled monitors</span>
                  <span className="astat-val">
                    {plan.limits.scheduled_monitoring === Infinity ? "Unlimited" : plan.limits.scheduled_monitoring}
                  </span>
                </div>
              )}
              {plan.limits.team_seats > 1 && (
                <div className="astat-row">
                  <span className="astat-label">Team seats</span>
                  <span className="astat-val">{plan.limits.team_seats}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {openInvoice && (
        <InvoiceModal invoice={openInvoice} onClose={() => setOpenInvoice(null)} />
      )}
      {connectProvider && (
        <IntegrationConnectModal
          open={!!connectProvider}
          provider={connectProvider}
          onClose={() => setConnectProvider(null)}
          onConnected={refreshIntegrations}
        />
      )}
      {editProvider && (
        <EditIntegrationModal
          open={!!editProvider}
          slug={editProvider}
          status={intStatus[editProvider] || {}}
          onClose={() => setEditProvider(null)}
          onSaved={refreshIntegrations}
        />
      )}
    </div>
  );
}

// Truncate long IDs for display (e.g. "appABCDEFGHIJKLMNOP" → "appABCDEF…MNOP")
// while preserving enough context for the user to confirm "yes, that's
// mine". The full ID is still in the title= attribute on hover.
function shortenId(id, head = 8) {
  if (!id || typeof id !== "string") return "";
  if (id.length <= head + 5) return id;
  return `${id.slice(0, head)}…${id.slice(-4)}`;
}
