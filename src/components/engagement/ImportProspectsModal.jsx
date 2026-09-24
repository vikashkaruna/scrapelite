// src/components/engagement/ImportProspectsModal.jsx — bring contacts in, see
// exactly what will happen to every row, import the healthy ones.
//
// Input, all in one drop zone (owner request 2026-09-24):
//   - paste text: CSV, semicolon or tab separated — including cells copied
//     straight from Excel or Google Sheets (they arrive tab-separated);
//   - paste or drop a FILE, or "Upload file": CSV / TSV / TXT / Excel .xlsx.
// Every source ends as CSV text and runs through analyzeProspectCsv(), so a
// file and a paste are judged by the same rules.
//
// Before anything is sent: a per-row preview (ready / already in this campaign
// / opted out of email / needs fixing / repeated), counts, "problems only",
// and a download of the problem rows. The campaign-side checks come from the
// read-only `preview_import` action, so the preview matches the import.
// Import proceeds with the healthy rows as long as there is at least one.
//
// After: the result panel names every skipped row and why.

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import {
  analyzeProspectCsv, importOutcome, skippedRows, skippedCsv, FIELD_LABELS, TEMPLATE_CSV,
} from "../../lib/engagement/prospectImport.js";
import { readProspectFile, ACCEPT } from "../../lib/engagement/prospectFiles.js";
import { downloadText } from "./ProspectsTable.jsx";
import { fmtDate } from "../../lib/utils.js";

const PREVIEW_ROWS = 200;
const STATUS = {
  ready: { label: "Ready", cls: "is-ok" },
  in_campaign: { label: "Already in campaign", cls: "is-skip" },
  opted_out: { label: "Ready · opted out of email", cls: "is-warn" },
  repeated: { label: "Repeated", cls: "is-skip" },
  rejected: { label: "Needs fixing", cls: "is-bad" },
};
const SUPPRESSION_WORDS = { unsubscribe: "unsubscribed", stop_keyword: "replied STOP", bounce: "email bounced", complaint: "reported spam", manual: "opted out by your team" };

export default function ImportProspectsModal({ campaignName, onImport, onPreview, onClose }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);      // { fileName, sheets?, sheet }
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);  // { outcome, skipped }
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [preview, setPreview] = useState(null); // { inCampaign, optedOut } for the current rows
  const fileInput = useRef(null);

  const analysis = useMemo(() => (text.trim() ? analyzeProspectCsv(text) : null), [text]);

  // Campaign-side check (already in the campaign, opted-out addresses),
  // debounced; an answer for an older paste is dropped.
  useEffect(() => {
    setPreview(null);
    if (!onPreview || !analysis?.ok) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      onPreview(analysis.rows).then((r) => { if (alive) setPreview(r); }).catch(() => {});
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [analysis, onPreview]);

  const view = useMemo(() => {
    if (!analysis) return null;
    const inCampaign = new Map((preview?.inCampaign || []).map((x) => [x.index, x]));
    const optedOut = new Map((preview?.optedOut || []).map((x) => [x.index, x]));
    const rows = (analysis.records || []).map((r) => {
      if (r.status !== "ready") return { ...r };
      if (inCampaign.has(r.rowIndex)) {
        const m = inCampaign.get(r.rowIndex);
        return {
          ...r, status: "in_campaign", existing: m.existing, matchedOn: m.matched_on,
          reason: `Same ${m.matched_on} as ${m.existing?.name}${m.existing?.created_at ? `, added ${fmtDate(m.existing.created_at)}` : ""}.`,
        };
      }
      if (optedOut.has(r.rowIndex)) {
        return { ...r, status: "opted_out", reason: `Will be imported but not emailed — ${SUPPRESSION_WORDS[optedOut.get(r.rowIndex).reason] || "opted out"}.` };
      }
      return r;
    });
    const count = (s) => rows.filter((r) => r.status === s).length;
    return {
      rows,
      importIdx: new Set(rows.filter((r) => r.status === "ready" || r.status === "opted_out").map((r) => r.rowIndex)),
      counts: { ready: count("ready"), optedOut: count("opted_out"), inCampaign: count("in_campaign"), repeated: count("repeated"), rejected: count("rejected") },
    };
  }, [analysis, preview]);

  const importCount = view?.importIdx.size || 0;
  const skipCount = view ? view.rows.length - importCount : 0;

  // ── input ────────────────────────────────────────────────────────────────
  const loadFile = async (f) => {
    setFileError(""); setError("");
    const r = await readProspectFile(f);
    if (!r.ok) { setFileError(r.error); return; }
    setFile({ fileName: r.fileName, sheets: r.sheets || null, sheet: r.sheets?.[0]?.name || null });
    setText(r.text);
  };
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  };
  const onPaste = (e) => {
    const f = e.clipboardData?.files?.[0];
    if (f) { e.preventDefault(); loadFile(f); }
  };
  const pickSheet = (name) => {
    const s = file?.sheets?.find((x) => x.name === name);
    if (s) { setFile({ ...file, sheet: name }); setText(s.text); }
  };
  const clearAll = () => { setText(""); setFile(null); setFileError(""); setError(""); };

  // ── import ───────────────────────────────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault();
    if (!analysis?.ok || importCount === 0) return;
    setBusy(true);
    setError("");
    const keep = (_, i) => view.importIdx.has(i);
    const sent = { ...analysis, rows: analysis.rows.filter(keep), lines: analysis.lines.filter(keep) };
    try {
      const res = await onImport(sent.rows);
      const skipped = skippedRows(sent, res);
      // Rows the preview already held back as "in this campaign" are reported too.
      for (const r of view.rows.filter((x) => x.status === "in_campaign")) {
        skipped.inCampaign.push({ line: r.line, name: r.name, email: r.email, phone: r.phone, matchedOn: r.matchedOn || "email", existing: r.existing || null });
      }
      skipped.inCampaign.sort((a, b) => (a.line || 0) - (b.line || 0));
      const outcome = importOutcome(analysis, res);
      outcome.alreadyInCampaign = skipped.inCampaign.length;
      setResult({ outcome, skipped });
    } catch (err) {
      setError(`Nothing was imported. ${err.message || "The import failed."}`);
    } finally {
      setBusy(false);
    }
  };

  const problemsCsv = () => {
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const out = [["line", "name", "email", "phone", "status", "reason"].join(",")];
    for (const r of view.rows.filter((x) => x.status !== "ready")) {
      out.push([r.line, r.name, r.email, r.phone, STATUS[r.status].label, r.reason || ""].map(cell).join(","));
    }
    return out.join("\n") + "\n";
  };

  const shownRows = view ? (problemsOnly ? view.rows.filter((r) => r.status !== "ready") : view.rows) : [];

  return (
    <div className="eng-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="eng-modal-card eng-import-card" role="dialog" aria-modal="true" aria-labelledby="eng-import-title" onClick={(e) => e.stopPropagation()}>
        <div className="eng-modal-header">
          <h3 className="eng-modal-title" id="eng-import-title">Import prospects{campaignName ? ` into “${campaignName}”` : ""}</h3>
          <button type="button" className="eng-modal-close" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        {result ? (
          <div className="eng-modal-form">
            <ImportResult outcome={result.outcome} />
            <SkippedList skipped={result.skipped} />
            <div className="eng-modal-actions">
              {(result.skipped.inCampaign.length + result.skipped.repeated.length + result.skipped.rejected.length) > 0 && (
                <Button type="button" variant="secondary" icon="download"
                  onClick={() => downloadText("datiq-skipped-rows.csv", skippedCsv(result.skipped))}>
                  Download skipped rows
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => { setResult(null); clearAll(); }}>Import more</Button>
              <Button type="button" variant="primary" icon="check" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="eng-modal-form">
            <div className="engx-import-intro">
              <p className="eng-modal-intro">
                Paste rows, or upload a CSV or Excel file. A header row is optional — without one, columns are read from
                what they contain. Each contact needs an email or a phone.
              </p>
              <div className="engx-import-buttons">
                <Button type="button" variant="primary" size="sm" icon="upload" onClick={() => fileInput.current?.click()}>Upload file</Button>
                <Button type="button" variant="secondary" size="sm" icon="download"
                  onClick={() => downloadText("datiq-prospects-template.csv", TEMPLATE_CSV)}>
                  Download template
                </Button>
                <input ref={fileInput} type="file" accept={ACCEPT} hidden aria-label="Upload a CSV or Excel file"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
              </div>
            </div>

            {fileError && <p className="eng-field-hint is-error" role="alert"><Icon name="alert-circle" size={12} /> {fileError}</p>}
            {file && (
              <div className="engx-file-chip">
                <Icon name="file-text" size={14} />
                <strong>{file.fileName}</strong>
                {file.sheets?.length > 1 && (
                  <select className="engx-select" value={file.sheet} onChange={(e) => pickSheet(e.target.value)} aria-label="Sheet">
                    {file.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows} rows)</option>)}
                  </select>
                )}
                <button type="button" className="engx-link" onClick={clearAll}>Clear</button>
              </div>
            )}

            {analysis?.headerless && analysis.columns.length > 0 && (
              <div className="engx-import-inferred" role="status">
                <Icon name="info" size={14} />
                <div>
                  <strong>No header row — columns read as:</strong>
                  <div className="eng-import-cols">
                    {analysis.columns.map((c, i) => (
                      <span key={i} className={`eng-import-col ${c.field ? "is-known" : "is-custom"}`}>{i + 1}. {c.field ? FIELD_LABELS[c.field] : "custom"}</span>
                    ))}
                  </div>
                  <span className="engx-muted">If that's wrong, add a header line (or use the template).</span>
                </div>
              </div>
            )}

            <div
              className={`engx-dropzone ${dragging ? "is-dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <textarea
                className="eng-textarea-field eng-import-textarea"
                rows={file ? 4 : 7}
                placeholder={"Paste rows here — or drop a CSV / Excel file.\n\nfirst_name,last_name,email,company,role,phone\nAlice,Smith,alice@acme.com,Acme Corp,VP Engineering,+15551234567"}
                value={text}
                onChange={(e) => { setText(e.target.value); setError(""); if (file) setFile(null); }}
                onPaste={onPaste}
                aria-label="CSV to import"
              />
              {dragging && <div className="engx-dropzone-hint" aria-hidden="true"><Icon name="upload" size={18} /> Drop to read the file</div>}
            </div>

            <div aria-live="polite">
              {analysis && !analysis.ok && analysis.error && (
                <p className="eng-field-hint is-error" role="alert"><Icon name="alert-circle" size={12} /> {analysis.error}</p>
              )}
              {view && view.rows.length > 0 && (
                <div className="engx-import-check">
                  <div className="engx-import-summary">
                    <span className="engx-pill is-ok">{view.counts.ready + view.counts.optedOut} ready</span>
                    {view.counts.inCampaign > 0 && <span className="engx-pill is-skip">{view.counts.inCampaign} already in campaign</span>}
                    {view.counts.optedOut > 0 && <span className="engx-pill is-warn">{view.counts.optedOut} opted out of email</span>}
                    {view.counts.repeated > 0 && <span className="engx-pill is-skip">{view.counts.repeated} repeated</span>}
                    {view.counts.rejected > 0 && <span className="engx-pill is-bad">{view.counts.rejected} need fixing</span>}
                    {!preview && onPreview && analysis.ok && <span className="engx-muted">Checking against this campaign…</span>}
                    <span className="engx-spacer" />
                    <label className="engx-toggle">
                      <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> Show problems only
                    </label>
                    {view.rows.some((r) => r.status !== "ready") && (
                      <button type="button" className="engx-link" onClick={() => downloadText("datiq-problem-rows.csv", problemsCsv())}>Download problem rows</button>
                    )}
                  </div>
                  <div className="engx-preview-wrap">
                    <table className="engx-table is-compact">
                      <thead><tr><th>Line</th><th>Name</th><th>Email / phone</th><th>Status</th></tr></thead>
                      <tbody>
                        {shownRows.slice(0, PREVIEW_ROWS).map((r) => (
                          <tr key={r.line}>
                            <td className="is-num">{r.line}</td>
                            <td>{r.name || "—"}</td>
                            <td className="engx-muted">{r.email || r.phone || "—"}</td>
                            <td>
                              <span className={`engx-pill ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                              {r.reason && r.status !== "ready" && <div className="engx-muted">{r.reason}</div>}
                            </td>
                          </tr>
                        ))}
                        {shownRows.length === 0 && <tr><td colSpan={4} className="engx-table-empty">No problems — every row is ready.</td></tr>}
                      </tbody>
                    </table>
                    {shownRows.length > PREVIEW_ROWS && <p className="engx-fineprint">Showing the first {PREVIEW_ROWS} of {shownRows.length} rows.</p>}
                  </div>
                </div>
              )}
            </div>
            {error && <p className="eng-field-hint is-error" role="alert">{error}</p>}

            <div className="eng-modal-actions">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" variant="primary" icon="upload" disabled={busy || !analysis?.ok || importCount === 0}>
                {busy ? "Importing…" : importCount
                  ? `Import ${importCount} ready row${importCount === 1 ? "" : "s"}${skipCount ? ` (skip ${skipCount})` : ""}`
                  : "Import prospects"}
              </Button>
            </div>
            {analysis?.ok && importCount === 0 && view?.counts.inCampaign > 0 && (
              <p className="eng-field-hint">Every ready row is already in this campaign — nothing new to import.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

/** Headline in words: "Imported 18 of 25 — 5 were already in this campaign, 2 repeated in your paste". */
export function importHeadline(o) {
  const skippedBits = [
    o.alreadyInCampaign && `${o.alreadyInCampaign} ${o.alreadyInCampaign === 1 ? "was" : "were"} already in this campaign`,
    o.repeatedInPaste && `${o.repeatedInPaste} repeated in your paste`,
    (o.rejectedBeforeSending + o.rejectedByServer) && `${o.rejectedBeforeSending + o.rejectedByServer} had problems`,
  ].filter(Boolean);
  const head = o.added === 0 ? "No new prospects were added" : `Imported ${o.added} of ${o.totalRows}`;
  return skippedBits.length ? `${head} — ${skippedBits.join(", ")}.` : `${head}.`;
}

function SkippedList({ skipped }) {
  const { inCampaign, repeated, rejected } = skipped;
  if (!inCampaign.length && !repeated.length && !rejected.length) return null;
  const at = (l) => (l ? `Line ${l}` : "");
  return (
    <div className="engx-skipped">
      {inCampaign.length > 0 && (
        <section>
          <h4>Already in this campaign ({inCampaign.length})</h4>
          <ul>
            {inCampaign.map((r, i) => (
              <li key={`c${i}`}>
                <span className="eng-import-line">{at(r.line)}</span> {r.name || r.email || r.phone}
                <span className="engx-muted"> — same {r.matchedOn} as <strong>{r.existing?.name}</strong>{r.existing?.created_at ? `, added ${fmtDate(r.existing.created_at)}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {repeated.length > 0 && (
        <section>
          <h4>Repeated in this import ({repeated.length})</h4>
          <ul>{repeated.map((r, i) => <li key={`r${i}`}><span className="eng-import-line">{at(r.line)}</span> {r.name || r.email || r.phone} <span className="engx-muted">— same {r.matchedOn} as an earlier row</span></li>)}</ul>
        </section>
      )}
      {rejected.length > 0 && (
        <section>
          <h4>Not imported — needs fixing ({rejected.length})</h4>
          <ul>{rejected.map((r, i) => <li key={`x${i}`}><span className="eng-import-line">{at(r.line)}</span> {r.reason}</li>)}</ul>
        </section>
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
        {importHeadline(outcome)}
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
