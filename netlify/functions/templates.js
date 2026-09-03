// netlify/functions/templates.js — PRD 1's workflow template engine.
//
//   GET  /api/templates                  → the catalogue (seeds on first read)
//   GET  /api/templates?key=<k>          → one template, published version
//   GET  /api/templates?runId=<id>       → one run
//   GET  /api/templates?runs=1           → my recent runs
//   POST /api/templates {action:"estimate"} → credits, itemised, no row written
//   POST /api/templates {action:"start"}    → validate + charge-check + create run
//   POST /api/templates {action:"finish"}   → persist output + append the ledger
//   POST /api/templates {action:"fail"}     → mark failed, charge nothing
//
// ── WHY THE RUN IS ORCHESTRATED BY THE CLIENT IN PHASE 1 ────────────────────
// A synchronous Netlify function is killed at 10s, and a template run is 2-4
// scrapes plus 1-2 AI calls — comfortably over. This repo has already shipped
// a 504 from exactly that shape (the discoverability audit, fixed with
// AUDIT_BUDGET_MS), so re-making it here would be a knowing repeat.
//
// Instead Phase 1 reuses the orchestration that already works and is already
// gated: the client calls /api/extract and /api/ai — the same path Home and
// Preview use — and this function owns validation, entitlement, the credit
// estimate, persistence and the ledger. The durable SERVER-side runner is
// Phase 4 (§1.3a), where it is needed because a 500-row list genuinely cannot
// be driven from a browser tab.
//
// ── GUESTS MAY RUN, BUT NOTHING IS PERSISTED FOR THEM ───────────────────────
// template.run is deliberately ungated by plan (PRD 1 is the activation path).
// A guest still gets validation and an estimate, but no run row: template_runs
// keys on auth.users and a guest has no id to attach to. Same conclusion the
// enrichment sync queue reached — guests flush once and are dropped.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { resolveRequestEntitlement, checkCapability, denyResponse } from "./lib/requireEntitlement.js";
import { checkAllowance } from "../../src/lib/credits/creditModel.js";
import { getEffectivePlanById } from "../../src/lib/pricingOverrides.js";
import {
  listTemplates, getTemplate, ensureSeeded, createRun, updateRun, getRun,
  listRuns, recordSources, recordEstimate, chargeLedger, creditBalance,
} from "./lib/templateStore.js";
import { SEED_TEMPLATES } from "../../src/lib/templates/seedTemplates.js";
import {
  validateInput, estimateCredits, capabilityFor, resolveTemplateVersion, RUN_STATUS,
} from "../../src/lib/templates/templateModel.js";
import { toLedgerEntries, actualCredits, reconcile } from "../../src/lib/credits/creditModel.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS },
  body: JSON.stringify(body),
});

function genRunId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `trun_${Date.now().toString(36)}${rand}`;
}

/** Strip prompts from a template before it reaches an unauthenticated reader. */
function publicShape(t, { includePrompts = false } = {}) {
  const { prompt_bundle, ...rest } = t;
  return includePrompts ? { ...rest, prompt_bundle } : rest;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[templates] unhandled", e);
    return json(500, { error: "Something went wrong handling that template request." });
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};

  if (qs.runId) {
    const auth = await authenticateBearer(event, { label: "templates" });
    if (!auth.ok) return json(auth.status, auth.body);
    const run = await getRun(qs.runId);
    if (!run) return json(404, { error: "Run not found" });
    // A run is private to the user who made it. 404, not 403, so run ids
    // cannot be enumerated — the same rule invoice downloads follow.
    if (run.user_id && run.user_id !== auth.user.id) return json(404, { error: "Run not found" });
    return json(200, { run });
  }

  if (qs.runs) {
    const auth = await authenticateBearer(event, { label: "templates" });
    if (!auth.ok) return json(auth.status, auth.body);
    return json(200, { runs: await listRuns(auth.user.id) });
  }

  await ensureSeeded(SEED_TEMPLATES);
  const { ok, rows, reason } = await listTemplates();
  if (!ok) {
    // Supabase unconfigured/unreachable, or `workflow_templates` missing on
    // this environment → serve the seeds so the catalogue still renders.
    // Degrading to an empty page would make a working feature look broken in
    // every environment without a service key.
    //
    // `qs.key` MUST be handled INSIDE this branch. It used to fall straight to
    // the `templates` array below and return before the single-template lookup
    // ever ran — so /templates?key=<anything> answered 200 with a `templates`
    // array and NO `template` field, and the runner, reasonably trusting the
    // field that 200 promised, died on `r.template.input_schema`. One missing
    // migration therefore broke EVERY template link in the product and
    // reported it as a TypeError instead of as the outage it was. The
    // catalogue kept listing all six cards throughout, because it is served
    // from these same seeds — which is exactly why it looked like a
    // per-template bug rather than a store that was down.
    if (qs.key) {
      const seed = SEED_TEMPLATES.find((t) => t.template_key === qs.key && t.status === "published");
      if (!seed) return json(404, { error: "Template not found" });
      return json(200, {
        template: publicShape({ ...seed, version: 1 }, { includePrompts: true }),
        degraded: true, reason,
      });
    }
    return json(200, {
      templates: SEED_TEMPLATES.filter((t) => t.status === "published").map((t) => publicShape({ ...t, version: 1 })),
      degraded: true, reason,
    });
  }

  if (qs.key) {
    const t = resolveTemplateVersion(rows, qs.key) || (await getTemplate(qs.key, qs.version));
    if (!t) return json(404, { error: "Template not found" });
    return json(200, { template: publicShape(t, { includePrompts: true }) });
  }

  const published = rows.filter((r) => r.status === "published");
  return json(200, { templates: published.map((t) => publicShape(t)) });
}

/**
 * A plan's monthly credit budget.
 *
 * `limits.extractions` IS the credit allowance — the Developer plan's
 * `extractions: 10000` is the same number its pricing page calls "10,000 row
 * credits / month". Resolved through getEffectivePlanById so an admin price
 * override moves the budget too, rather than the static table drifting from
 * what checkout actually sold.
 *
 * Unknown plan → Infinity, deliberately. Failing OPEN here matches
 * requireEntitlement: a plan id we cannot resolve is an infrastructure
 * problem, and refusing a paying customer's run over it is the worse error.
 */
function planAllowance(resolved) {
  const planId = resolved?.entitlement?.plan_id || resolved?.planId || "free";
  const plan = getEffectivePlanById(planId);
  const n = plan?.limits?.extractions;
  return Number.isFinite(n) ? n : Infinity;
}

async function handlePost(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const action = String(body.action || "");
  if (!["estimate", "start", "finish", "fail"].includes(action)) {
    return json(400, { error: `Unknown action '${action}'` });
  }

  // finish/fail act on an existing run and must be signed in.
  if (action === "finish" || action === "fail") {
    const auth = await authenticateBearer(event, { label: "templates" });
    if (!auth.ok) return json(auth.status, auth.body);
    return action === "finish" ? await finishRun(body, auth.user) : await failRun(body, auth.user);
  }

  const template = await resolveForRun(body.templateKey, body.version);
  if (!template) return json(404, { error: "Template not found" });

  const v = validateInput(template, body.input || {});
  if (!v.ok) return json(400, { error: v.errors[0], errors: v.errors });

  const estimate = estimateCredits(template, v.value);

  // ── identity comes from ONE place ────────────────────────────────────────
  // authenticateBearer is the canonical verified identity in this codebase.
  // resolveRequestEntitlement also derives a userId (by decoding the JWT
  // itself), and letting both decide would create two answers to "who is
  // this?" that can disagree — which is precisely the class of bug that let a
  // body-supplied planId through verify-payment.js once before. So: the user
  // id ALWAYS comes from authenticateBearer; resolveRequestEntitlement is
  // consulted only for the plan.
  //
  // A guest (no header) is fine here and is NOT an error — template.run is
  // deliberately ungated. A header that fails to verify is also treated as a
  // guest rather than a 401, so a stale token degrades to "you can run it but
  // we can't save it" instead of a dead end.
  let userId = null;
  if (event.headers?.authorization) {
    const auth = await authenticateBearer(event, { label: "templates" });
    if (auth.ok) userId = auth.user.id;
  }

  // Entitlement runs against the caller's OWN plan, server-side. The client
  // shows the same verdict via entitlementClient, but that is UX only.
  const resolved = await resolveRequestEntitlement(event);
  const check = checkCapability(resolved, capabilityFor(template), {});
  if (!check.allowed) return denyResponse(check, CORS);

  // ── CREDIT AFFORDABILITY, CHECKED BEFORE ANY WORK HAPPENS ────────────────
  // 🔴 checkAllowance() shipped with the credit ledger and had ZERO CALLERS.
  // Credits were RECORDED but never ENFORCED: a Free account whose allowance
  // is 10 could start an 8-credit run with 3 left, spend three page fetches
  // and two AI calls, and only discover the shortfall from the invoice. The
  // owner reported the symptom — "credit checks happen later than the run" —
  // and the cause was that they did not happen at all.
  //
  // The allowance is `plan.limits.extractions`. That is not a guess: the
  // Developer plan carries `extractions: 10000` and its own marketing line
  // reads "10,000 row credits / month", so extractions ARE the credit budget
  // under a different name. Agency is Infinity, which checkAllowance already
  // short-circuits.
  //
  // Ordered ABOVE the run row and every fetch, matching extract.js's rule that
  // everything above the charge must be able to decline without doing work.
  const allowance = planAllowance(resolved);
  const spent = userId ? await creditBalance(userId, monthKey()) : 0;
  const afford = checkAllowance({ spent, allowance, estimated: estimate.credits ?? estimate.total ?? 0 });

  if (action === "estimate") {
    return json(200, { estimate, input: v.value, spentThisMonth: spent, allowance, afford });
  }

  if (!afford.ok) {
    // Refused BEFORE the run row exists, so nothing is charged and no partial
    // report is produced. The numbers are stated plainly — a bare "insufficient
    // credits" leaves the user unable to tell whether they need to wait for the
    // month to roll or to upgrade.
    return json(402, {
      error: `This run needs ${estimate.credits ?? estimate.total} credits and you have ${afford.remaining} left this month.`,
      code: "insufficient_credits",
      needed: estimate.credits ?? estimate.total,
      remaining: afford.remaining,
      shortBy: afford.wouldExceedBy,
      allowance,
      upgradeUrl: "/pricing",
    });
  }

  // ── start ────────────────────────────────────────────────────────────────
  const runId = genRunId();

  if (!userId) {
    // Guest: everything works except persistence. Say so explicitly rather
    // than returning a runId that will 404 on the next call.
    return json(200, {
      runId: null, guest: true, estimate, input: v.value,
      template: publicShape(template, { includePrompts: true }),
      note: "Sign in to save this run to your dashboard.",
    });
  }

  const created = await createRun({
    id: runId,
    template_key: template.template_key,
    template_version: template.version ?? 1,
    user_id: userId,
    workspace_id: body.workspaceId || null,
    status: RUN_STATUS.RUNNING,
    input: v.value,
    credits_estimated: estimate.credits,
    started_at: new Date().toISOString(),
  });
  if (!created.ok) {
    // Persistence failed but the work is still doable — hand back a guest-
    // shaped response rather than blocking the user on our storage problem.
    console.error("[templates] createRun failed:", created.reason);
    return json(200, {
      runId: null, guest: false, degraded: true, estimate, input: v.value,
      template: publicShape(template, { includePrompts: true }),
    });
  }

  await recordEstimate({
    user_id: userId, run_id: runId,
    template_key: template.template_key, template_version: template.version ?? 1,
    estimated_credits: estimate.credits, breakdown: estimate.breakdown,
    accepted_at: new Date().toISOString(),
  });

  return json(200, {
    runId, estimate, input: v.value,
    template: publicShape(template, { includePrompts: true }),
  });
}

async function resolveForRun(key, version) {
  if (!key) return null;
  const fromDb = await getTemplate(key, version);
  if (fromDb) return fromDb;
  // Degraded (no service key): fall back to the seed so local dev works.
  const seed = SEED_TEMPLATES.find((t) => t.template_key === key && t.status === "published");
  return seed ? { ...seed, version: 1 } : null;
}

async function finishRun(body, user) {
  const run = await getRun(body.runId);
  if (!run) return json(404, { error: "Run not found" });
  if (run.user_id !== user.id) return json(404, { error: "Run not found" });

  const events = Array.isArray(body.events) ? body.events : [];
  const entries = toLedgerEntries(events, { runId: run.id, userId: user.id, workspaceId: run.workspace_id });
  const actual = actualCredits(events);

  await chargeLedger(entries);
  if (Array.isArray(body.sources)) await recordSources(run.id, body.sources);

  const status = body.partial ? RUN_STATUS.PARTIAL
    : body.needsReview ? RUN_STATUS.NEEDS_REVIEW
    : RUN_STATUS.COMPLETE;

  const updated = await updateRun(run.id, {
    status,
    output: body.output ?? null,
    output_summary: body.summary ?? null,
    credits_actual: actual,
    finished_at: new Date().toISOString(),
  });

  return json(200, {
    run: updated.run,
    charged: actual,
    // Surfaced so the UI can disclose an overrun rather than quietly billing
    // more than the number the user agreed to.
    reconciliation: reconcile(run.credits_estimated || 0, events),
  });
}

async function failRun(body, user) {
  const run = await getRun(body.runId);
  if (!run) return json(404, { error: "Run not found" });
  if (run.user_id !== user.id) return json(404, { error: "Run not found" });

  // A failed run charges NOTHING. The user got no value; we absorb the cost.
  const updated = await updateRun(run.id, {
    status: RUN_STATUS.FAILED,
    error: String(body.error || "Run failed").slice(0, 500),
    credits_actual: 0,
    finished_at: new Date().toISOString(),
  });
  return json(200, { run: updated.run, charged: 0 });
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
