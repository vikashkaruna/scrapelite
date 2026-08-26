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

import { PILLAR_IDS, pillarLabel } from "./signalRegistry.js";
import { FRAMEWORKS, scoreBand } from "./scoringModel.js";
import { SEVERITIES } from "./issueCatalog.js";

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
  const { includeEvidence = true, includeConstructs = false, brand = "DatIQ", diff = null } = options;
  const t = audit.target || {};
  const out = [];

  out.push(`# Discoverability audit`);
  out.push("");
  out.push(`**${t.url || audit.url || "Unknown URL"}**`);
  out.push("");
  out.push(`| | |`);
  out.push(`|---|---|`);
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
      out.push(`- **${p.label}** (−${Math.round(p.factor * 100)}%) — ${p.description}`);
    }
    out.push("");
  }

  // ── pillars ──────────────────────────────────────────────────────────────
  out.push(`## Pillars`);
  out.push("");
  for (const id of PILLAR_IDS) {
    const p = audit.pillars?.[id];
    if (!p) continue;
    out.push(`### ${pillarLabel(id)} — ${fmt(p.score)}`);
    out.push("");
    out.push(`| Signal | Score | Weight | |`);
    out.push(`|---|---|---|---|`);
    for (const s of p.signals || []) {
      const note = s.measured ? "" : (s.applicable === false ? "not applicable to this page type" : "not measured");
      out.push(`| ${s.label} | ${fmt(s.score)} | ${Math.round(s.weight * 100)}% | ${note} |`);
    }
    out.push("");
  }

  // ── issues ───────────────────────────────────────────────────────────────
  const issues = audit.issues || [];
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
        if (i.evidence) out.push(`  ${i.evidence}`);
        out.push(`  _Affects: ${(i.frameworks || []).join(", ").toUpperCase() || "—"}_`);
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

  out.push("---");
  out.push("");
  out.push(`_Generated by ${brand}. Scores describe how discoverable and extractable this page is today. They are not a prediction of rankings, citations or traffic._`);
  return out.join("\n");
}

/** Issues as CSV, for a spreadsheet remediation tracker. */
export function issuesToCsv(audit) {
  const rows = [["code", "severity", "pillar", "frameworks", "title", "evidence"]];
  for (const i of audit?.issues || []) {
    rows.push([i.code, i.severity, i.pillar, (i.frameworks || []).join(" "), i.title, i.evidence || ""]);
  }
  return toCsv(rows);
}

/** The recommendation queue as CSV — the export a delivery team actually works from. */
export function recommendationsToCsv(audit) {
  const rows = [["code", "priority", "priority_score", "owner", "title", "estimated_lift", "effort", "confidence", "frameworks", "status"]];
  for (const r of audit?.recommendations || []) {
    rows.push([
      r.code, r.priority, r.priorityScore ?? r.priority_score ?? "",
      r.owner || r.owner_role || "", r.title,
      r.estimatedLift ?? r.estimated_lift ?? "",
      r.effortScore ?? r.effort_score ?? "",
      r.confidenceScore ?? r.confidence_score ?? "",
      (r.frameworks || []).join(" "), r.status || "open",
    ]);
  }
  return toCsv(rows);
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

/** The machine-readable payload, matching the documented JSON schema. */
export function toJsonPayload(audit) {
  if (!audit) return null;
  return {
    audit_id: audit.auditId || audit.id || null,
    timestamp: audit.meta?.startedAt ? new Date(audit.meta.startedAt).toISOString() : null,
    target: audit.target || null,
    framework_scores: {
      overall: audit.finalScore, seo: audit.seoScore, aeo: audit.aeoScore, geo: audit.geoScore,
    },
    coverage: audit.coverage,
    pillar_scores: Object.fromEntries(
      PILLAR_IDS.map((p) => [p, {
        score: audit.pillars?.[p]?.score ?? null,
        weight: audit.pillars?.[p]?.weight ?? null,
        coverage: audit.pillars?.[p]?.coverage ?? null,
        signals: Object.fromEntries((audit.pillars?.[p]?.signals || []).map((s) => [s.code, s.score])),
      }]),
    ),
    penalties: (audit.penalties || []).map((p) => ({
      code: p.code, severity: p.severity, penalty_factor: p.factor, description: p.description,
    })),
    technical_facts: audit.facts?.technical || {},
    content_facts: audit.facts?.content || {},
    entity_facts: audit.facts?.entity || {},
    issues: audit.issues || [],
    recommendations: audit.recommendations || [],
    score_math: audit.scoreMath || null,
    engine: audit.meta?.engine || null,
    stage_errors: audit.stageErrors || [],
  };
}
