// src/components/engagement/AnalyticsPanel.jsx — how the campaign is doing.
//
// Removed from the previous version, deliberately:
//   - "CAN-SPAM & TRAI Compliant" — a compliance claim nothing checks. The
//     product does send an unsubscribe link and honour opt-outs; whether a
//     campaign is compliant depends on things it cannot see (consent basis,
//     sender address, content). A badge asserting it is a legal claim.
//   - Rows for WhatsApp / Telegram / SMS, which cannot send yet and always read 0.
// Added: the A/B result per variant, from message timestamps, so a later bounce
// does not erase an open.

import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { downloadText } from "./ProspectsTable.jsx";

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function analyticsCsv(analytics = {}, campaign = "") {
  const f = analytics.funnel || {};
  const lines = [
    ["campaign", campaign], ["prospects", analytics.total_prospects ?? 0],
    ["sent", f.sent ?? 0], ["delivered", f.delivered ?? 0], ["opened", f.opened ?? 0],
    ["clicked", f.clicked ?? 0], ["replied", f.replied ?? 0], ["converted", f.converted ?? 0],
    ["opted_out", analytics.counts?.opted_out ?? 0], [],
    ["channel", "variant", "sent", "opened", "clicked", "replied"],
    ...(analytics.variants || []).map((v) => [v.channel, v.variant, v.sent, v.opened, v.clicked, v.replied]),
  ];
  return lines.map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

export default function AnalyticsPanel({ analytics = {}, campaignTitle = "campaign" }) {
  const f = analytics.funnel || {};
  const total = analytics.total_prospects ?? 0;
  const optedOut = analytics.counts?.opted_out ?? 0;
  const variants = (analytics.variants || []).filter((v) => v.sent > 0);
  const channels = Object.entries(analytics.channel_breakdown || {}).filter(([, c]) => c.sent > 0);
  const sent = f.sent ?? 0;

  const kpis = [
    { label: "Prospects", value: total, icon: "users" },
    { label: "Sent", value: sent, icon: "send" },
    { label: "Delivered", value: `${pct(f.delivered, sent)}%`, sub: `${f.delivered ?? 0} of ${sent}`, icon: "check" },
    { label: "Opened", value: `${pct(f.opened, f.delivered)}%`, sub: `${f.opened ?? 0} open${(f.opened ?? 0) === 1 ? "" : "s"}`, icon: "eye" },
    { label: "Replied", value: `${pct(f.replied, f.delivered)}%`, sub: `${f.replied ?? 0} repl${(f.replied ?? 0) === 1 ? "y" : "ies"}`, icon: "message-circle" },
    { label: "Opted out", value: optedOut, icon: "slash" },
  ];
  const stages = [
    ["Sent", sent], ["Delivered", f.delivered ?? 0], ["Opened", f.opened ?? 0],
    ["Clicked", f.clicked ?? 0], ["Replied", f.replied ?? 0], ["Converted", f.converted ?? 0],
  ];

  if (total === 0) {
    return (
      <div className="engx-empty">
        <Icon name="bar-chart" size={22} />
        <h3>No results yet</h3>
        <p>Import prospects, approve a draft and send it — results appear here as delivery events arrive.</p>
      </div>
    );
  }

  return (
    <div className="engx-analytics">
      <div className="engx-section-head">
        <div>
          <h2>Results</h2>
          <p className="engx-muted">Rates are of the stage before: delivered of sent, opened and replied of delivered.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" icon="download"
          onClick={() => downloadText(`datiq-results-${campaignTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, analyticsCsv(analytics, campaignTitle))}>
          Export CSV
        </Button>
      </div>

      <div className="engx-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="engx-kpi">
            <span className="engx-kpi-icon" aria-hidden="true"><Icon name={k.icon} size={15} /></span>
            <span className="engx-kpi-label">{k.label}</span>
            <strong className="engx-kpi-value">{k.value}</strong>
            {k.sub && <span className="engx-muted">{k.sub}</span>}
          </div>
        ))}
      </div>

      <div className="engx-grid-2">
        <section className="engx-panel engx-pad">
          <h3 className="engx-h3">Funnel</h3>
          <ul className="engx-funnel">
            {stages.map(([label, n]) => (
              <li key={label}>
                <span className="engx-funnel-label">{label}</span>
                <span className="engx-funnel-track"><span style={{ width: `${pct(n, Math.max(sent, 1))}%` }} /></span>
                <span className="engx-funnel-num">{n}</span>
              </li>
            ))}
          </ul>
          <p className="engx-fineprint">Opens are approximate: some mail apps open every message automatically.</p>
        </section>

        <section className="engx-panel engx-pad">
          <h3 className="engx-h3">A/B variants</h3>
          {variants.length === 0 ? (
            <p className="engx-muted">No variant has been sent yet.</p>
          ) : (
            <table className="engx-table is-compact">
              <thead><tr><th>Variant</th><th className="is-num">Sent</th><th className="is-num">Open rate</th><th className="is-num">Reply rate</th></tr></thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={`${v.channel}-${v.variant}`}>
                    <td>{v.channel === "email" ? "" : `${v.channel} · `}Variant {v.variant}</td>
                    <td className="is-num">{v.sent}</td>
                    <td className="is-num">{pct(v.opened, v.sent)}%</td>
                    <td className="is-num">{pct(v.replied, v.sent)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {channels.length > 1 && (
            <p className="engx-fineprint">{channels.map(([c, v]) => `${c}: ${v.sent} sent`).join(" · ")}</p>
          )}
          <p className="engx-fineprint">Email is the live channel. WhatsApp and SMS follow once their sender approvals are in place.</p>
        </section>
      </div>
    </div>
  );
}
