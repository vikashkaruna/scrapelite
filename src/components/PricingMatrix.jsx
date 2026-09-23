// PricingMatrix.jsx — F13 (transparent pricing + tier-feature mapping) UI.
//
// A side-by-side feature comparison grid that lives below the plan cards on
// /pricing. One row per capability, one column per plan, with check/cross
// cells + plan-relevant values (e.g. "200/mo", "Unlimited").
//
// Why: SaaS buyers comparison-shop aggressively. An uncrawlable pricing page
// loses deals before they start. Each row answers a single question —
// "Does the plan I'm looking at have feature X?" — in one glance.
//
// Implementation notes:
//  - Feature rows are derived from a small static catalog (FEATURE_ROWS) so
//    the data model stays explicit. Adding a new row is one entry.
//  - Each row knows how to render the per-plan value via `render(plan)`.
//  - The "current plan" column gets a subtle highlight via .pm-col--current.
//  - On narrow screens, the table is horizontally scrollable with a sticky
//    first column (feature name) so labels never disappear off-screen.

import { Link } from "react-router";
import Icon from "./Icon.jsx";
import { getEffectivePlans, applyGlobalDiscount } from "../lib/pricingOverrides.js";
import { resolvePlanPrice } from "../lib/planPricing.js";
import { formatPrice } from "../lib/currencyService.js";
import { DISCOVERABILITY_BASE } from "../lib/credits/creditWeights.js";

function fmtNum(n) {
  if (n === Infinity) return "Unlimited";
  if (n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function fmtExportList(arr) {
  if (!arr || !arr.length) return "—";
  return arr.map((x) => x.toUpperCase()).join(" + ");
}

function fmtBool(b) {
  return b ? "✓" : "—";
}

// Header price for one plan column. Uses the SAME resolver and formatter as the
// plan cards on /pricing (resolvePlanPrice + formatPrice), for the billing
// period the visitor has selected. This used to read the annual price
// unconditionally, so with the page on its Monthly default the table disagreed
// with every card above it.
function matrixPrice(plan, billingPeriod, currency, rates) {
  return formatPrice(applyGlobalDiscount(resolvePlanPrice(plan, billingPeriod, currency, rates)), currency);
}

const FEATURE_ROWS = [
  // ── ONE POOL, AT THE TOP, BECAUSE IT IS WHAT EVERYTHING COSTS ───────────
  // 🔴 `extractions` and `audits` used to be two separate monthly budgets
  // here, which is exactly how a customer could be refused an audit while
  // holding a month of unused extractions. They are gone as ROWS; the credit
  // pool replaces both, and the rows below translate it into the units people
  // actually think in so the number means something.
  //
  // ⚠️ `enrichments_per_extraction` is gone too. It capped DEPTH per URL while
  // the cost is per CALL, and every plan had it at Infinity — a limit nobody
  // ever set is a limit nobody wanted.
  { key: "credits",        group: "Usage",       label: "Credits / month",             render: (p) => fmtNum(p.limits?.credits) },
  { key: "credits_pages",  group: "Usage",       label: "≈ pages extracted",           render: (p) => fmtNum(p.limits?.credits) },
  { key: "credits_audits", group: "Usage",       label: "≈ Discoverability runs",      render: (p) => fmtNum(Math.floor((p.limits?.credits || 0) / DISCOVERABILITY_BASE)) },
  { key: "batch",          group: "Usage",       label: "Batch mode (URLs per run)",   render: (p) => fmtNum(p.limits?.batch_max_urls) },
  { key: "monitoring",     group: "Usage",       label: "Scheduled monitoring",        render: (p) => fmtNum(p.limits?.scheduled_monitoring) },
  // ── Intelligence workflows ──────────────────────────────────────────────
  // Every row here mirrors the limit entitlementModel ALREADY enforces rather
  // than inventing a second number. A bulk list is a batch of domains, so it
  // answers to `batch_max_urls`; a watchlist is a recurring monitor, so it
  // answers to `scheduled_monitoring`; a signal rule pushes into the same four
  // destinations as `integrations`. Deriving them here means the table cannot
  // promise a capability the server will refuse — which is exactly how the
  // discoverability rows below came to be missing in the first place.
  { key: "templates",      group: "Intelligence workflows", label: "Workflow template library",            render: () => fmtBool(true) },
  { key: "template_fork",  group: "Intelligence workflows", label: "Fork & edit templates",                render: (p) => fmtBool(p.limits?.template_duplicate) },
  { key: "bulk_lists",     group: "Intelligence workflows", label: "Bulk account list (accounts per list)", render: (p) => fmtNum(p.limits?.batch_max_urls) },
  { key: "icp",            group: "Intelligence workflows", label: "ICP scoring & review queue",           render: (p) => fmtBool((p.limits?.batch_max_urls || 0) > 0) },
  { key: "watchlists",     group: "Intelligence workflows", label: "Competitor watchlists",                render: (p) => fmtNum(p.limits?.scheduled_monitoring) },
  { key: "signal_rules",   group: "Intelligence workflows", label: "Signal routing rules",                 render: (p) => fmtBool(p.limits?.integrations) },
  { key: "reports",        group: "Intelligence workflows", label: "Shareable reports",                    render: () => fmtBool(true) },
  { key: "report_brand",   group: "Intelligence workflows", label: "Your branding on reports",             render: (p) => fmtBool(p.limits?.white_label_pdf) },
  // ── Discoverability ─────────────────────────────────────────────────────
  // These limits have existed in pricingConfig since the module shipped
  // (free 3 · go 10 · select 25 · pro 100 · business 500 · agency 2000) but
  // appeared NOWHERE on /pricing. So the quota wall said "You've used all 3
  // discoverability audits this month → See plans", and the page it sent
  // people to never mentioned discoverability at all — the one number they
  // had gone there to compare.
  // ⚠️ THERE IS NO SEPARATE AUDIT ALLOWANCE ANY MORE, so this row says what a
  // plan's pool BUYS rather than quoting a second budget. A run is 19 credits
  // (29 at the ten-prompt ceiling) and it draws on the same pool as
  // everything else — which is the point: nobody is refused an audit while
  // holding a month of unused extractions.
  // ⚠️ The COST, not a second count — the Usage group above already
  // translates each plan's pool into runs, and quoting the same number twice
  // reads as two separate allowances, which is precisely the impression this
  // change exists to remove.
  { key: "audit_cost",     group: "Discoverability", label: "Cost per Discoverability run", render: () => `${DISCOVERABILITY_BASE} credits` },
  // Benchmarks stay a PLAN capability rather than a pure cost: the free
  // taster shows what ONE audit looks like, and letting a competitor set
  // through on balance alone would sell Select's headline feature to anyone
  // who happened to have the credits. Mirrors entitlementModel's own
  // threshold so the table cannot drift from what the server enforces.
  { key: "benchmarks",     group: "Discoverability", label: "Competitive benchmarks",  render: (p) => fmtBool((p.limits?.credits || 0) >= 2500) },
  { key: "sxo",            group: "Discoverability", label: "Search-to-Outcome Intelligence", render: (p) => fmtBool((p.limits?.credits || 0) >= 2500) },
  { key: "portfolio_os",   group: "Discoverability", label: "Enterprise Discoverability OS",  render: (p) => fmtBool((p.limits?.credits || 0) >= 6000) },
  { key: "csv",            group: "Exports",     label: "CSV export",                  render: (p) => fmtBool((p.limits?.exports || []).includes("csv")) },
  { key: "pdf",            group: "Exports",     label: "PDF export",                  render: (p) => fmtBool((p.limits?.exports || []).includes("pdf")) },
  { key: "markdown",       group: "Exports",     label: "Markdown export",             render: (p) => fmtBool((p.limits?.exports || []).includes("markdown")) },
  { key: "json",           group: "Exports",     label: "JSON export",                 render: (p) => fmtBool((p.limits?.exports || []).includes("json")) },
  { key: "email",          group: "Exports",     label: "Email export",                render: (p) => fmtBool(p.limits?.email_export) },
  { key: "api",            group: "Power",       label: "API access",                  render: (p) => fmtBool(p.limits?.api_access) },
  { key: "integrations",   group: "Power",       label: "Integrations (HubSpot, Notion, Airtable, Slack)", render: (p) => fmtBool(p.limits?.integrations) },
  { key: "browser_ext",    group: "Power",       label: "Browser extension",           render: (p) => fmtBool(p.limits?.browser_extension) },
  { key: "white_label",    group: "Power",       label: "White-label PDF",             render: (p) => fmtBool(p.limits?.white_label_pdf) },
  { key: "seats",          group: "Team",        label: "Team seats (included)",       render: (p) => fmtNum(p.limits?.team_seats) },
  { key: "workspaces",     group: "Team",        label: "Workspaces",                  render: (p) => fmtNum(p.limits?.workspaces) },
  { key: "priority",       group: "Team",        label: "Priority support",            render: (p) => fmtBool(p.limits?.priority_support) },
  { key: "retention",      group: "Data",        label: "Data retention",              render: (p) => (p.limits?.retention_days === Infinity || p.limits?.retention_days === undefined ? "Unlimited" : `${p.limits.retention_days} days`) },
];

function groupRows(rows) {
  const out = [];
  let lastGroup = null;
  for (const row of rows) {
    if (row.group !== lastGroup) {
      out.push({ kind: "group", key: row.group, label: row.group });
      lastGroup = row.group;
    }
    out.push({ kind: "row", ...row });
  }
  return out;
}

export default function PricingMatrix({ currentPlanId = null, onSelectPlan, currency = "USD", billingPeriod = "monthly", rates }) {
  // Only the 6 ship-today plans (Developer is coming-soon, Enterprise is custom —
  // the matrix would just confuse). The Enterprise row is its own card above.
  const plans = getEffectivePlans().filter((p) => !p.comingSoon);

  const items = groupRows(FEATURE_ROWS);

  return (
    <section className="pricing-matrix" aria-label="Plan comparison">
      <header className="pricing-matrix-head">
        <h2 className="pricing-matrix-title">
          <Icon name="columns-3" size={18} /> Compare every plan
        </h2>
        <p className="pricing-matrix-sub">
          One row per feature. Prices are per month, {billingPeriod === "annual" ? "billed annually" : "billed monthly"}
          {currency === "INR" ? ", before 18% GST" : ""}. Tap a plan column to scroll back up &amp; pick it.
        </p>
      </header>

      <div className="pricing-matrix-table-wrap" role="region" tabIndex={0} aria-label="Feature comparison table">
        <table className="pricing-matrix-table">
          <thead>
            <tr>
              <th scope="col" className="pm-feature-col">Feature</th>
              {plans.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  className={"pm-plan-col" + (p.id === currentPlanId ? " pm-col--current" : "")}
                >
                  <div className="pm-plan-name">{p.name}</div>
                  <div className="pm-plan-price">
                    {matrixPrice(p, billingPeriod, currency, rates)}
                    <span className="pm-plan-period">/mo</span>
                  </div>
                  {p.id === currentPlanId && (
                    <div className="pm-plan-badge">
                      <Icon name="check" size={11} /> Your plan
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              if (item.kind === "group") {
                return (
                  <tr key={`g-${item.key}`} className="pm-group-row">
                    <th scope="rowgroup" colSpan={plans.length + 1}>{item.label}</th>
                  </tr>
                );
              }
              return (
                <tr key={item.key}>
                  <th scope="row" className="pm-feature-name">{item.label}</th>
                  {plans.map((p) => {
                    const v = item.render(p);
                    const isBool = v === "✓" || v === "—";
                    return (
                      <td
                        key={p.id}
                        className={
                          "pm-cell" +
                          (p.id === currentPlanId ? " pm-col--current" : "") +
                          (isBool ? (v === "✓" ? " pm-yes" : " pm-no") : " pm-val")
                        }
                      >
                        {isBool && v === "✓" ? <Icon name="check" size={14} aria-label="included" /> : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="pm-feature-name pm-feature-cta">Get started</th>
              {plans.map((p) => (
                <td key={p.id} className={"pm-cell pm-cta" + (p.id === currentPlanId ? " pm-col--current" : "")}>
                  {p.id === "free" ? (
                    <span className="pm-cell-note">No card needed</span>
                  ) : (
                    <button
                      type="button"
                      className="pm-cta-btn"
                      onClick={() => onSelectPlan && onSelectPlan(p.id)}
                      disabled={p.id === currentPlanId}
                    >
                      {p.id === currentPlanId ? "Current" : `Pick ${p.name}`}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="pricing-matrix-foot">
        Need higher limits, an API, or custom data residency? <Link to="/contact?type=enterprise">Talk to sales →</Link>
      </p>
    </section>
  );
}
