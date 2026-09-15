// auditReport.js — the exportable report.
//
// PURE. Markdown, JSON and CSV renderings of an audit, generated from the same
// payload the dashboard renders, so an exported report and the screen it was
// exported from can never disagree.
//
// ── WHAT THE REPORT PROMISES, AND WHAT IT MUST NOT ─────────────────────────
// It reports what was measured, what that means, and what to do. It does not
// promise rankings, citations or traffic — those are explicit non-goals, and a
// report that implies them is the one artefact a customer will forward to their
// own client. Coverage is printed beside every headline score for the same
// reason: a 92 built on 40% of the evidence is not a 92, and the person reading
// the PDF three weeks later has no other way to know.

import { PILLAR_IDS, pillarLabel, signalLabel } from "./signalRegistry.js";
import { FRAMEWORKS, scoreBand, PENALTIES } from "./scoringModel.js";
import { SEVERITIES } from "./issueCatalog.js";
import { groupByRootCause } from "./gapTaxonomy.js";
import {
  buildBrandingContext, brandingMarkdownFooter, brandingCsvHeaderRows, brandingCsvFooterRows, brandingJsonMeta,
} from "../exportBranding.js";

const DISCOVERABILITY_DISCLAIMER =
  "Scores describe how discoverable and extractable this page is today. They are not a prediction of rankings, citations or traffic.";

const fmt = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "not measured" : String(n));
const pct = (n) => (Number.isFinite(Number(n)) ? `${n}%` : "unknown");

function scoreLine(label, score, coverage) {
  const band = scoreBand(score);
  const cov = Number.isFinite(Number(coverage)) && coverage < 100 ? ` _(based on ${pct(coverage)} of signals)_` : "";
  return `| ${label} | **${fmt(score)}** | ${band.label} |${cov ? ` ${cov.trim()}` : ""} |`;
}

/**
 * A complete markdown report.
 *
 * Ordered summary → evidence → actions, matching the dashboard, so somebody who
 * has seen the screen can find the same fact in the same place in the document.
 */
export function buildMarkdownReport(audit, options = {}) {
  if (!audit) return "";
  const { includeEvidence = true, includeConstructs = false, brandKit = null, diff = null } = options;
  const t = audit.target || {};
  const url = t.url || audit.url || "Unknown URL";
  const ctx = buildBrandingContext({
    kind: "discoverability",
    sourceUrls: url,
    generatedAt: audit.meta?.startedAt || new Date().toISOString(),
    brandKit,
  });
  const out = [];

  out.push(`# ${ctx.brand} Discoverability Audit`);
  out.push("");
  out.push(`**${url}**`);
  out.push("");
  out.push(`| | |`);
  out.push(`|---|---|`);
  out.push(`| Prepared by | ${ctx.brand} (${ctx.website || "https://datiq.app"}) |`);
  out.push(`| Audited | ${audit.meta?.startedAt ? new Date(audit.meta.startedAt).toISOString() : "—"} |`);
  out.push(`| Page type | ${t.page_type_label || t.page_type || "—"} |`);
  out.push(`| Device profile | ${t.device_profile || "mobile"} |`);
  out.push(`| Audit profile | ${t.audit_profile || "balanced"} |`);
  out.push(`| Evidence coverage | ${pct(audit.coverage)} |`);
  out.push("");

  // ── scores ───────────────────────────────────────────────────────────────
  out.push(`## Scores`);
  out.push("");
  out.push(`| View | Score | Band | |`);
  out.push(`|---|---|---|---|`);
  out.push(scoreLine("Overall", audit.finalScore, audit.coverage));
  out.push(scoreLine("SEO", audit.seoScore, audit.frameworks?.seo?.coverage));
  out.push(scoreLine("AEO (answer engines)", audit.aeoScore, audit.frameworks?.aeo?.coverage));
  out.push(scoreLine("GEO (generative engines)", audit.geoScore, audit.frameworks?.geo?.coverage));
  out.push("");

  if ((audit.penalties || []).length > 0) {
    out.push(`### Blocking issues`);
    out.push("");
    out.push(`These scale the whole score down, because they undermine discovery regardless of content quality. The score before them was **${fmt(audit.scoreMath?.prePenaltyTotal)}**.`);
    out.push("");
    for (const p of audit.penalties) {
      // Same fallback rule as the signal labels: degrade to the code, never
      // to `undefined`. A penalty read back from a stored engine_json written
      // by an older build may not carry one.
      out.push(`- **${p.label || PENALTIES[p.code]?.label || p.code}** (−${Math.round(p.factor * 100)}%) — ${p.description || ""}`);
    }
    out.push("");
  }

  // ── pillars ──────────────────────────────────────────────────────────────
  out.push(`## Pillars`);
  out.push("");
  // At-a-glance summary in TWO COLUMNS, mirroring the on-screen 2x2 pillar
  // grid and the PDF: Answer Clarity | Entity Authority, then Structural
  // Hierarchy | Technical Accessibility. The per-pillar signal tables follow.
  const presentPillars = PILLAR_IDS.filter((id) => audit.pillars?.[id]);
  if (presentPillars.length) {
    const cellFor = (id) => (id
      ? [`**${pillarLabel(id)}**`, `${fmt(audit.pillars[id].score)}`]
      : ["", ""]);
    out.push(`| Pillar | Score | Pillar | Score |`);
    out.push(`|---|---|---|---|`);
    for (let i = 0; i < presentPillars.length; i += 2) {
      out.push(`| ${[...cellFor(presentPillars[i]), ...cellFor(presentPillars[i + 1])].join(" | ")} |`);
    }
    out.push("");
  }
  for (const id of PILLAR_IDS) {
    const p = audit.pillars?.[id];
    if (!p) continue;
    out.push(`### ${pillarLabel(id)} — ${fmt(p.score)}`);
    out.push("");
    out.push(`| Signal | Score | Weight | |`);
    out.push(`|---|---|---|---|`);
    for (const s of p.signals || []) {
      const note = s.measured ? "" : (s.applicable === false ? "not applicable to this page type" : "not measured");
      // Fall back to the code, never to `undefined`. A stored audit whose
      // rehydrator forgot the label once printed "| undefined | 0 | 25% |"
      // for every signal in a report that gets forwarded to clients.
      out.push(`| ${s.label || signalLabel(s.code) || s.code} | ${fmt(s.score)} | ${Math.round(s.weight * 100)}% | ${note} |`);
    }
    out.push("");
  }

  // ── executive summary ────────────────────────────────────────────────────
  // Placed after the scores and before the findings: a reader who stops here
  // should still know what the report concluded. Rendered as a blockquote so it
  // is visibly editorial — the numbers above it are measured, this is written.
  if (audit.summary) {
    out.push(`## Summary`);
    out.push("");
    out.push(`> ${String(audit.summary).replace(/\n+/g, " ").trim()}`);
    out.push("");
  }

  // ── issues ───────────────────────────────────────────────────────────────
  const issues = audit.issues || [];

  // ── THE DIAGNOSIS COMES BEFORE THE LIST ────────────────────────────────
  // Forty individually-true findings is a list, not a diagnosis, and the
  // reader's actual question is "what is wrong with this page". Grouping by
  // severity — which is all this section used to do — answers "what is worst"
  // instead, and eleven findings that all reduce to one afternoon's work still
  // read as eleven problems.
  const causeGroups = groupByRootCause(issues, {
    severityRank: (i) => SEVERITIES.indexOf(i.severity),
  });
  if (causeGroups.length > 0) {
    out.push(`## What is actually wrong`);
    out.push("");
    for (const g of causeGroups) {
      out.push(`- **${g.label}** (${g.count}) — ${g.description}`);
      out.push(`  ${g.issues.map((i) => i.code).join(", ")}`);
    }
    out.push("");
  }

  out.push(`## Issues (${issues.length})`);
  out.push("");
  if (issues.length === 0) {
    out.push("_No issues found._");
    out.push("");
  } else {
    for (const sev of SEVERITIES) {
      const group = issues.filter((i) => i.severity === sev);
      if (group.length === 0) continue;
      out.push(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${group.length})`);
      out.push("");
      for (const i of group) {
        out.push(`- **${i.code} — ${i.title}**`);
        // ── Observed and inferred, LABELLED ────────────────────────────
        // They have different warranties, and an unlabelled paragraph gives
        // the reasoned half the authority of the measured half. The labels
        // are the whole fix — a reader who disagrees with "this dilutes the
        // topical signal" can now see that it is our reasoning and not our
        // reading.
        const observed = i.observed || i.evidence;
        if (observed) out.push(`  **Observed:** ${observed}`);
        if (i.inference) out.push(`  **Why it matters:** ${i.inference}`);
        out.push(`  _Affects: ${(i.frameworks || []).join(", ").toUpperCase() || "—"}_`);
        if (i.owner) out.push(`  _Owner: ${i.owner}_`);
      }
      out.push("");
    }
  }

  // ── recommendations ──────────────────────────────────────────────────────
  const recs = audit.recommendations || [];
  out.push(`## What to do next`);
  out.push("");
  if (recs.length === 0) {
    out.push("_Nothing outstanding._");
  } else {
    if (Number.isFinite(audit.estimatedTotalLift) && audit.estimatedTotalLift > 0) {
      // "Up to", always. Signals interact and the penalty layer moves
      // separately, so this is an estimate and the wording has to say so.
      out.push(`Implementing everything below is estimated to recover up to **${audit.estimatedTotalLift} points**. Signals interact, so treat this as an upper bound rather than a forecast.`);
      out.push("");
    }
    out.push(`| # | Fix | Owner | Priority | Est. lift | Frameworks |`);
    out.push(`|---|---|---|---|---|---|`);
    recs.forEach((r, idx) => {
      out.push(`| ${idx + 1} | ${r.title} | ${r.owner || r.owner_role || "—"} | ${r.priority} | ${r.estimatedLift ?? r.estimated_lift ?? "—"} | ${(r.frameworks || []).join(", ").toUpperCase()} |`);
    });
    out.push("");

    for (const r of recs) {
      out.push(`### ${r.code} — ${r.title}`);
      out.push("");
      if (r.rationale) { out.push(r.rationale); out.push(""); }
      if (r.evidence) { out.push(`**What we saw:** ${r.evidence}`); out.push(""); }
      const asset = r.implementationAsset || r.implementation_asset_json;
      if (includeConstructs && asset?.body) {
        out.push(`**Ready to paste — ${asset.label}:**`);
        if (asset.note) { out.push(""); out.push(`> ${asset.note}`); }
        out.push("");
        out.push("```" + (asset.format === "markdown" ? "markdown" : asset.format === "html" ? "html" : ""));
        out.push(asset.body);
        out.push("```");
        out.push("");
      }
    }
  }

  // ── evidence ─────────────────────────────────────────────────────────────
  if (includeEvidence) {
    out.push(`## Evidence`);
    out.push("");
    const tech = audit.facts?.technical || {};
    out.push(`### Technical`);
    out.push("");
    out.push(`| | |`);
    out.push(`|---|---|`);
    out.push(`| HTTP status | ${tech.http_status ?? "—"} |`);
    out.push(`| Indexable | ${tech.indexable === undefined ? "—" : tech.indexable ? "yes" : "no"} |`);
    out.push(`| Canonical | ${tech.canonical_url || "not declared"} |`);
    const cwv = tech.core_web_vitals;
    out.push(`| LCP | ${cwv?.lcp_seconds != null ? `${cwv.lcp_seconds}s` : "not measured"} |`);
    out.push(`| INP | ${cwv?.inp_ms != null ? `${cwv.inp_ms}ms` : "not measured"} |`);
    out.push(`| CLS | ${cwv?.cls != null ? cwv.cls : "not measured"} |`);
    const r = tech.rendering || {};
    out.push(`| Raw / rendered words | ${r.raw_html_word_count ?? "—"} / ${r.rendered_dom_word_count ?? "not measured"} |`);
    out.push("");

    const access = tech.ai_crawler_access;
    if (access) {
      out.push(`### Answer-engine crawler access`);
      out.push("");
      for (const [agent, allowed] of Object.entries(access)) {
        out.push(`- ${agent}: ${allowed === null ? "unknown" : allowed ? "allowed" : "**blocked**"}`);
      }
      out.push("");
    }

    const outline = audit.evidence?.heading_outline || [];
    if (outline.length) {
      out.push(`### Heading outline`);
      out.push("");
      out.push("```");
      for (const h of outline) out.push(`${"  ".repeat(Math.max(0, h.level - 1))}H${h.level} ${h.text || "(empty)"}`);
      out.push("```");
      out.push("");
    }

    const entity = audit.facts?.entity || {};
    const sample = entity.ai_citation_sample;
    if (sample) {
      out.push(`### Citation footprint`);
      out.push("");
      out.push(`Sampled with **${sample.engine}** across ${sample.prompt_count} prompts: ${sample.mentions} mention${sample.mentions === 1 ? "" : "s"}, ${sample.citations} citation${sample.citations === 1 ? "" : "s"}.`);
      if (!sample.live) {
        // The single most important caveat in the whole report.
        out.push("");
        out.push(`> These samples come from a language model's recall rather than a live answer engine with web retrieval. They indicate how well known the brand is, not whether it is being cited in live answers today.`);
      }
      out.push("");
    }
  }

  // ── comparison ───────────────────────────────────────────────────────────
  if (diff) {
    out.push(`## Change since the last audit`);
    out.push("");
    out.push(diff.headline);
    out.push("");
    out.push(`| View | Before | After | Change |`);
    out.push(`|---|---|---|---|`);
    for (const f of FRAMEWORKS) {
      const d = diff.frameworks?.[f];
      if (!d) continue;
      out.push(`| ${f.toUpperCase()} | ${fmt(d.before)} | ${fmt(d.after)} | ${d.comparable ? (d.change > 0 ? `+${d.change}` : d.change) : d.reason} |`);
    }
    out.push("");
    if (diff.issues.resolved.length) {
      out.push(`**Resolved:** ${diff.issues.resolved.map((i) => i.code).join(", ")}`);
      out.push("");
    }
    if (diff.issues.introduced.length) {
      out.push(`**New since the baseline:** ${diff.issues.introduced.map((i) => i.code).join(", ")}`);
      out.push("");
    }
    for (const c of diff.caveats || []) { out.push(`> ${c}`); out.push(""); }
  }

  out.push(brandingMarkdownFooter(ctx, [DISCOVERABILITY_DISCLAIMER]));
  return out.join("\n");
}

/** Issues as CSV, for a spreadsheet remediation tracker. */
export function issuesToCsv(audit) {
  // `evidence` keeps its column and its position — an existing consumer's
  // header offsets do not move — and the new fields are APPENDED. `observed`
  // duplicates `evidence` on a current audit and is still worth its own
  // column: it is the one a reader can sort beside `inference` to see which
  // claims are measured and which are reasoned.
  const rows = [[
    "code", "severity", "pillar", "frameworks", "title", "evidence",
    "observed", "inference", "root_cause", "recommended_module", "owner", "status",
  ]];
  for (const i of audit?.issues || []) {
    rows.push([
      i.code, i.severity, i.pillar, (i.frameworks || []).join(" "), i.title, i.evidence || "",
      i.observed || i.evidence || "", i.inference || "",
      i.rootCause || i.root_cause || "", i.module || i.recommended_module || "",
      i.owner || i.owner_role || "", i.status || "open",
    ]);
  }
  return toCsv(rows);
}

/** The recommendation queue as CSV — the export a delivery team actually works from. */
export function recommendationsToCsv(audit) {
  const rows = [["code", "priority", "priority_score", "owner", "title", "estimated_lift", "effort", "confidence", "frameworks", "status", "issue_id"]];
  for (const r of audit?.recommendations || []) {
    rows.push([
      r.code, r.priority, r.priorityScore ?? r.priority_score ?? "",
      r.owner || r.owner_role || "", r.title,
      r.estimatedLift ?? r.estimated_lift ?? "",
      r.effortScore ?? r.effort_score ?? "",
      r.confidenceScore ?? r.confidence_score ?? "",
      (r.frameworks || []).join(" "), r.status || "open",
      // Null on every recommendation written before W4 — the column existed
      // and nothing populated it — which is what "this task predates the
      // link" looks like, not an error.
      r.issueId ?? r.issue_id ?? "",
    ]);
  }
  return toCsv(rows);
}

/**
 * Every signal, with its pillar, weight and measured state.
 *
 * The scores CSV and this one exist because "export the report as CSV" used to
 * mean "export EITHER the issues OR the recommendations, chosen by a query
 * parameter nobody sees" — so the pillar arithmetic, which is the part a
 * spreadsheet is actually good at, was the one thing you could not get out.
 */
export function signalsToCsv(audit) {
  const rows = [["pillar", "pillar_score", "signal_code", "signal", "weight_pct", "score", "state"]];
  for (const id of PILLAR_IDS) {
    const p = audit?.pillars?.[id];
    if (!p) continue;
    for (const s of p.signals || []) {
      rows.push([
        pillarLabel(id),
        p.score ?? "",
        s.code,
        s.label || signalLabel(s.code) || s.code,
        Math.round((s.weight || 0) * 100),
        // Deliberately BLANK, never 0, for an unmeasured signal. A 0 in a
        // spreadsheet gets averaged; a blank does not. That distinction is the
        // whole coverage model, and it has to survive the export.
        s.measured ? (s.score ?? "") : "",
        s.measured ? "measured" : (s.applicable === false ? "not_applicable" : "not_measured"),
      ]);
    }
  }
  return toCsv(rows);
}

/** The score summary: four framework views plus the four pillars. */
export function scoresToCsv(audit) {
  const rows = [["view", "kind", "score", "coverage_pct", "weight_pct"]];
  for (const f of FRAMEWORKS) {
    rows.push([
      f, "framework",
      audit?.frameworks?.[f]?.score ?? "",
      audit?.frameworks?.[f]?.coverage ?? audit?.coverage ?? "",
      "",
    ]);
  }
  for (const id of PILLAR_IDS) {
    const p = audit?.pillars?.[id];
    if (!p) continue;
    rows.push([pillarLabel(id), "pillar", p.score ?? "", p.coverage ?? "", Math.round((p.weight || 0) * 100)]);
  }
  return toCsv(rows);
}

/**
 * Every section in one file.
 *
 * CSV has no notion of sections, so this stacks them with a blank line and a
 * `# name` marker between — the convention spreadsheet users already expect and
 * every importer tolerates. It exists because the single commonest thing anyone
 * wants is "the whole report", and making them download four files to get it is
 * how a report ends up forwarded incomplete.
 */
export function bundleToCsv(audit) {
  return [
    "# scores", scoresToCsv(audit),
    "# signals", signalsToCsv(audit),
    "# issues", issuesToCsv(audit),
    "# recommendations", recommendationsToCsv(audit),
  ].join("\n");
}

/**
 * Wrap an already-built CSV string (any of the functions above, or
 * bundleToCsv) with leading/trailing "#"-prefixed branding comment rows —
 * see exportBranding.js. Deliberately NOT baked into the individual CSV
 * builders themselves: they're composable, pure data-shape functions used
 * both standalone and stacked by bundleToCsv, and a caller expecting
 * `csv.split("\n")[0]` to be the real header row would break if branding
 * were mixed in there. This wraps at the actual export boundary instead
 * (see reportRoute in netlify/functions/discoverability.js).
 */
export function brandCsv(csv, audit, { title = "Discoverability Report", generatedAt = null, brandKit = null } = {}) {
  const ctx = buildBrandingContext({
    kind: "discoverability",
    title,
    sourceUrls: audit?.target?.url || audit?.url || null,
    generatedAt: generatedAt || audit?.meta?.startedAt || new Date().toISOString(),
    brandKit,
  });
  return [...brandingCsvHeaderRows(ctx), csv, ...brandingCsvFooterRows(ctx)].join("\n");
}

function toCsv(rows) {
  return rows
    .map((r) => r.map((cell) => {
      const s = String(cell ?? "");
      // Quote if the cell contains a delimiter, a quote or a newline. A leading
      // =, +, - or @ is prefixed with a quote so spreadsheet software does not
      // execute it as a formula — the evidence strings here come from arbitrary
      // third-party pages.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    }).join(","))
    .join("\n");
}

/** The machine-readable payload, matching the documented JSON schema.
 *  `export` is an ADDITIVE metadata block (never removes/renames an
 *  existing key — those are the public contract) carrying the same
 *  tool/generatedAt/source/poweredBy shape every other format's JSON
 *  envelope now carries, see exportBranding.js. */
export function toJsonPayload(audit, { generatedAt = null, brandKit = null } = {}) {
  if (!audit) return null;
  const ctx = buildBrandingContext({
    kind: "discoverability",
    sourceUrls: audit.target?.url || audit.url || null,
    generatedAt: generatedAt || audit.meta?.startedAt || new Date().toISOString(),
    brandKit,
  });
  return {
    export: brandingJsonMeta(ctx),
    audit_id: audit.auditId || audit.id || null,
    timestamp: audit.meta?.startedAt ? new Date(audit.meta.startedAt).toISOString() : null,
    target: audit.target || null,
    // What this audit was COMMISSIONED to do, beside what it measured. A
    // consumer diffing two exports needs to know the two were asked the same
    // question before it reads the delta as page movement. Null on every audit
    // that predates migration 0049 — the question was not asked, and a
    // placeholder would claim an intent nobody stated.
    intake: audit.intake || null,
    framework_scores: {
      overall: audit.finalScore, seo: audit.seoScore, aeo: audit.aeoScore, geo: audit.geoScore,
    },
    coverage: audit.coverage,
    summary: audit.summary || null,
    summary_model: audit.summaryModel || null,
    pillar_scores: Object.fromEntries(
      PILLAR_IDS.map((p) => [p, {
        score: audit.pillars?.[p]?.score ?? null,
        weight: audit.pillars?.[p]?.weight ?? null,
        coverage: audit.pillars?.[p]?.coverage ?? null,
        // Kept as `{code: score}` — it is a PUBLIC CONTRACT and consumers index
        // it directly. The richer per-signal view is a SIBLING key below rather
        // than a change of shape here, so an existing integration keeps working.
        signals: Object.fromEntries((audit.pillars?.[p]?.signals || []).map((s) => [s.code, s.score])),
      }]),
    ),
    // Added alongside pillar_scores, not inside it. `signals` above cannot say
    // whether a null means "could not measure" or "does not apply to this page
    // type", and collapsing those two is the one thing the whole scoring model
    // exists to avoid.
    signal_detail: PILLAR_IDS.flatMap((p) =>
      (audit.pillars?.[p]?.signals || []).map((s) => ({
        pillar: p,
        code: s.code,
        label: s.label || signalLabel(s.code) || s.code,
        weight: s.weight ?? null,
        score: s.measured ? (s.score ?? null) : null,
        measured: Boolean(s.measured),
        applicable: s.applicable !== false,
        unknown_reason: s.measured ? null : (s.unknownReason || "not_measured"),
        // ── the workings ──────────────────────────────────────────────────
        // The BRD requires every score to store its calculation components,
        // raw value, threshold, evidence and model version. A JSON export that
        // carries the number but not the provenance is exactly the archive a
        // customer cannot use to challenge a finding six months later, which is
        // the one moment the evidence matters most.
        raw_value: s.rawValue ?? null,
        thresholds: s.thresholds ?? null,
        confidence: s.confidence ?? null,
        evidence: s.evidence || [],
      })),
    ),
    bands: Object.fromEntries(
      FRAMEWORKS.map((f) => [f, scoreBand(audit.frameworks?.[f]?.score ?? null).label]),
    ),
    penalties: (audit.penalties || []).map((p) => ({
      code: p.code, severity: p.severity, penalty_factor: p.factor, description: p.description,
    })),
    technical_facts: audit.facts?.technical || {},
    content_facts: audit.facts?.content || {},
    entity_facts: audit.facts?.entity || {},
    // `evidence` stays the human sentence every existing consumer already reads;
    // `evidence_records` is the structured provenance beside it. Added as a new
    // key rather than a change of shape, for the same reason `signal_detail`
    // sits beside `pillar_scores.signals` — an existing integration keeps working.
    issues: (audit.issues || []).map((i) => ({
      ...i,
      evidence_records: i.evidenceRecords || i.evidence_records || [],
    })),
    recommendations: audit.recommendations || [],
    // Everything the on-screen report shows that the payload used to omit. The
    // JSON export is what an API consumer archives, so a section visible in the
    // UI but absent here means their archive is not the report they read.
    evidence: {
      heading_outline: audit.evidence?.heading_outline || [],
      direct_answer_blocks: audit.evidence?.direct_answer_blocks || [],
      faq_pairs: audit.evidence?.faq_pairs || [],
      schema_types: audit.evidence?.schema_types || [],
      ai_notes: audit.evidence?.ai_notes || null,
    },
    // The copy-ready assets, carried as data rather than as prose. `body` is the
    // field every template emits — see constructTemplates.js.
    implementation_assets: (audit.recommendations || [])
      .filter((r) => r.implementationAsset?.body)
      .map((r) => ({
        code: r.code,
        label: r.implementationAsset.label || null,
        format: r.implementationAsset.format || null,
        body: r.implementationAsset.body,
        has_placeholders: /TODO:/.test(r.implementationAsset.body),
      })),
    prompt_runs: (audit.promptRuns || []).map((run) => ({
      engine: run.engine_name ?? run.engine ?? null,
      live: run.live ?? null,
      prompt: run.prompt ?? null,
      mention_detected: run.mention_detected ?? null,
      citation_detected: run.citation_detected ?? null,
      cited_domains: run.cited_domains_json || [],
      sentiment_score: run.sentiment_score ?? null,
    })),
    score_math: audit.scoreMath || null,
    // Which maths produced every number above. A consumer diffing two archived
    // payloads has to be able to tell whether they are comparable at all.
    scoring_model_version: audit.scoringModelVersion || null,
    engine: audit.meta?.engine || null,
    stage_errors: audit.stageErrors || [],
  };
}
