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
import { useSearchParams, useNavigate, useLocation } from "react-router";
import Icon from "../components/Icon.jsx";
import DomainListInput from "../components/DomainListInput.jsx";
import { useTemplateRun } from "../components/TemplateRunProvider.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { PERSONAS } from "../lib/personaConfig.js";
import { validateInput, estimateCredits } from "../lib/templates/templateModel.js";
import { checkAllowance } from "../lib/credits/creditModel.js";
import { describeEstimate } from "../lib/credits/creditModel.js";
import * as api from "../lib/templates/templatesClient.js";
import { readTemplatesCache, writeTemplatesCache } from "../lib/templates/templatesCache.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";
import { createReport } from "../lib/reports/reportsClient.js";
import { lifecycle } from "../lib/analyticsService.js";
import ShareReportDialog from "../components/ShareReportDialog.jsx";
import StructuredFacts from "../components/StructuredFacts.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import { runToItem } from "../lib/templates/runToItems.js";
import { CAPABILITY_SCHEMAS } from "../lib/extractionSchemas.js";

export default function Templates() {
  const [params, setParams] = useSearchParams();
  const key = params.get("key") || params.get("t");
  const runId = params.get("runId") || params.get("run");
  return (key || runId) ? <TemplateRunner templateKey={key} runId={runId} onBack={() => setParams({})} />
             : <TemplateGalleryView onPick={(k) => setParams({ key: k })} />;
}

// ── catalogue ───────────────────────────────────────────────────────────────

function TemplateGalleryView({ onPick }) {
  const { personaId } = usePersona();

  // /templates is a public acquisition surface — the PRD's whole point is that
  // a template page is also a landing page — so it needs real metadata, the
  // same as every other indexable route. The runner view below deliberately
  // does NOT set its own: it is the same URL with a query param, and letting
  // it rewrite the title would churn the tab on every template click.
  useSeo({
    title: "Workflow templates — turn a URL into finished work | DatIQ",
    description:
      "Ready-to-run workflows for sales, competitive intelligence, SEO and research. Give one domain, get a source-backed account brief, pricing tracker, audit or due-diligence brief — no prompt writing.",
  });
  // Paint from the prefetched catalogue on the very first render — a lazy
  // useState initialiser, so there is no flash of the spinner before an effect
  // gets a chance to run. `null` still means "nothing to show yet" and keeps
  // the loading state below working unchanged for a cold visitor.
  const [templates, setTemplates] = useState(() => readTemplatesCache()?.templates || null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(personaId || "all");

  useEffect(() => {
    let alive = true;
    // Always revalidate, cache hit or not. That is what makes a browser
    // refresh a real reload from the database rather than a re-read of
    // whatever this browser happened to store — the cache only ever buys the
    // first paint.
    api.listTemplates()
      .then((r) => {
        if (!alive) return;
        const list = r.templates || [];
        // A degraded response is the server's built-in seed fallback, not the
        // catalogue. Rendering it is fine; REPLACING a good list with it is
        // not, because the visitor would silently lose templates that exist.
        // writeTemplatesCache refuses to store it for the same reason.
        if (r.degraded && templates?.length) return;
        setTemplates(list);
        writeTemplatesCache(r);
      })
      // A network failure with a warm cache is not an error the visitor needs
      // to see — the page is already rendering a usable catalogue, and the
      // revalidation is invisible by design. Only a cold load surfaces it.
      .catch((e) => { if (alive && !templates?.length) setError(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

// Templates that HAND OFF to a purpose-built module instead of running here.
//
// The SEO/GEO/AEO audit is a full four-pillar engine at /discoverability with
// its own profiles, devices, page types, history, trends and re-audit
// comparison. Re-running a thin version of it inside the template runner gave
// the user a worse audit AND spent a template credit for it, while the real
// module sat one click away.
//
// PREFILL, NEVER AUTO-RUN — the same contract /discoverability already
// enforces for the Home composer's hand-off: "auto-running would spend an
// audit credit on defaults they never saw, which is the kind of surprise a
// quota makes expensive."
const HANDOFF = {
  discoverability_audit: {
    to: "/discoverability",
    label: "Open in Discoverability",
    why: "This audit runs in the Discoverability module, which has the full four-pillar engine, history and re-audit comparison.",
    state: (input) => ({ auditUrl: input.domain ? `https://${input.domain}` : input.url }),
  },
  bulk_icp_enrichment: {
    to: "/lists",
    label: "Open in Bulk Account Lists",
    why: "Bulk enrichment runs in the Account Lists module, which provides deduplication, CSV/domain paste import, durable chunked execution, and ICP scoring.",
    state: (input) => ({ initialDomains: input.domains, icpProfile: input.icp_profile }),
  },
};

function TemplateRunner({ templateKey, runId = null, onBack }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, openAuth } = useAuth();

  const [activeKey, setActiveKey] = useState(templateKey);
  const [template, setTemplate] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [degraded, setDegraded] = useState(false);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState([]);
  const [budget, setBudget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [shareFor, setShareFor] = useState(null);
  // Optional: the provider is mounted app-wide, but the page is also rendered
  // directly in unit tests without it, so every call site is guarded.
  const tplRun = useTemplateRun();

  useEffect(() => {
    if (templateKey) {
      setActiveKey(templateKey);
    }
  }, [templateKey]);

  useEffect(() => {
    if (location.state?.prefill) {
      setValues((v) => ({ ...v, ...location.state.prefill }));
    }
  }, [location.state?.prefill]);

  // Load an existing run if runId is supplied
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const cached = readPageCache(`templateRun_${runId}`)?.data;
    if (cached) {
      setActiveKey(cached.template_key);
      setValues(cached.input || {});
      setResult({
        output: cached.output || {},
        summary: cached.output_summary || cached.output?.summary || null,
        talking_points: cached.output?.talking_points || null,
        sources: cached.sources || cached.output?.sources || [],
        run: cached,
      });
    }

    api.getRun(runId)
      .then(async (r) => {
        if (!alive || !r?.run) return;
        const runData = r.run;
        writePageCache(`templateRun_${runId}`, runData);
        setActiveKey(runData.template_key);
        setValues(runData.input || {});
        setResult({
          output: runData.output || {},
          summary: runData.output_summary || runData.output?.summary || null,
          talking_points: runData.output?.talking_points || null,
          sources: runData.sources || runData.output?.sources || [],
          run: runData,
        });
      })
      .catch((e) => {
        if (alive && !cached) setLoadError(e.message);
      });
    return () => { alive = false; };
  }, [runId]);

  useEffect(() => {
    if (!activeKey) return;
    let alive = true;
    api.getTemplate(activeKey)
      .then((r) => {
        if (!alive) return;
        if (!r?.template) {
          throw new Error("This template couldn't be loaded right now. Please try again in a moment.");
        }
        setTemplate(r.template);
        setDegraded(r.degraded === true);
        api.estimateRun(activeKey, {})
          .then((e) => { if (alive) setBudget({ allowance: e.allowance, spent: e.spentThisMonth || 0 }); })
          .catch(() => {});
        setValues((prev) => {
          const seed = { ...prev };
          for (const f of r.template.input_schema?.fields || []) {
            if (f.default !== undefined && seed[f.name] === undefined) seed[f.name] = f.default;
          }
          return seed;
        });
      })
      .catch((e) => { if (alive) setLoadError(e.message); });
    return () => { alive = false; };
  }, [activeKey]);

  // The estimate updates as the user types, so the cost is never a surprise
  // revealed at the moment of commitment.
  const estimate = useMemo(() => {
    if (!template) return null;
    const v = validateInput(template, values);
    return estimateCredits(template, v.ok ? v.value : values);
  }, [template, values]);

  async function run() {
    if (!template) return;
    // Hand off before spending anything: no credits, no run row, no partial
    // report. The user lands on the real module with their domain prefilled.
    const handoff = HANDOFF[template.template_key];
    if (handoff) {
      navigate(handoff.to, { state: handoff.state(values) });
      return;
    }
    const v = validateInput(template, values);
    if (!v.ok) { setErrors(v.errors); return; }

    // CLIENT MIRROR of the server's affordability check. The server remains
    // authoritative — a client gate alone is trivially bypassed by POSTing
    // directly, which is why templates.js refuses independently — but showing
    // the shortfall here means the user learns it without a round trip, and
    // without a run row being created and immediately refused.
    const needed = estimate?.credits ?? estimate?.total ?? 0;
    if (budget && Number.isFinite(budget.allowance)) {
      // The SAME pure checkAllowance the server calls, so the two verdicts are
      // computed by one implementation and cannot drift.
      const afford = checkAllowance({ spent: budget.spent, allowance: budget.allowance, estimated: needed });
      if (!afford.ok) {
        setErrors([
          `This run needs ${needed} credits and you have ${afford.remaining} left this month. ` +
          `Upgrade your plan, or wait for your allowance to reset.`,
        ]);
        return;
      }
    }
    setErrors([]);
    setBusy(true);
    setResult(null);
    setProgress({ message: "Starting…", percent: 5 });
    // Report through the SAME dock as a single extraction and a batch run, so
    // the product has one progress surface rather than three. The in-page bar
    // stays for the user who is watching this page; the dock is what they see
    // once they navigate away.
    const tplToken = tplRun?.startTemplateRun(template.template_key, template.title);

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
        onProgress: (p) => {
          setProgress(p);
          tplRun?.updateTemplateRun(tplToken, { message: p.message, percent: p.percent });
        },
      });

      if (runId) {
        const done = await api.finishRun(runId, exec);
        setResult({ ...exec, run: done.run, reconciliation: done.reconciliation });
        // PQL: "used a persona template" (+10) and, via templateKey, the
        // per-persona activation condition. Fire-and-forget — analytics must
        // never be able to fail a run the user already paid credits for.
        void lifecycle.templateRunCompleted({ templateKey: template.template_key });
        if (done.reconciliation?.needsDisclosure) {
          showToast(`This run used ${done.charged} credits — more than the ${done.run.credits_estimated} we estimated.`);
        }
        if (done.run?.id) {
          writePageCache(`templateRun_${done.run.id}`, done.run);
        }
      } else {
        setResult(exec);
        if (runId && exec) {
          writePageCache(`templateRun_${runId}`, { ...exec, id: runId, template_key: template.template_key, input: values });
        }
        // Same event on the path where reconciliation did not happen: the
        // user still completed a template run, and scoring must not depend on
        // an accounting detail they never see.
        void lifecycle.templateRunCompleted({ templateKey: template.template_key });
      }
      setProgress(null);
      // Hand the dock the run id so "View report" can reopen it after the user
      // has navigated away — the whole point of surviving navigation.
      tplRun?.finishTemplateRun(tplToken, { runId });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (e) {
      setProgress(null);
      tplRun?.finishTemplateRun(tplToken, { error: e.message });
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
      // PQL: "created a shareable report" (+10), and the activation condition
      // for SEO/VC/agency personas.
      void lifecycle.reportPublished({ templateKey: template.template_key });
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
  const handoff = HANDOFF[template.template_key] || null;

  return (
    <div className="page container tpl-page">
      <button className="tpl-back" onClick={onBack}>
        <Icon name="arrow-up" size={14} /> All templates
      </button>

      <header className="tpl-header">
        <h1>{template.title}</h1>
        <p className="tpl-sub">{template.summary}</p>
      </header>

      {degraded && (
        <div className="card tpl-error" role="status">
          This template is showing in preview only — running it is temporarily unavailable.
          Your inputs and credits are untouched. Please try again shortly.
        </div>
      )}

      {result ? (
        <RunResult
          result={result}
          template={template}
          onShare={makeReport}
          onEditInputs={() => setResult(null)}
        />
      ) : (
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
            <Button onClick={run} disabled={busy || degraded}>
              {handoff ? handoff.label : busy ? "Running…" : "Run this template"}
            </Button>
            {/* A hand-off spends nothing HERE, so showing this template's credit
                estimate beside it would be a straightforward lie about what the
                button does. The module states its own audit cost on arrival. */}
            {handoff ? (
              <span className="tpl-estimate">{handoff.why}</span>
            ) : estimate ? (
              <span className="tpl-estimate" title="Estimated before the run; you are charged for what actually runs.">
                {describeEstimate(estimate)}
              </span>
            ) : null}
          </div>
        </div>
      )}

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
        // Was a bare textarea, so the SINGLE-domain field resolved a typed
        // company name and the MULTI-domain field — the one people paste a CRM
        // export into — did not.
        <DomainListInput id={id} value={value} onChange={onChange} placeholder={field.placeholder} />
      ) : field.kind === "boolean" ? (
        <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      ) : field.kind === "domain" ? (
        <DomainField id={id} field={field} value={value} onChange={onChange} />
      ) : (
        <input id={id} type="text" value={value ?? ""} placeholder={field.placeholder}
               onChange={(e) => onChange(e.target.value)} />
      )}
      {field.help && <p className="tpl-help">{field.help}</p>}
    </div>
  );
}

/**
 * A domain field that also accepts a company NAME.
 *
 * Type "Protean", press Enter or leave the field, and we look up a likely
 * domain and offer it. The field stays FREE TEXT and nothing is applied
 * silently — a wrongly-resolved domain would produce a confident brief about
 * the wrong company, which is worse than no resolution at all.
 *
 * Lookup fires on COMMIT (Enter / blur), never per keystroke: each attempt is
 * a real fetch, and a debounced as-you-type version would spend requests on
 * every partial word the user never finishes.
 */
function DomainField({ id, field, value, onChange }) {
  const [looking, setLooking] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [missed, setMissed] = useState(false);

  const cleanDomain = (v) => {
    let s = String(v || "").trim();
    s = s.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
    return s.toLowerCase();
  };

  const looksLikeDomain = (v) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleanDomain(v));

  async function maybeResolve() {
    const raw = String(value || "").trim();
    // Already a domain/URL, or too short to be a name worth a network call.
    if (!raw || raw.length < 3) { setSuggestion(null); setMissed(false); return; }
    const cleaned = cleanDomain(raw);
    if (looksLikeDomain(raw)) {
      if (raw !== cleaned) onChange(cleaned);
      setSuggestion(null);
      setMissed(false);
      return;
    }
    setLooking(true); setMissed(false);
    try {
      const r = await api.resolveCompany(raw);
      if (r?.best?.domain) setSuggestion(r.best);
      else { setSuggestion(null); setMissed(true); }
    } catch {
      // A failed lookup is not an error the user needs to see — they can type
      // the domain, which is what they would have done anyway.
      setSuggestion(null); setMissed(true);
    } finally {
      setLooking(false);
    }
  }

  return (
    <>
      <div className="tpl-domain-row">
        <input
          id={id} type="text" value={value ?? ""}
          placeholder={field.placeholder || "acme.com — or type the company name"}
          onChange={(e) => { onChange(e.target.value); setSuggestion(null); setMissed(false); }}
          onBlur={maybeResolve}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); maybeResolve(); } }}
        />
        {looking && <span className="tpl-domain-status"><Icon name="loader" size={13} className="spin" /> Looking up…</span>}
      </div>

      {suggestion && (
        <div className="tpl-domain-suggest">
          <Icon name={suggestion.confirmed ? "check-circle" : "alert-circle"} size={13} />
          <span>
            {suggestion.confirmed ? "Found" : "Best guess"}:{" "}
            <strong>{suggestion.domain}</strong>
            {suggestion.title ? <em> — {suggestion.title}</em> : null}
          </span>
          {/* Applied only on an explicit click. The whole point of resolving is
              to save typing, not to decide for the user which company they
              meant. */}
          <button type="button" onClick={() => { onChange(suggestion.domain); setSuggestion(null); }}>
            Use this
          </button>
          <button type="button" className="tpl-domain-dismiss" onClick={() => setSuggestion(null)}>Ignore</button>
        </div>
      )}

      {missed && (
        <p className="tpl-help">
          Couldn’t find a domain for that name — type it directly (for example <code>acme.com</code>).
        </p>
      )}
    </>
  );
}

/** "case_studies" → "Case studies". Column headers come from schema keys. */
function humanKey(k) {
  const t = String(k).replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Resolve a block's `from:` against the run output.
 *
 * Two places a key can live, and both are legitimate:
 *   - `output.<from>`        — written by a synthesis prompt (talking_points, questions)
 *   - `output.fields.<from>` — a field of the structured extraction (case_studies, tiers)
 *
 * A block with no `from:` keeps the old behaviour and shows talking points, so
 * templates written before `from:` was honoured do not go blank.
 */
function resolveBlockData(result, block) {
  const out = result?.output || {};
  if (!block.from) return result?.talking_points || out.talking_points || null;
  const direct = out[block.from];
  if (direct != null) return Array.isArray(direct) ? direct : [direct];
  const field = out.fields?.[block.from];
  if (field == null) return null;
  return Array.isArray(field) ? field : [field];
}

function RunResult({ result, template, onShare, onEditInputs }) {
  const blocks = template.output_schema?.blocks || [];
  const talkingPoints = result.talking_points || result.output?.talking_points || null;
  return (
    <div className="card tpl-result">
      <div className="tpl-result-head">
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <h2>Result</h2>
          {onEditInputs && (
            <Button variant="secondary" size="sm" onClick={onEditInputs}>
              <Icon name="edit" size={14} /> Edit inputs / Run again
            </Button>
          )}
        </div>
        {/* Every template run is a deliverable someone forwards. Until now the
            only way out of this screen was a shareable link — no CSV, no PDF,
            nothing to paste into a deck. Same menu as Dashboard and Preview,
            fed through the run→item adapter so a template export is the same
            machinery, Brand Kit and all. */}
        <ExportMenu
          items={[runToItem(result)].filter(Boolean)}
          label="Export"
          buttonVariant="secondary"
          onShare={onShare}
          shareLabel="Create shareable report"
        />
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

      {/* ── EVERY list AND table BLOCK, EACH RESOLVING ITS OWN `from:` ────────
          Previously this rendered ONE list, took its TITLE from the first
          `list` block in the schema, and filled it from `talking_points`
          regardless of what that block's `from:` said — and no `table` branch
          existed at all. So a Due Diligence Brief showed the heading
          "Questions worth asking" over talking points it had no prompt for,
          and Customer Proof's `{kind:"table", from:"case_studies"}` and
          Competitor Pricing's `{from:"tiers"}` could never render on ANY site.
          A block whose title is honoured but whose source is ignored is worse
          than an unrendered one: it puts a promise on screen and fills it with
          something else. */}
      {blocks.filter((b) => b.kind === "list" || b.kind === "table").map((b, bi) => {
        const rows = resolveBlockData(result, b);
        if (!Array.isArray(rows) || rows.length === 0) return null;
        if (b.kind === "list") {
          return (
            <section className="tpl-block" key={`lst-${bi}`}>
              <h3>{b.title || "Talking points"}</h3>
              <ol className="tpl-points">
                {rows.map((p, i) => <li key={i}>{typeof p === "string" ? p : JSON.stringify(p)}</li>)}
              </ol>
              <p className="tpl-ai-note">Written by AI from the extracted facts below.</p>
            </section>
          );
        }
        const cols = b.columns && b.columns.length
          ? b.columns
          : [...new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r) : [])))];
        return (
          <section className="tpl-block" key={`tbl-${bi}`}>
            <h3>{b.title || "Details"}</h3>
            <div className="tpl-cmp-wrap">
              <table className="tpl-cmp">
                <thead>
                  <tr>{cols.map((c) => <th key={c}>{humanKey(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {cols.map((c) => {
                        const v = r && typeof r === "object" ? r[c] : (c === cols[0] ? r : null);
                        // A blank cell is a FINDING — "they don't say" — not a
                        // rendering gap, so it is labelled rather than empty.
                        return <td key={c}>{v == null || v === "" ? <span className="tpl-cell-none">not stated</span> : String(v)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {/* The comparison grid — rows are companies, columns are the axes they
          were compared on. A blank cell here is a FINDING ("they don't say"),
          not a rendering gap, which is why it reads "not stated" rather than
          being left empty. */}
      {result.output?.comparison?.rows?.length ? (
        <section className="tpl-block">
          <h3>{blocks.find((b) => b.kind === "comparison")?.title || "Side by side"}</h3>
          <div className="tpl-cmp-wrap">
            <table className="tpl-cmp">
              <thead>
                <tr>
                  <th>Company</th>
                  {(result.output.comparison.axes || []).map((a) => <th key={a}>{a}</th>)}
                </tr>
              </thead>
              <tbody>
                {result.output.comparison.rows.map((row, i) => (
                  <tr key={i} className={row.company === result.output.target ? "tpl-cmp-self" : ""}>
                    <th scope="row">
                      {row.company}
                      {row.company === result.output.target ? <span className="tpl-cmp-you">you</span> : null}
                    </th>
                    {(result.output.comparison.axes || []).map((a) => {
                      const v = row.values?.[a];
                      return <td key={a}>{v == null || v === "" ? <em className="tpl-cmp-null">not stated</em> : String(v)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.output.unread?.length ? (
            <p className="tpl-ai-note">
              Not read, so absent from this comparison: {result.output.unread.join(", ")}.
            </p>
          ) : null}
        </section>
      ) : null}

      {result.output?.fields && (
        <section className="tpl-block">
          <h3>{blocks.find((b) => b.kind === "fields")?.title || "Extracted facts"}</h3>
          {/* Grouped, tabulated and evidence-backed — not a JSON dump. The
              groups come from the capability schema when the template maps to
              one; otherwise StructuredFacts infers sections from the keys. */}
          <StructuredFacts
            data={result.output.fields}
            groups={CAPABILITY_SCHEMAS[template.template_key]?.groups}
            meta={result.output.extraction}
            title={result.output.title}
          />
        </section>
      )}

      {/* Two different answers, and only one of them is our fault. Saying
          "we could not produce it" when the truth is "they do not publish it"
          reports a successful run as a failure — and contradicts the report
          immediately above, which says so in plain words. */}
      {/* ── "WE FOUND NOTHING" IS ONLY A CREDIBLE FINDING IF WE SAY WHAT WE
             LOOKED FOR ─────────────────────────────────────────────────────
          A bare "this site doesn't publish it" asks the reader to take our
          word for both the search and the conclusion. Naming the fields we
          searched for — beside the Sources list that names the pages we read —
          turns an assertion into something they can check and disagree with,
          and it is the difference between a null result and a useless one. */}
      {result.informationAbsent && !result.partial ? (
        <div className="tpl-finding">
          <p>
            <Icon name="info" size={14} />
            This site doesn’t publish the information this template looks for — that itself is the
            finding. Everything below was read from the pages listed under Sources.
          </p>
          {(template.extraction_schema?.fields || []).length ? (
            <>
              <p className="tpl-finding-sub">Searched for, and not stated anywhere we could read:</p>
              <ul className="tpl-looked-for">
                {template.extraction_schema.fields.map((f) => (
                  <li key={f.name}>{humanKey(f.name)}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {result.partial ? (
        <p className="tpl-partial">
          <Icon name="alert-circle" size={14} />
          This run is incomplete — some of what this template promises could not be
          produced from the pages we could read. Treat it as a starting point, not a finished brief.
        </p>
      ) : null}

      <section className="tpl-block">
        <h3>Sources</h3>
        <ul className="tpl-sources">
          {(result.sources || []).map((s, i) => (
            <li key={i}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a>
              {/* The SCRAPE vendor (Firecrawl / Spider / Jina / direct) was
                  rendered here as "· via firecrawl". Same boundary as the AI
                  provider: which vendor fetched the page is our infrastructure
                  choice, changes per request as the fallback chain walks, and
                  a customer can act on none of it. The timestamp stays — it is
                  a fact about THEIR page and it is what makes the source
                  verifiable. */}
              <span className="tpl-src-meta">
                {s.fetched_at ? ` · read ${new Date(s.fetched_at).toLocaleString()}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
