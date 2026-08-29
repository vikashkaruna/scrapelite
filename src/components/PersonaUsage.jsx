// PersonaUsage.jsx — which role consumed the plan this month.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// Persona has always shaped what the product SHOWS — examples, quick actions,
// prompt framing — but until now nothing recorded which one was active when a
// unit was spent. On a product that sells team seats, "which of my team's roles
// is consuming the plan?" is a question the billing page could not answer.
//
// ── IT IS A BREAKDOWN, NOT A SECOND SET OF NUMBERS ─────────────────────────
// The rows here sum to the totals in Quick stats, because they are computed
// from the same record. A parallel counter would eventually disagree with the
// total it was meant to explain — the same reason audits are counted from their
// rows rather than from a counter column.
//
// ── AND IT IS HONEST ABOUT THE PAST ────────────────────────────────────────
// Attribution started when this shipped. A month with usage but no breakdown is
// stated as such rather than shown as zeros, which would read as "nobody used
// it" — the opposite of the truth.

import Icon from "./Icon.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";

const FIELDS = [
  ["extractions", "Extractions"],
  ["audits", "Audits"],
  ["batchRuns", "Batch runs"],
  ["contentGenerations", "Content"],
];

/** Rows sorted by total work, heaviest first. Returns [] when nothing is attributed. */
export function personaRows(byPersona = {}) {
  return Object.entries(byPersona)
    .map(([id, counts]) => ({
      id,
      label: id === "__none__" ? "No role selected" : (PERSONA_BY_ID[id]?.label || id),
      color: id === "__none__" ? "var(--text-3)" : (PERSONA_BY_ID[id]?.color || "var(--accent)"),
      counts,
      total: FIELDS.reduce((n, [k]) => n + (counts?.[k] || 0), 0),
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

export default function PersonaUsage({ usage }) {
  const rows = personaRows(usage?.byPersona);
  const monthTotal = (usage?.extractions ?? 0) + (usage?.batchRuns ?? 0) + (usage?.contentGenerations ?? 0);

  return (
    <div className="card card-pad account-stats">
      <div className="card-section-title"><Icon name="users" size={15} />Usage by role</div>

      {rows.length === 0 ? (
        <p className="astat-note">
          {monthTotal > 0
            // The honest sentence. Zeros here would read as "nobody used it".
            ? "This month's usage was recorded before per-role tracking started, so it can't be attributed."
            : "Nothing used yet this month."}
        </p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="astat-persona-row">
            <div className="astat-persona-head">
              <span className="astat-persona-dot" style={{ background: r.color }} aria-hidden="true" />
              <span className="astat-label">{r.label}</span>
              <span className="astat-val">{r.total.toLocaleString()}</span>
            </div>
            <div className="astat-persona-detail">
              {FIELDS
                .filter(([k]) => (r.counts?.[k] || 0) > 0)
                .map(([k, label]) => `${label} ${r.counts[k]}`)
                .join("  ·  ")}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
