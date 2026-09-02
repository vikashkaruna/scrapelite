// src/pages/Templates.jsx — PRD 1: the persona-specific template gallery
// and the runner, as one screen.
//
// Two views, one route:
//   /templates            the catalogue, filtered by persona
//   /templates?key=<k>    the runner for one template
//
// Deliberately one route: the PRD's acceptance criterion is "a new user can
// choose a template and complete a first workflow in fewer than five minutes",
// and every navigation between a catalogue and a separate runner page is a
// place that journey can be abandoned.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { PERSONAS } from "../lib/personaConfig.js";
import { validateInput, estimateCredits } from "../lib/templates/templateModel.js";
import { describeEstimate } from "../lib/credits/creditModel.js";
import * as api from "../lib/templates/templatesClient.js";
import { createReport } from "../lib/reports/reportsClient.js";
import ShareReportDialog from "../components/ShareReportDialog.jsx";

export default function Templates() {
  const [params, setParams] = useSearchParams();
  const key = params.get("key");
  return key ? <TemplateRunner templateKey={key} onBack={() => setParams({})} />
             : <TemplateGalleryView onPick={(k) => setParams({ key: k })} />;
}

// ── catalogue ───────────────────────────────────────────────────────────────

function TemplateGalleryView({ onPick }) {
  const { personaId } = usePersona();
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(personaId || "all");

  useEffect(() => {
    let alive = true;
    api.listTemplates()
      .then((r) => { if (alive) setTemplates(r.templates || []); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => {
    if (!templates) return [];
    return filter === "all" ? templates : templates.filter((t) => t.persona === filter);
  }, [templates, filter]);

  const personasWithTemplates = useMemo(() => {
    const present = new Set((templates || []).map((t) => t.persona));
    return PERSONAS.filter((p) => present.has(p.id));
  }, [templates]);

  return (
    <div className="page container tpl-page">
      <header className="tpl-header">
        <h1>Workflow templates</h1>
        <p className="tpl-sub">
          Pick the outcome you need. Give us one domain. Get a finished piece of work — no
          prompt writing, no schema design.
        </p>
      </header>

      {templates && templates.length > 0 && (
        <div className="tpl-filters" role="tablist" aria-label="Filter templates by role">
          <button
            role="tab" aria-selected={filter === "all"}
            className={`tpl-chip${filter === "all" ? " on" : ""}`}
            onClick={() => setFilter("all")}
          >All roles</button>
          {personasWithTemplates.map((p) => (
            <button
              key={p.id} role="tab" aria-selected={filter === p.id}
              className={`tpl-chip${filter === p.id ? " on" : ""}`}
              onClick={() => setFilter(p.id)}
            >{p.label || p.name || p.id}</button>
          ))}
        </div>
      )}

      {error && <div className="card tpl-error">Couldn't load templates: {error}</div>}
      {!templates && !error && <div className="card tpl-empty">Loading templates…</div>}

      <div className="tpl-grid">
        {shown.map((t) => (
          <button key={t.template_key} className="tpl-card" onClick={() => onPick(t.template_key)}>
            <div className="tpl-card-head">
              <h2>{t.title}</h2>
              {t.persona && <span className="tpl-persona">{personaLabel(t.persona)}</span>}
            </div>
            <p className="tpl-card-desc">{t.summary}</p>
            <span className="tpl-card-cta">
              Run this <Icon name="arrow-up" size={14} />
            </span>
          </button>
        ))}
      </div>

      {templates && shown.length === 0 && (
        <div className="card tpl-empty">No templates for that role yet.</div>
      )}
    </div>
  );
}

function personaLabel(id) {
  const p = PERSONAS.find((x) => x.id === id);
  return p?.label || p?.name || id;
}

// ── runner ──────────────────────────────────────────────────────────────────

function TemplateRunner({ templateKey, onBack }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const { user, openAuth } = useAuth();

  const [template, setTemplate] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [shareFor, setShareFor] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getTemplate(templateKey)
      .then((r) => {
        if (!alive) return;
        setTemplate(r.template);
        const seed = {};
        for (const f of r.template.input_schema?.fields || []) {
          if (f.default !== undefined) seed[f.name] = f.default;
        }
        setValues(seed);
      })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [templateKey]);

  // The estimate updates as the user types, so the cost is never a surprise
  // revealed at the moment of commitment.
  const estimate = useMemo(() => {
    if (!template) return null;
    const v = validateInput(template, values);
    return estimateCredits(template, v.ok ? v.value : values);
  }, [template, values]);

  async function run() {
    if (!template) return;
    const v = validateInput(template, values);
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors([]);
    setBusy(true);
    setResult(null);
    setProgress({ message: "Starting…", percent: 5 });

    let runId = null;
    try {
      const started = await api.startRun(template.template_key, v.value);
      runId = started.runId;
      if (started.guest) {
        showToast("Running as a guest — sign in to save this to your dashboard.");
      }
      const exec = await api.executeRun({
        template: started.template || template,
        input: v.value,
        onProgress: setProgress,
      });

      if (runId) {
        const done = await api.finishRun(runId, exec);
        setResult({ ...exec, run: done.run, reconciliation: done.reconciliation });
        if (done.reconciliation?.needsDisclosure) {
          showToast(`This run used ${done.charged} credits — more than the ${done.run.credits_estimated} we estimated.`);
        }
      } else {
        setResult(exec);
      }
      setProgress(null);
    } catch (e) {
      setProgress(null);
      if (runId) { try { await api.failRun(runId, e.message); } catch { /* best effort */ } }
      // A failed run charges nothing — say so, because the first thing a user
      // wonders after an error is whether they were billed for it.
      showToast(`${e.message} — no credits were used.`);
    } finally {
      setBusy(false);
    }
  }

  async function makeReport() {
    if (!result) return;
    if (!user) { openAuth("signup"); return; }
    try {
      const r = await createReport({
        title: `${template.title} — ${result.output.title}`,
        runId: result.run?.id || null,
        sourceUrl: result.output.target,
        templateKey: template.template_key,
        data: { output: result.output, summary: result.summary, sources: result.sources },
      });
      setShareFor(r.report);
    } catch (e) {
      showToast(`Couldn't create the report: ${e.message}`);
    }
  }

  if (loadError) {
    return (
      <div className="page container tpl-page">
        <div className="card tpl-error">Couldn't load that template: {loadError}</div>
        <Button variant="secondary" onClick={onBack}>Back to templates</Button>
      </div>
    );
  }
  if (!template) return <div className="page container tpl-page"><div className="card tpl-empty">Loading…</div></div>;

  const fields = template.input_schema?.fields || [];

  return (
    <div className="page container tpl-page">
      <button className="tpl-back" onClick={onBack}>
        <Icon name="arrow-up" size={14} /> All templates
      </button>

      <header className="tpl-header">
        <h1>{template.title}</h1>
        <p className="tpl-sub">{template.summary}</p>
      </header>

      <div className="card tpl-form">
        {fields.map((f) => (
          <FieldInput
            key={f.name} field={f} value={values[f.name]}
            onChange={(val) => setValues((v) => ({ ...v, [f.name]: val }))}
          />
        ))}

        {errors.length > 0 && (
          <ul className="tpl-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}

        <div className="tpl-run-row">
          <Button onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run this template"}
          </Button>
          {estimate && (
            <span className="tpl-estimate" title="Estimated before the run; you are charged for what actually runs.">
              {describeEstimate(estimate)}
            </span>
          )}
        </div>

        {progress && (
          <div className="tpl-progress">
            <div className="tpl-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
            <span>{progress.message}</span>
          </div>
        )}
      </div>

      {result && <RunResult result={result} template={template} onShare={makeReport} />}

      {shareFor && (
        <ShareReportDialog
          report={shareFor}
          onClose={() => setShareFor(null)}
          onChanged={(r) => setShareFor(r)}
        />
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const id = `tpl-f-${field.name}`;
  return (
    <div className="tpl-field">
      <label htmlFor={id}>
        {field.label || field.name}
        {field.required && <span className="tpl-req" aria-hidden="true"> *</span>}
      </label>
      {field.kind === "choice" ? (
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
          {(field.options || []).map((o) => {
            const val = typeof o === "object" ? o.value : o;
            const lbl = typeof o === "object" ? o.label : o;
            return <option key={val} value={val}>{lbl}</option>;
          })}
        </select>
      ) : field.kind === "domain_list" ? (
        <textarea id={id} rows={5} value={value ?? ""} placeholder={field.placeholder}
                  onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "boolean" ? (
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : (
        <input id={id} type="text" value={value ?? ""} placeholder={field.placeholder}
               onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <p className="tpl-help">{field.help}</p>}
    </div>
  );
}

function RunResult({ result, template, onShare }) {
  const blocks = template.output_schema?.blocks || [];
  return (
    <div className="card tpl-result">
      <div className="tpl-result-head">
        <h2>Result</h2>
        <Button variant="secondary" onClick={onShare}>
          <Icon name="share-2" size={14} /> Create shareable report
        </Button>
      </div>

      {result.summary && (
        <section className="tpl-block">
          <h3>{blocks.find((b) => b.kind === "summary")?.title || "Summary"}</h3>
          {/* AI-written prose. Labelled, because it is an interpretation of the
              page and not a quotation from it. */}
          <p className="tpl-ai">{result.summary}</p>
          <p className="tpl-ai-note">Written by AI from the extracted facts below.</p>
        </section>
      )}

      {result.output?.fields && (
        <section className="tpl-block">
          <h3>Extracted facts</h3>
          <pre className="tpl-json">{JSON.stringify(result.output.fields, null, 2)}</pre>
        </section>
      )}

      <section className="tpl-block">
        <h3>Sources</h3>
        <ul className="tpl-sources">
          {(result.sources || []).map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a>
              <span className="tpl-src-meta">
                {s.provider ? ` · via ${s.provider}` : ""}
                {s.fetched_at ? ` · read ${new Date(s.fetched_at).toLocaleString()}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
