// TracePanel — "if this happened, what would actually fire?"
//
// ── WHY A DRY RUN IS THE USEFUL HALF ───────────────────────────────────────
// Phase 1 answers "is anything connected". This answers the question that comes
// straight after it and had no answer anywhere in the product: my rule is
// active, its source is live, and it has still never fired — WHY.
//
// The honest reason is almost always a condition that is narrower than the
// events actually arriving, and until now the only way to find out was to wait
// for a real competitor to change a real price.
//
// ⚠️ IT EVALUATES WITH THE RUNTIME'S OWN `evaluateSignalRule`, NOT A COPY, and
// against payloads whose field names are lifted from the real producers. Both
// halves matter: a preview using a second implementation drifts, and a preview
// using invented field names reports every condition as unmatched and sends the
// user to "fix" a rule that was already correct.
//
// ⚠️ AND IT SENDS NOTHING. No Slack message, no email, no ledger entry — this
// is the question "would it fire", never "make it fire". The screen says so,
// because a preview a user is afraid to click is a preview nobody uses.
import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import { SAMPLE_EVENTS, traceEvent, labelForTrigger } from "../../lib/workflows/workflowGraph.js";

export default function TracePanel({ rules = [] }) {
  const [sampleId, setSampleId] = useState(SAMPLE_EVENTS[0].id);
  const sample = SAMPLE_EVENTS.find((s) => s.id === sampleId) || SAMPLE_EVENTS[0];
  const result = useMemo(() => traceEvent(rules, sample), [rules, sample]);

  return (
    <section className="wf-trace" id="wf-trace">
      <h2>Dry trace <span className="wf-trace-safe"><Icon name="shield" size={12} /> nothing is sent</span></h2>
      <p className="wf-trace-intro">
        Pick something that could happen and see which of your rules would act on it —
        and, for the ones that would not, exactly which condition turned them away.
      </p>

      <div className="wf-trace-picker" role="radiogroup" aria-label="Sample event">
        {SAMPLE_EVENTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === sampleId}
            className={"wf-trace-chip" + (s.id === sampleId ? " on" : "")}
            onClick={() => setSampleId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {rules.length === 0 ? (
        <p className="wf-muted">You have no rules yet, so nothing would fire. Create one above first.</p>
      ) : (
        <>
          <div className="wf-trace-verdict">
            {result.wouldFire > 0 ? (
              <span className="wf-trace-fire">
                <Icon name="zap" size={14} /> {result.wouldFire} rule{result.wouldFire === 1 ? "" : "s"} would fire
              </span>
            ) : (
              <span className="wf-trace-none">
                <Icon name="alert-circle" size={14} /> No rule would fire for this
              </span>
            )}
            <span className="wf-trace-kind">
              event kind <code>{sample.kind}</code> · source {labelForTrigger(sample.source)}
            </span>
          </div>

          <ul className="wf-trace-list">
            {[...result.matched, ...result.skipped].map((r) => {
              const fires = result.matched.includes(r);
              return (
                <li key={r.rule.id} className={"wf-trace-row " + (fires ? "wf-trace-row-on" : "")}>
                  <Icon name={fires ? "check" : "x"} size={14} />
                  <div className="wf-trace-row-body">
                    <div className="wf-trace-row-head">
                      <strong>{r.rule.label || r.rule.name}</strong>
                      <span className="wf-trace-row-meta">
                        {labelForTrigger(r.rule.trigger_source)} → {r.rule.action_type}
                      </span>
                    </div>
                    {/* The REASONS are the point. "Did not match" is not an
                        answer a user can act on; "category is 'positioning',
                        expected 'pricing'" tells them exactly what to change. */}
                    <ul className="wf-trace-reasons">
                      {(r.reasons || []).map((why, i) => <li key={i}>{why}</li>)}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>

          <details className="wf-trace-payload">
            <summary>See the exact event this was tested against</summary>
            <pre>{JSON.stringify(sample.payload, null, 2)}</pre>
            <p className="wf-inline-note">
              <Icon name="info" size={12} />
              These field names come from the real producers, so a condition that matches here
              matches in production.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
