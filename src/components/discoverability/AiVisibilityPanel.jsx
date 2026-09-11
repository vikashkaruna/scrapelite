// AiVisibilityPanel.jsx — WAVI, the seven states, share of voice, displacement.
//
// The one screen that answers "do answer engines know us, and if not, who are
// they answering instead". Everything here is read from a sample that was
// actually taken; nothing is inferred at render time.

import Icon from "../Icon.jsx";
import { WAVI_COMPONENT_IDS } from "../../lib/discoverability/aiVisibility.js";
import { CITATION_STATES, CITATION_STATE_IDS } from "../../lib/discoverability/citationStates.js";
import { displacementReport } from "../../lib/discoverability/displacement.js";

const NOT_MEASURED = <span className="dsc-unmeasured">not measured</span>;

const pct = (v) => (Number.isFinite(v) ? `${v}%` : null);

/**
 * ⚠️ ONE PLACE DECIDES WHAT AN ABSENT NUMBER LOOKS LIKE.
 * Every rate here can legitimately be null — RecommendationRate when no
 * commercial prompt was asked, accuracy when no claim was checkable — and a
 * null rendered as 0 is a different statement entirely.
 */
function Rate({ value, suffix = "%" }) {
  if (!Number.isFinite(value)) return NOT_MEASURED;
  return <>{value}{suffix}</>;
}

export default function AiVisibilityPanel({ sample }) {
  if (!sample) {
    return (
      <p className="dsc-muted">
        No answer engine is configured, so nothing was sampled. This is different from
        being invisible: we did not ask.
      </p>
    );
  }

  const { wavi, states, shareOfVoice: sov, runs = [], engine, live, liveAnswers, promptCount } = sample;
  const report = displacementReport(runs);

  return (
    <div className="dsc-aiv">

      {/* ── Provenance first. A number whose origin is unclear is unusable. ── */}
      <div className="dsc-aiv-source">
        <Icon name={live ? "radio" : "cpu"} size={14} />
        <span>
          {live
            ? <>Sampled live from <b>{engine}</b>{Number.isFinite(liveAnswers) && liveAnswers < promptCount
                ? <> — {liveAnswers} of {promptCount} answers were retrieved; the rest came from the model's own recall</>
                : null}</>
            : <>Answered from <b>{engine}</b>'s own recall, not the live web. Treat this as an indication, not a measurement.</>}
        </span>
      </div>

      {/* ── WAVI ─────────────────────────────────────────────────────────── */}
      {wavi && wavi.score !== null ? (
        <div className="dsc-aiv-wavi">
          <div className="dsc-aiv-score">
            <span className="dsc-aiv-num">{wavi.score}</span>
            <span className="dsc-aiv-label">
              AI visibility
              {/* Coverage sits beside the score, never behind a tooltip: a score
                  without it is half a measurement. */}
              <em> · {wavi.coverage}% of the index measured</em>
            </span>
          </div>
          <ul className="dsc-aiv-components">
            {WAVI_COMPONENT_IDS.map((id) => {
              const c = wavi.components[id];
              return (
                <li key={id} className={c.measured ? "" : "is-unmeasured"}>
                  <span className="dsc-aiv-cname">{c.label}</span>
                  <span className="dsc-aiv-cweight">{Math.round(c.weight * 100)}%</span>
                  <span className="dsc-aiv-cvalue">
                    {c.measured ? <Rate value={c.value} /> : NOT_MEASURED}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="dsc-muted">
          The sample could not be scored. Its weight redistributes across the other signals
          rather than counting as zero.
        </p>
      )}

      {/* ── The seven states ─────────────────────────────────────────────── */}
      {states?.total > 0 && (
        <div className="dsc-aiv-states">
          <h4 className="dsc-aiv-h">Across {states.total} prompt{states.total === 1 ? "" : "s"}</h4>
          <ul className="dsc-aiv-statelist">
            {CITATION_STATE_IDS.filter((id) => states.counts[id] > 0).map((id) => (
              <li key={id} className={CITATION_STATES[id].favourable ? "is-good" : "is-bad"}>
                <span className="dsc-aiv-scount">{states.counts[id]}</span>
                <span className="dsc-aiv-sname">{CITATION_STATES[id].label}</span>
                <span className="dsc-aiv-sfix">{CITATION_STATES[id].fix}</span>
              </li>
            ))}
          </ul>
          <div className="dsc-aiv-rates">
            <span>Mention <b><Rate value={states.mentionRate} /></b></span>
            <span>Citation <b><Rate value={states.citationRate} /></b></span>
            <span>
              Recommendation <b><Rate value={states.recommendationRate} /></b>
              {/* The denominator is the point: "what is X" was never a contest. */}
              {states.commercialTotal > 0
                ? <em> of {states.commercialTotal} commercial prompt{states.commercialTotal === 1 ? "" : "s"}</em>
                : <em> — no commercial prompt was asked</em>}
            </span>
          </div>
        </div>
      )}

      {/* ── Share of voice ───────────────────────────────────────────────── */}
      {sov && (sov.sovDeclared !== null || sov.sovObserved !== null) && (
        <div className="dsc-aiv-sov">
          <h4 className="dsc-aiv-h">Share of voice</h4>
          {/* 🔴 The two are shown apart and never summed. One is defensible
              against a fixed field the operator named; the other has a
              denominator that moves with whatever the engine cited. */}
          <p>
            <b>{pct(sov.sovDeclared) ?? "not measured"}</b> against the competitors you named
            {sov.declaredCompetitors.length > 0 && (
              <> — {sov.declaredCompetitors.map((c) => `${c.host} (${c.appearances})`).join(", ")}</>
            )}
          </p>
          {sov.discoveredCompetitors.length > 0 && (
            <p className="dsc-muted">
              <b>{pct(sov.sovObserved) ?? "not measured"}</b> against everyone cited, including
              {" "}{sov.discoveredCompetitors.map((c) => c.host).join(", ")} — inferred from citations,
              not named by you. A direction, not a target: the denominator moves with what the engine happened to cite.
            </p>
          )}
        </div>
      )}

      {/* ── Displacement ─────────────────────────────────────────────────── */}
      {report.displacedCount > 0 && (
        <div className="dsc-aiv-displaced">
          <h4 className="dsc-aiv-h">
            {report.displacedCount} question{report.displacedCount === 1 ? "" : "s"} answered by somebody else
          </h4>
          <ul className="dsc-aiv-dlist">
            {report.displaced.map((d) => (
              <li key={d.prompt}>{d.narrative}</li>
            ))}
          </ul>
        </div>
      )}

      {report.openCount > 0 && (
        <div className="dsc-aiv-open">
          <h4 className="dsc-aiv-h">
            {report.openCount} question{report.openCount === 1 ? "" : "s"} nobody owns
          </h4>
          <p className="dsc-muted">
            Neither you nor a tracked competitor appeared. Unclaimed questions are the cheapest
            ones to win.
          </p>
          <ul className="dsc-aiv-dlist">
            {report.openQuestions.map((q) => <li key={q.prompt}>{q.prompt}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
