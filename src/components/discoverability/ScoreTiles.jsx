// ScoreTiles.jsx — the headline row and the four pillar cards.
//
// ── THE ONE RULE THIS FILE ENFORCES VISUALLY ───────────────────────────────
// "Not measured" never renders in the same colour as a failing score. The
// scoring model is careful to keep null distinct from 0; painting both red
// would undo that in the only place the user actually looks. An unmeasured
// score is muted and says so in words, and every score carries the share of
// evidence it was built from.

import Icon from "../Icon.jsx";
import { scoreBand } from "../../lib/discoverability/scoringModel.js";
import { PILLARS, PILLAR_IDS, signalLabel } from "../../lib/discoverability/signalRegistry.js";

const FRAMEWORK_META = {
  overall: { label: "Overall", icon: "gauge", hint: "All four pillars, weighted for balanced discoverability." },
  seo:     { label: "SEO", icon: "scan-search", hint: "Classic search. Leans hardest on crawlability, rendering and Core Web Vitals." },
  aeo:     { label: "AEO", icon: "message-square", hint: "Answer engines. Leans hardest on extractable, answer-first passages." },
  geo:     { label: "GEO", icon: "radar", hint: "Generative engines. Leans hardest on entity identity and citation footprint." },
};

const PILLAR_ICON = {
  answer_clarity: "message-square",
  entity_authority: "fingerprint",
  structural_hierarchy: "list-tree",
  technical_accessibility: "shield-check",
};

export function ScoreValue({ score, size = "lg" }) {
  const band = scoreBand(score);
  if (band.id === "unknown") {
    return <span className={`dsc-score dsc-score-${size} dsc-tone-muted`}>—</span>;
  }
  return (
    <span className={`dsc-score dsc-score-${size} dsc-tone-${band.tone}`}>
      {Math.round(score)}
    </span>
  );
}

export function DeltaBadge({ delta }) {
  // A delta that is not comparable is shown as such, never as zero movement.
  // "0" would tell the user their work changed nothing; the truth is that the
  // two audits did not measure the same things.
  if (!delta || !delta.comparable) {
    return delta ? <span className="dsc-delta dsc-delta-unknown" title={delta.reason}>not comparable</span> : null;
  }
  if (Math.abs(delta.change) < 0.5) return <span className="dsc-delta dsc-delta-flat">no change</span>;
  const up = delta.change > 0;
  return (
    <span className={`dsc-delta ${up ? "dsc-delta-up" : "dsc-delta-down"}`}>
      <Icon name={up ? "trending-up" : "trending-down"} size={13} />
      {up ? "+" : ""}{delta.change}
    </span>
  );
}

/** Small, muted, and always present — the score is never shown without it. */
export function CoverageNote({ coverage }) {
  if (!Number.isFinite(Number(coverage))) return null;
  const full = coverage >= 99.5;
  return (
    <span
      className={`dsc-coverage${full ? "" : " dsc-coverage-partial"}`}
      title={full
        ? "Every signal this audit intended to measure was measured."
        : `${coverage}% of the intended signals were measured. The rest could not be, and their weight was redistributed rather than scored as zero.`}
    >
      {full ? "full coverage" : `${coverage}% coverage`}
    </span>
  );
}

export default function ScoreTiles({ audit, diff, headlineFramework = "overall", onSelectFramework, selected }) {
  const scores = {
    overall: audit?.finalScore ?? null,
    seo: audit?.seoScore ?? null,
    aeo: audit?.aeoScore ?? null,
    geo: audit?.geoScore ?? null,
  };

  return (
    <div className="dsc-score-row" role="list" aria-label="Framework scores">
      {Object.entries(FRAMEWORK_META).map(([key, meta]) => {
        const band = scoreBand(scores[key]);
        const isHeadline = key === headlineFramework;
        const isSelected = selected === key;
        return (
          <button
            key={key}
            type="button"
            role="listitem"
            className={`dsc-score-tile${isHeadline ? " dsc-score-tile-headline" : ""}${isSelected ? " dsc-score-tile-selected" : ""}`}
            onClick={() => onSelectFramework?.(key)}
            aria-pressed={isSelected}
            title={meta.hint}
          >
            <span className="dsc-tile-head">
              <Icon name={meta.icon} size={15} />
              <span className="dsc-tile-label">{meta.label}</span>
              {isHeadline && <span className="dsc-tile-badge">headline</span>}
            </span>
            <ScoreValue score={scores[key]} />
            <span className="dsc-tile-foot">
              <span className={`dsc-band dsc-tone-${band.tone}`}>{band.label}</span>
              <DeltaBadge delta={diff?.frameworks?.[key]} />
            </span>
            <CoverageNote coverage={audit?.frameworks?.[key]?.coverage ?? (key === "overall" ? audit?.coverage : null)} />
          </button>
        );
      })}
    </div>
  );
}

/** One pillar, with every signal that fed it. This is the explainability view. */
export function PillarCard({ pillarId, pillar, diff, expanded, onToggle }) {
  const meta = PILLARS[pillarId];
  const band = scoreBand(pillar?.score);
  const signals = pillar?.signals || [];
  const unmeasured = signals.filter((s) => !s.measured);

  return (
    <div className={`dsc-pillar-card dsc-tone-border-${band.tone}`}>
      <button
        type="button"
        className="dsc-pillar-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <Icon name={PILLAR_ICON[pillarId]} size={16} />
        <span className="dsc-pillar-name">{meta?.label || pillarId}</span>
        <span className="dsc-pillar-weight">{Math.round((meta?.weight || 0) * 100)}%</span>
        <ScoreValue score={pillar?.score} size="md" />
        <DeltaBadge delta={diff?.pillars?.[pillarId]} />
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={15} />
      </button>

      {/* The gauge is decorative; the number above it is the accessible value. */}
      <div className="dsc-gauge" aria-hidden="true">
        <div
          className={`dsc-gauge-fill dsc-tone-bg-${band.tone}`}
          style={{ width: `${Math.max(0, Math.min(100, pillar?.score ?? 0))}%` }}
        />
      </div>

      {unmeasured.length > 0 && !expanded && (
        <p className="dsc-pillar-note">
          {unmeasured.length} signal{unmeasured.length === 1 ? "" : "s"} not measured — weight redistributed, not scored as zero.
        </p>
      )}

      {expanded && (
        <ul className="dsc-signal-list">
          {signals.map((s) => {
            const sBand = scoreBand(s.score);
            const why = s.applicable === false
              ? "Not applicable to this page type"
              : "Could not be measured in this audit";
            return (
              <li key={s.code} className="dsc-signal-row">
                {/* Fall back to the code rather than rendering an empty span —
                    a reopened audit once showed a column of blank signal names. */}
                <span className="dsc-signal-name">{s.label || signalLabel(s.code) || s.code}</span>
                <span className="dsc-signal-weight">{Math.round(s.weight * 100)}%</span>
                {s.measured ? (
                  <>
                    <span className="dsc-signal-bar" aria-hidden="true">
                      <span className={`dsc-signal-bar-fill dsc-tone-bg-${sBand.tone}`} style={{ width: `${s.score}%` }} />
                    </span>
                    <span className={`dsc-signal-score dsc-tone-${sBand.tone}`}>{Math.round(s.score)}</span>
                  </>
                ) : (
                  <span className="dsc-signal-unmeasured" title={why}>{why}</span>
                )}
                {/* ── WHERE EXACTLY DID YOU SEE THAT? ──────────────────────
                    W1 built the evidence envelope and threaded it through the
                    pipeline, the store and the API — and it reached NO SCREEN.
                    A record that is stored and never shown answers the
                    question only for whoever can query the database, which is
                    not the person asking it.

                    Rendered inline, collapsed, on the signal it supports: the
                    question is always "why is THIS number what it is", so an
                    evidence drawer somewhere else on the page would make the
                    reader carry a signal code across it. */}
                <SignalEvidence signal={s} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The provenance behind one signal's number.
 *
 * ── OBSERVATION AND INFERENCE ARE VISUALLY DIFFERENT ───────────────────────
 * Each evidence record declares `observed: true|false` (evidenceModel.js), and
 * a record produced by a model judgement must never look like a reading taken
 * off the page. That is the same rule the issue list applies one level up, and
 * it is the whole reason `method` carries the flag rather than a call site
 * setting it.
 *
 * Renders nothing at all when there is no evidence — which is the common case
 * for a signal that could not be measured, and for every audit stored before
 * migration 0048. An empty "Evidence" disclosure would read as "we looked and
 * found none", which is a different and untrue claim.
 */
function SignalEvidence({ signal }) {
  const records = Array.isArray(signal?.evidence) ? signal.evidence : [];
  if (records.length === 0) return null;
  return (
    <details className="dsc-evidence-drawer">
      <summary>
        <Icon name="search" size={11} />
        {records.length} observation{records.length === 1 ? "" : "s"}
        {Number.isFinite(signal.confidence) && (
          <span className="dsc-evidence-confidence">{Math.round(signal.confidence * 100)}% confidence</span>
        )}
      </summary>
      <ul className="dsc-evidence-records">
        {records.map((r, idx) => (
          <li key={`${r.method}-${idx}`} className="dsc-evidence-record">
            <span className={`dsc-claim-tag ${r.observed ? "dsc-claim-observed" : "dsc-claim-inferred"}`}>
              {r.observed ? "Observed" : "Inferred"}
            </span>
            <span className="dsc-evidence-method">{String(r.method || "").replace(/_/g, " ")}</span>
            {r.section && <span className="dsc-evidence-section">{r.section}</span>}
            {/* The selector is the literal answer to "where on the page",
                so it is monospaced and never truncated away. */}
            {r.selector && <code className="dsc-evidence-selector">{r.selector}</code>}
            {r.excerpt && <p className="dsc-evidence-excerpt">“{r.excerpt}”</p>}
            {r.collected_at && (
              <time className="dsc-evidence-time" dateTime={r.collected_at}>
                {new Date(r.collected_at).toLocaleString()}
              </time>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The four pillar cards.
 *
 * ── INDEPENDENTLY EXPANDABLE, NOT AN ACCORDION ─────────────────────────────
 * `expandedPillars` is a Set, not a single id. It used to be one nullable
 * string, which made opening any pillar close the one you were already reading
 * — so comparing "Answer Clarity" against "Structural Hierarchy", which is the
 * single most common reason to open one at all, was impossible without
 * scrolling back and re-opening.
 *
 * A card closes only when the reader closes it.
 */
export function PillarGrid({ audit, diff, expandedPillars, onTogglePillar }) {
  const isOpen = (id) =>
    expandedPillars instanceof Set ? expandedPillars.has(id) : expandedPillars === id;
  return (
    <div className="dsc-pillar-grid">
      {PILLAR_IDS.map((id) => (
        <PillarCard
          key={id}
          pillarId={id}
          pillar={audit?.pillars?.[id]}
          diff={diff}
          expanded={isOpen(id)}
          onToggle={() => onTogglePillar(id)}
        />
      ))}
    </div>
  );
}

/** The multiplicative blockers, shown with the arithmetic they performed. */
export function PenaltyBanner({ audit }) {
  const penalties = audit?.penalties || [];
  if (penalties.length === 0) return null;
  const pre = audit?.scoreMath?.prePenaltyTotal;
  return (
    <div className="dsc-penalty-banner" role="alert">
      <div className="dsc-penalty-head">
        <Icon name="alert-octagon" size={18} />
        <strong>
          {penalties.length} blocking issue{penalties.length === 1 ? "" : "s"} scaled this score down
        </strong>
        {Number.isFinite(pre) && (
          <span className="dsc-penalty-math">
            {Math.round(pre)} × {audit.penaltyMultiplier} = {Math.round(audit.finalScore)}
          </span>
        )}
      </div>
      <ul className="dsc-penalty-list">
        {penalties.map((p) => (
          <li key={p.code}>
            <span className={`dsc-sev dsc-sev-${p.severity}`}>−{Math.round(p.factor * 100)}%</span>
            <strong>{p.label}</strong> — {p.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
