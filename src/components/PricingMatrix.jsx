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
import { getEffectivePlans } from "../lib/pricingOverrides.js";
import { applyGlobalDiscount } from "../lib/pricingOverrides.js";

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

// Format a price for the matrix header — per-year figure (one decimal place
// for fractional dollars, no decimals for whole dollars). Pulls the right
// annual price for the selected currency, after the global discount.
function fmtMatrixPrice(plan, currency) {
  if (plan.id === "free") return "0";
  const annual = currency === "INR" ? plan.price_inr_annual : plan.price_usd_annual;
  const base   = currency === "INR" ? plan.price_inr        : plan.price_usd;
  const raw    = annual ?? base ?? 0;
  const withDiscount = applyGlobalDiscount(raw);
  // Round to 1 decimal place, drop trailing .0.
  const rounded = Math.round(withDiscount * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const FEATURE_ROWS = [
  { key: "extractions",    group: "Usage",       label: "Monthly extractions",         render: (p) => fmtNum(p.limits?.extractions) },
  { key: "enrichments",    group: "Usage",       label: "Enrichments per extraction",  render: (p) => fmtNum(p.limits?.enrichments_per_extraction) },
  { key: "batch",          group: "Usage",       label: "Batch mode (URLs per run)",   render: (p) => fmtNum(p.limits?.batch_max_urls) },
  { key: "monitoring",     group: "Usage",       label: "Scheduled monitoring",        render: (p) => fmtNum(p.limits?.scheduled_monitoring) },
  // ── Discoverability ─────────────────────────────────────────────────────
  // These limits have existed in pricingConfig since the module shipped
  // (free 3 · go 10 · select 25 · pro 100 · business 500 · agency 2000) but
  // appeared NOWHERE on /pricing. So the quota wall said "You've used all 3
  // discoverability audits this month → See plans", and the page it sent
  // people to never mentioned discoverability at all — the one number they
  // had gone there to compare.
  { key: "audits",         group: "Discoverability", label: "Discoverability audits (per month)", render: (p) => fmtNum(p.limits?.audits) },
  // Benchmarks gate on the audit allowance rather than a flag of their own:
  // a competitive set is several full audits, so entitlementModel requires an
  // allowance of at least 25 (`audit.benchmark`). Mirrored here rather than
  // re-derived, so the table cannot drift from what the server enforces.
  { key: "benchmarks",     group: "Discoverability", label: "Competitive benchmarks",  render: (p) => fmtBool(p.limits?.audits === Infinity || (p.limits?.audits || 0) >= 25) },
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

export default function PricingMatrix({ currentPlanId = null, onSelectPlan, currency = "USD" }) {
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
          One row per feature. Tap a plan column to scroll back up &amp; pick it.
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
                    {currency === "INR" ? "₹" : "$"}
                    {fmtMatrixPrice(p, currency)}
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
