// prompt-monitor.js — the recurring answer-engine sample. W6.5.
//
// ⚠️ THE SCHEDULE LIVES IN netlify.toml, NOT HERE.
// `export const config = { schedule }` is honoured only for v2 (`export
// default`) functions. Every function in this repo is v1, and declaring a
// schedule in the source would read as scheduled while firing never — which is
// exactly how all four crons sat dormant from R19 until 2026-07-27 with no
// build error and no runtime error. The registry that actually schedules is
// `netlify.toml`; `AUTOMATION_JOBS` is what makes the job visible on
// /admin/monitoring; the source is a third registry and the only one that does
// nothing on its own. `cron-registry-parity` asserts the first two agree.
//
// ── WHY THIS IS NOT discoverability-monitor ────────────────────────────────
// That cron re-AUDITS a page and compares scores. This re-SAMPLES an answer
// engine and compares citation states. They share a cadence and nothing else:
//
//   the row shape       a target and a score, versus a prompt set and a state.
//   the alert condition a score crossing a threshold, versus a state CHANGING
//                       — going from cited to absent is news at any score.
//   the failure mode    an unreachable page, versus an unreachable ENGINE.
//
// That last one is the load-bearing reason. A Perplexity outage must not pause
// page auditing, and folding these together would put one cron's retry and
// pause behaviour in charge of both.

import { sampleCitations, resolveEngine } from "./lib/audit/citationSampling.js";
import { withJobRun } from "./lib/jobControl.js";
import * as store from "./lib/audit/auditStore.js";
import { cadenceToNextRun } from "../../src/lib/discoverability/promptMonitorModel.js";

const JOB_ID = "prompt-monitor";

/** How many monitors one tick may run. Bounds the blast radius of a bad cadence. */
export const MAX_MONITORS_PER_TICK = 25;

export async function runOnce(now = Date.now(), env = process.env) {
  const engine = resolveEngine(env);
  if (!engine) {
    // 🔴 NOT AN ERROR, AND NOT A RUN EITHER. With no engine configured there is
    // nothing to measure, and recording an empty sample would write "you were
    // absent everywhere" into a trend line as though we had asked.
    return { ran: 0, skipped: 0, reason: "no answer engine configured" };
  }

  const due = await store.listDuePromptMonitors(now, MAX_MONITORS_PER_TICK);
  let ran = 0;
  let failed = 0;

  for (const m of due) {
    try {
      const set = m.prompt_set_id ? await store.getPromptSet(m.user_id, m.prompt_set_id) : null;
      const target = await store.getTargetById(m.user_id, m.target_id);
      if (!target) { await store.advancePromptMonitor(m.id, cadenceToNextRun(m.cadence, now)); continue; }

      const sample = await sampleCitations({
        brand: target.label || target.host,
        host: target.host,
        topic: target.label || target.host,
        prompts: set?.prompts_json?.length ? set.prompts_json : null,
        competitors: m.competitor_urls || [],
        geography: m.target_geography || null,
        env,
        engine: m.engine || null,
      });

      await store.recordPromptMonitorRun(m, sample);
      ran += 1;
    } catch (err) {
      failed += 1;
      await store.recordPromptMonitorRun(m, null, err?.message || "monitor failed");
    } finally {
      // Advance regardless. A monitor that failed must still move its clock, or
      // one unreachable engine turns into an every-tick retry storm against a
      // provider that is already struggling.
      await store.advancePromptMonitor(m.id, cadenceToNextRun(m.cadence, now));
    }
  }

  return { ran, failed, due: due.length, engine };
}

export const handler = withJobRun(JOB_ID, async () => {
  const result = await runOnce();
  return { statusCode: 200, body: JSON.stringify(result) };
});
