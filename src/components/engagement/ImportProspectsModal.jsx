// src/components/engagement/ImportProspectsModal.jsx — paste CSV, see what will
// happen, import, see what DID happen.
//
// Three states, and the dialog never closes on its own:
//   1. editing  — a live check under the box: columns recognised, rows ready,
//                 rows with problems (by line number). Import is disabled until
//                 at least one row is importable, and the reason is shown.
//   2. importing
//   3. result   — added / already in this campaign / rejected / repeated, from
//                 the browser's check AND the server's answer.
// The old dialog closed after a toast either way, so "Imported 0" and a failure
// both looked like the window simply going away.

import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { analyzeProspectCsv, importOutcome, FIELD_LABELS } from "../../lib/engagement/prospectImport.js";

const SAMPLE = "first_name,last_name,email,company,role,phone\nAlice,Smith,alice@acme.com,Acme Corp,VP Engineering,+15551234567\nBob,Jones,bob@apex.io,\"Apex, Inc.\",CEO,";

function IssueList({ issues, truncated }) {
  if (!issues.length) return null;
  return (
    <ul className="eng-import-issues">
      {issues.map((i, idx) => <li key={`${i.line}-${idx}`}><span className="eng-import-line">Line {i.line}</span> {i.reason}</li>)}
      {truncated > 0 && <li className="eng-import-more">…and {truncated} more.</li>}
    </ul>
  );
}

export default function ImportProspectsModal({ campaignName, onImport, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { outcome, analysis }

  const analysis = useMemo(() => (text.trim() ? analyzeProspectCsv(text) : null), [text]);

  const submit = async (e) => {
    e.preventDefault();
    if (!analysis?.ok) return;
    setBusy(true);
    setError("");
    try {
      const res = await onImport(analysis.rows);
      setResult({ outcome: importOutcome(analysis, res), analysis });
    } catch (err) {
      setError(`Nothing was imported. ${err.message || "The import failed."}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => { setResult(null); setText(""); setError(""); };

  return (
    <div className="eng-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="eng-modal-card eng-import-card" role="dialog" aria-modal="true" aria-labelledby="eng-import-title" onClick={(e) => e.stopPropagation()}>
        <div className="eng-modal-header">
          <h3 className="eng-modal-title" id="eng-import-title">Import prospects{campaignName ? ` into “${campaignName}”` : ""}</h3>
          <button className="eng-modal-close" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        {result ? (
          <div className="eng-modal-form">
            <ImportResult outcome={result.outcome} />
            <IssueList issues={result.analysis.issues} truncated={result.analysis.issuesTruncated} />
            <div className="eng-modal-actions">
              <Button type="button" variant="ghost" onClick={reset}>Import more</Button>
              <Button type="button" variant="primary" icon="check" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="eng-modal-form">
            <p className="eng-modal-intro">
              Paste CSV with a <strong>header row first</strong>, then one contact per line. Each contact needs an
              email or a phone. Recognised columns: <code>first_name, last_name, name, email, phone, company, role, industry, country</code>.
              Other columns are kept as custom fields. Wrap values that contain a comma in double quotes.
            </p>
            <div className="eng-form-group">
              <textarea
                className="eng-textarea-field eng-import-textarea"
                rows={8}
                placeholder={SAMPLE}
                value={text}
                onChange={(e) => { setText(e.target.value); setError(""); }}
                aria-label="CSV to import"
                aria-describedby="eng-import-check"
              />
            </div>

            <div id="eng-import-check" aria-live="polite">
              {analysis && <ImportCheck analysis={analysis} />}
            </div>
            {error && <p className="eng-field-hint is-error" role="alert">{error}</p>}

            <div className="eng-modal-actions">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" type="submit" icon="upload" disabled={busy || !analysis?.ok}>
                {busy ? "Importing…" : analysis?.ok ? `Import ${analysis.counts.ready} prospect${analysis.counts.ready === 1 ? "" : "s"}` : "Import prospects"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ImportCheck({ analysis }) {
  const { counts, columns } = analysis;
  const recognised = columns.filter((c) => c.field);
  return (
    <div className={`eng-import-check ${analysis.ok ? "" : "is-blocked"}`}>
      {recognised.length > 0 && (
        <div className="eng-import-cols">
          {columns.map((c, i) => (
            <span key={`${c.header}-${i}`} className={`eng-import-col ${c.field ? "is-known" : "is-custom"}`} title={c.field ? `Read as ${FIELD_LABELS[c.field]}` : "Kept as a custom field"}>
              {c.header || "(blank)"}{c.field ? "" : " · custom"}
            </span>
          ))}
        </div>
      )}
      {analysis.error ? (
        <p className="eng-field-hint is-error" role="alert"><Icon name="alert-circle" size={12} /> {analysis.error}</p>
      ) : (
        <p className="eng-import-summary">
          <strong>{counts.ready}</strong> of {counts.dataRows} row{counts.dataRows === 1 ? "" : "s"} ready
          {counts.rejected > 0 && <> · <span className="is-bad">{counts.rejected} with problems</span></>}
          {counts.repeated > 0 && <> · {counts.repeated} repeated in this paste</>}
        </p>
      )}
      <IssueList issues={analysis.issues} truncated={analysis.issuesTruncated} />
      {analysis.ok && counts.rejected > 0 && (
        <p className="eng-field-hint">Rows with problems will be skipped. Fix them above to include them.</p>
      )}
    </div>
  );
}

function ImportResult({ outcome }) {
  const nothing = outcome.added === 0;
  const rows = [
    { label: "Added to this campaign", value: outcome.added, tone: "ok" },
    { label: "Already in this campaign (skipped)", value: outcome.alreadyInCampaign },
    { label: "Repeated within the paste (skipped)", value: outcome.repeatedInPaste },
    { label: "Rejected — invalid or missing contact details", value: outcome.rejectedBeforeSending + outcome.rejectedByServer, tone: "bad" },
  ];
  return (
    <div className={`eng-import-result ${nothing ? "is-empty" : ""}`} role="status">
      <p className="eng-import-result-head">
        <Icon name={nothing ? "alert-triangle" : "check-circle"} size={16} />
        {nothing
          ? "No new prospects were added."
          : `Imported ${outcome.added} of ${outcome.totalRows} row${outcome.totalRows === 1 ? "" : "s"}.`}
      </p>
      <dl className="eng-import-stats">
        {rows.map((r) => (
          <div key={r.label} className={r.value && r.tone ? `is-${r.tone}` : ""}>
            <dt>{r.label}</dt><dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
