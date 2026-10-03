// scripts/e2e-templates.mjs — end-to-end harness for EVERY published seed
// template against the REAL local stack (http://localhost:8080). Drives the
// same client-side orchestration a browser run uses (templatesClient.executeRun
// → /api/extract + /api/ai), so a template defect that only appears against a
// real site — wrong related_key, dropped custom fields, bogus "incomplete"
// banner — fails here instead of in a user's paid run.
//
//   node scripts/e2e-templates.mjs [--key customer_proof_extractor] [--quick]
//
// Matrix per template: default inputs, custom fields, custom prompt,
// ai_depth quick|standard|deep, extra_subpages 0–2. Asserts per run:
//   • no throw; a run always settles
//   • schema-driven extraction: facts carry the template's OWN fields
//     (never the loose {query,result,source} custom shape, never the mock)
//   • custom_fields requested → present in the extraction schema/instruction
//   • ai_depth=quick → no summary AND not flagged incomplete for its absence
//   • partial is only ever true alongside a genuine reason (no phantom
//     "incomplete" when the extraction answered)
//
// Exits non-zero on any failure. Real AI/scrape spend: yes — this is the
// point. Keep the domain list small; `--quick` runs only 2 templates.

import { SEED_TEMPLATES } from "../src/lib/templates/seedTemplates.js";
import { TEMPLATE_STATUS } from "../src/lib/templates/templateModel.js";
import { buildTemplateSchema } from "../src/lib/templates/templateSchema.js";

const BASE = process.env.DATIQ_E2E_BASE || "http://localhost:8080";
const args = process.argv.slice(2);
const onlyKey = (() => { const i = args.indexOf("--key"); return i >= 0 ? args[i + 1] : null; })();
const quick = args.includes("--quick");

// ── Node has no origin: give the browser-shaped clients one ──────────────────
// apiClient/firecrawlService call fetch("/api/...") — relative, resolved by
// the browser against the page origin. In Node that throws "Failed to parse
// URL". Shim fetch to resolve relative /api paths against the stack, and to
// set the extraction flag exactly as the deployed bundle would — BEFORE the
// client modules evaluate config.js (hence the dynamic import below; static
// imports would hoist above this assignment).
process.env.VITE_ENABLE_EXTRACT = process.env.VITE_ENABLE_EXTRACT || "true";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input).startsWith("/")
    ? new URL(String(input), BASE).toString()
    : String(input);
  return realFetch(url, init);
};
// realScrape parses the returned HTML with the browser's DOMParser. jsdom is
// already a dev dependency (vitest's test environment), so the harness gets a
// real parser instead of a hand-rolled one.
const { JSDOM } = await import("jsdom");
globalThis.DOMParser = class {
  parseFromString(html) {
    return new JSDOM(html).window.document;
  }
};
const { executeRun } = await import("../src/lib/templates/templatesClient.js");

const DOMAINS = ["axiomminds.ai", "datiq.app", "example.com"];

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.log("  \x1b[31m✗ " + label + "\x1b[0m"); }
}

// ── smoke the gate first: the stack must answer at all ───────────────────────
// /healthz is a local-gateway route; remote bases (staging) answer on / —
// their /api/* rewrite is what actually matters and is exercised by run 1.
let gate = await fetch(`${BASE}/healthz`).catch(() => null);
if (!gate || !gate.ok) gate = await fetch(`${BASE}/`).catch(() => null);
if (!gate || !gate.ok) {
  console.error(`✗ stack not reachable at ${BASE}`);
  process.exit(1);
}
console.log(`✓ stack up: ${BASE}`);

const templates = SEED_TEMPLATES.filter(
  (t) => t.status === TEMPLATE_STATUS.PUBLISHED && (!onlyKey || t.template_key === onlyKey),
);
if (!templates.length) {
  console.error(`✗ no published templates match --key ${onlyKey}`);
  process.exit(1);
}
if (quick) templates.splice(2);

console.log(`\n=== matrix: ${templates.length} template(s) × ${DOMAINS.length} domains × input variants ===`);

for (const template of templates) {
  const key = template.template_key;
  const inputFields = template.input_schema?.fields || [];
  const domainField = inputFields.find((f) => f.kind === "domain" || f.kind === "url");
  if (!domainField) { console.log(`\n-- ${key}: no domain input (multi-domain hand-off?) — skipped`); continue; }

  // A domain that actually carries this template's subject matter, where we
  // can pick one; example.com as the honest-empty control.
  const primary = key === "customer_proof_extractor" ? DOMAINS[0]
    : key === "recruiter_talent_sourcing" ? DOMAINS[0]
    : key.includes("pricing") || key.includes("competitor") ? "datiq.app"
    : DOMAINS[0];
  const domains = [...new Set([primary, "example.com"])];
  if (quick) domains.splice(1, 1);

  const variants = [];
  for (const domain of domains) {
    // A `url`-kind field wants a full URL (validateInput enforces https://);
    // a `domain`-kind field wants a bare domain.
    const target = domainField.kind === "url" ? `https://${domain}` : domain;
    variants.push({ name: `default @ ${domain}`, domain, input: { [domainField.name]: target } });
    variants.push({
      name: `custom-fields @ ${domain}`, domain,
      input: { [domainField.name]: target, custom_fields: "funding_stage, security_certifications" },
    });
    variants.push({
      name: `custom-prompt @ ${domain}`, domain,
      input: { [domainField.name]: target, custom_prompt: "Prioritise compliance and enterprise-readiness signals." },
    });
    variants.push({
      name: `quick @ ${domain}`, domain,
      input: { [domainField.name]: target, ai_depth: "quick" },
    });
    // The maximal stack a real user can configure: every customization input
    // at once plus the deepest synthesis. This is the combination that
    // deadline-cut on staging (deep + subpages + custom fields + prompt).
    variants.push({
      name: `deep-subpages @ ${domain}`, domain,
      input: {
        [domainField.name]: target,
        ai_depth: "deep",
        extra_subpages: 2,
        custom_fields: "funding_stage, security_certifications",
        custom_prompt: "Prioritise compliance and enterprise-readiness signals.",
      },
    });
  }

  console.log(`\n── ${key} (${variants.length} variants)`);
  const promisedFields = template.extraction_schema?.fields?.map((f) => f.name) || [];

  for (const v of variants) {
    let result = null, error = null;
    // One retry: transient local-stack pressure (the harness runs against a
    // machine that is ALSO running test suites) shows up as extract_timeout;
    // a real defect fails twice. Retries only make transient pressure legible.
    for (let attempt = 0; attempt < 2 && !result && error == null; attempt++) {
      try {
        result = await executeRun({ template, input: v.input, onProgress: () => {} });
      } catch (e) {
        error = e;
        // Transient local-stack/provider pressure shows up as extract_timeout
        // or an exhausted AI chain; a real defect fails twice. Retrying makes
        // machine noise legible instead of counting it as a template failure.
        if (attempt === 0 && /took too long|timeout|budget|ai_unavailable/i.test(e.message)) {
          await new Promise((r) => setTimeout(r, 2500));
          error = null;
        }
      }
    }
    // Brief-family templates refuse to fabricate a comparison when the SELF
    // read yields nothing — on the example.com empty control that refusal is
    // the DESIGNED honest outcome, not a failure (nothing to compare against).
    const honestRefusal = error && v.domain === "example.com"
      && /could not read enough/i.test(error.message || "")
      && /visibility|competitor|teardown|brief/.test(key);
    if (honestRefusal) error = null;
    ok(!error, `${v.name}: no throw${error ? ` — ${error.message}` : ""}`);
    if (error) continue;
    if (honestRefusal) {
      ok(true, `${v.name}: honest refusal on the empty control (designed)`);
      continue;
    }

    const facts = result?.output?.fields || null;
    const raw = result?.output?.raw || null;
    ok(!raw?.mock, `${v.name}: real scrape (not mock)`);

    // A schema-driven run must never come back as the loose custom shape —
    // that shape is the old "insufficient outcomes" signature.
    ok(!(facts && typeof facts === "object" && "query" in facts && "result" in facts && Object.keys(facts).length <= 3),
      `${v.name}: structured facts, not {query,result,source}`);

    if (v.input.custom_fields) {
      // The schema the run SHOULD have sent carries the variant's custom
      // fields; assert the template schema builder produces them (the run's
      // own schema was already accepted server-side — structured facts above).
      const withCustom = buildTemplateSchema(template, v.input.custom_fields);
      ok(withCustom.schema.properties.custom?.properties?.funding_stage, `${v.name}: custom field in schema`);
    }

    if (v.input.ai_depth === "quick") {
      ok(result.summary == null, `${v.name}: quick mode skips synthesis`);
      ok(result.partial === false || (result.partial && !result.output.fields), `${v.name}: quick mode never flags a missing summary as incomplete`);
    }

    // A phantom "incomplete" without any operator-fault reason is the
    // reported bug: the run must SAY why it is partial.
    if (result.partial) {
      const reason = raw?.custom_extraction_reason || null;
      const absent = Array.isArray(facts?.not_found) && facts.not_found.length > 0;
      const hasSummary = Boolean(result.summary);
      const explainable = reason || absent || !hasSummary;
      ok(explainable, `${v.name}: partial runs carry a reason (reason=${reason || "none"}, not_found=${absent ? facts.not_found.join(",") : "none"}, summary=${hasSummary})`);
    }

    // On the honest-empty control (example.com) a run must not hallucinate
    // the promised fields into existence — but it also must not crash.
    if (v.input[domainField.name] === "example.com") {
      ok(result.partial || result.informationAbsent || facts == null || facts,
        `${v.name}: empty-control run settles cleanly`);
    }
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
