import { describe, it, expect } from "vitest";
import {
  ACTIVATION_EVENTS, ACTIVATION_EVENT_NAMES, TEMPLATE_CONDITION, conditionsFromEvents,
} from "./activationEvents.js";
import {
  PQL_SIGNAL_KEYS, ACTIVATION_CONDITIONS, ACTIVATION_DEFINITIONS, signalsFromEvents, scorePql,
} from "./pqlModel.js";
import { SEED_TEMPLATES } from "../templates/seedTemplates.js";

// ─────────────────────────────────────────────────────────────────────────────
// THE DRIFT GUARD.
//
// A scoring model can be perfectly correct and still read zero for every user
// forever, because the emitter and the consumer disagree about a string.
// CLAUDE.md records exactly this: schedulerService sent {url, name} while the
// object carried target/label, so "every monitor_created event ever recorded
// was undefined/undefined". Nothing failed. Nothing logged. It went unnoticed
// until somebody read the rows.
//
// These tests make that class of bug a build failure instead.
// ─────────────────────────────────────────────────────────────────────────────
describe("vocabulary and consumers cannot drift apart", () => {
  it("every signal an event claims to feed is a real PQL signal", () => {
    for (const [name, def] of Object.entries(ACTIVATION_EVENTS)) {
      if (def.feeds === null) continue;
      expect(PQL_SIGNAL_KEYS, `${name}.feeds`).toContain(def.feeds);
    }
  });

  it("every condition an event claims to satisfy is a real activation condition", () => {
    for (const [name, def] of Object.entries(ACTIVATION_EVENTS)) {
      for (const c of def.conditions) {
        expect(Object.keys(ACTIVATION_CONDITIONS), `${name}.conditions`).toContain(c);
      }
    }
  });

  // The other direction, and the one that actually bites: a condition no event
  // can ever produce is an activation definition nobody can ever satisfy.
  it("every activation condition is reachable from at least one event", () => {
    const reachable = new Set(Object.values(ACTIVATION_EVENTS).flatMap((d) => d.conditions));
    const required = new Set(Object.values(ACTIVATION_DEFINITIONS).flatMap((d) => d.requires));
    const unreachable = [...required].filter((c) => !reachable.has(c));
    expect(unreachable, "conditions no event can satisfy — activation would be impossible").toEqual([]);
  });

  // Same, for scoring: a signal no event feeds scores zero for everyone alive.
  it("every measurable-today PQL signal is fed by at least one event", () => {
    const fed = new Set(Object.values(ACTIVATION_EVENTS).map((d) => d.feeds).filter(Boolean));
    // icp_fit is account fit, not behaviour, and is excluded by design.
    const behavioural = PQL_SIGNAL_KEYS.filter((k) => k !== "icp_fit");
    expect(behavioural.filter((k) => !fed.has(k))).toEqual([]);
  });

  // signalsFromEvents reads raw NAMES. If it reads a name the vocabulary does
  // not declare, that signal is dead on arrival in production.
  it("every event name signalsFromEvents reads is declared in the vocabulary", () => {
    const src = signalsFromEvents.toString();
    // Scoped to the three ways this module reads an event NAME. A looser
    // pattern also matched `typeof e === "object"`, which is not an event.
    const read = [...src.matchAll(/named\("([a-z_]+)"\)|\.name === "([a-z_]+)"|startsWith\("([a-z_]+)"\)/g)]
      .map((m) => m[1] || m[2] || m[3]).filter(Boolean);
    for (const name of read) {
      const declared = ACTIVATION_EVENT_NAMES.some((n) => n === name || n.startsWith(name));
      expect(declared, `signalsFromEvents reads "${name}" but no event declares it`).toBe(true);
    }
  });

  // A vocabulary entry with no emitter is a signal that can never fire. The
  // reverse — an emitter for an undeclared name — is the drift this file
  // exists to stop. Both directions are asserted.
  it("every vocabulary kind has an emitter in analyticsService.lifecycle", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/lib/analyticsService.js"), "utf8");
    const emitted = new Set([
      ...[...src.matchAll(/emitActivation\("([a-z_]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/track\("([a-z_]+)"/g)].map((m) => m[1]),
      // FUNNEL.MONITOR is the string "monitor" and monitorCreated emits it as
      // the monitor_created family; extraction_success has its own helper.
      "monitor_created",
    ]);
    const orphans = ACTIVATION_EVENT_NAMES.filter((n) => !emitted.has(n));
    expect(orphans, "vocabulary kinds nothing can emit").toEqual([]);
  });

  it("analyticsService emits no activation name the vocabulary does not declare", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/lib/analyticsService.js"), "utf8");
    const emitted = [...src.matchAll(/emitActivation\("([a-z_]+)"/g)].map((m) => m[1]);
    for (const name of emitted) {
      expect(ACTIVATION_EVENT_NAMES, `emitter for undeclared "${name}"`).toContain(name);
    }
  });

  it("every count-based event declares the property it counts", () => {
    expect(ACTIVATION_EVENTS.bulk_enrichment_completed.requires).toContain("count");
    expect(ACTIVATION_EVENTS.watchlist_created.requires).toContain("competitorCount");
    expect(ACTIVATION_EVENTS.enrichment_completed.requires).toEqual(
      expect.arrayContaining(["capability", "domain"]));
  });

  it("every template key in TEMPLATE_CONDITION is a real seeded template", () => {
    const seeded = new Set(SEED_TEMPLATES.map((t) => t.template_key));
    for (const key of Object.keys(TEMPLATE_CONDITION)) {
      expect(seeded, `TEMPLATE_CONDITION references unknown template "${key}"`).toContain(key);
    }
  });

  // A new template landing without a decision here is silent: it would emit
  // template_run_completed and satisfy nothing. Explicit null is a decision.
  it("every seeded template has an explicit condition mapping, even if null", () => {
    for (const t of SEED_TEMPLATES) {
      expect(Object.prototype.hasOwnProperty.call(TEMPLATE_CONDITION, t.template_key),
        `template "${t.template_key}" has no TEMPLATE_CONDITION entry — add one, null is fine`).toBe(true);
    }
  });
});

describe("conditionsFromEvents", () => {
  const ev = (name, properties = {}) => ({ name, properties, ts: "2026-09-01T10:00:00Z" });

  it("returns nothing for no events", () => {
    expect(conditionsFromEvents([])).toEqual({});
    expect(conditionsFromEvents(null)).toEqual({});
  });

  it("maps a template run to the condition its template key implies", () => {
    expect(conditionsFromEvents([ev("template_run_completed", { templateKey: "account_brief" })]))
      .toHaveProperty("ran_account_brief", true);
    expect(conditionsFromEvents([ev("template_run_completed", { templateKey: "discoverability_audit" })]))
      .toHaveProperty("ran_audit", true);
  });

  it("a template with a null mapping satisfies nothing on its own", () => {
    expect(conditionsFromEvents([ev("template_run_completed", { templateKey: "customer_proof_extractor" })]))
      .toEqual({});
  });

  // A missing count reads as 0, not as an error — which is precisely why the
  // vocabulary declares `requires` for these.
  it("count thresholds are strict and a missing count does not pass", () => {
    expect(conditionsFromEvents([ev("bulk_enrichment_completed", { count: 9 })]).imported_10_accounts).toBeUndefined();
    expect(conditionsFromEvents([ev("bulk_enrichment_completed", {})]).imported_10_accounts).toBeUndefined();
    expect(conditionsFromEvents([ev("bulk_enrichment_completed", { count: 10 })]).imported_10_accounts).toBe(true);
    expect(conditionsFromEvents([ev("watchlist_created", { competitorCount: 2 })]).added_3_competitors).toBeUndefined();
    expect(conditionsFromEvents([ev("watchlist_created", { competitorCount: 3 })]).added_3_competitors).toBe(true);
  });

  it("counts DISTINCT companies for recruiter sourcing, not repeat lookups", () => {
    const same = ["a.com", "a.com", "a.com"].map((d) => ev("enrichment_completed", { capability: "leadership", domain: d }));
    expect(conditionsFromEvents(same).sourced_across_3_companies).toBeUndefined();
    const three = ["a.com", "b.com", "c.com"].map((d) => ev("enrichment_completed", { capability: "contacts", domain: d }));
    expect(conditionsFromEvents(three).sourced_across_3_companies).toBe(true);
  });

  it("only CRM-shaped destinations satisfy sent_to_crm_sheet", () => {
    expect(conditionsFromEvents([ev("integration_push", { provider: "hubspot" })]).sent_to_crm_sheet).toBe(true);
    expect(conditionsFromEvents([ev("integration_push", { provider: "slack" })]).sent_to_crm_sheet).toBeUndefined();
  });

  it("drives a real PRD activation end to end", () => {
    const conditions = conditionsFromEvents([
      ev("template_run_completed", { templateKey: "account_brief" }),
      ev("integration_push", { provider: "hubspot" }),
      ev("extraction_saved"),
    ]);
    expect(scorePql({}, { persona: "sales", conditions }).activated).toBe(true);
  });

  it("survives malformed events", () => {
    expect(() => conditionsFromEvents([null, {}, { name: 1 }, { properties: null }])).not.toThrow();
  });
});
