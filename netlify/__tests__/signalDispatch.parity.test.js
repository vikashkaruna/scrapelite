// Parity between the events the platform EMITS and the trigger_source a rule
// can DECLARE. One side declares, the other executes, and nothing asserted they
// agreed — so the failure was silence.
//
// Before this test, EVENT_TO_SOURCE mapped eight of the ten canonical kinds to
// 'account' / 'extraction' / 'report' / 'system' — values migration 0043's CHECK
// constraint forbids. findMatchingRules filters .eq("trigger_source", source),
// so those queries matched zero rows every time and dispatched nothing. The
// mirror image was just as bad: 'bulk_enrichment' and 'workflow_run' were
// offered in the rule builder and accepted by the database while NO event
// produced them, so a rule a user saved and saw listed as active could never
// fire.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIGNAL_EVENTS, EVENT_TO_SOURCE, UNROUTED_EVENTS } from "../functions/lib/signalDispatch.js";
import { TRIGGER_SOURCES } from "../../src/lib/rules/ruleModel.js";

// Read the constraint from the migration itself rather than restating it — a
// copy here would drift from the database exactly as EVENT_TO_SOURCE did.
const migration = readFileSync("supabase/migrations/0043_signal_rules.sql", "utf8");
const DECLARABLE = (() => {
  const m = migration.match(/trigger_source\s+text\s+not null\s+check\s*\(\s*trigger_source\s+in\s*\(([^)]+)\)/i);
  if (!m) throw new Error("could not read the trigger_source CHECK constraint from 0043");
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
})();

describe("signal event ↔ trigger_source parity", () => {
  it("the migration still constrains trigger_source to three values", () => {
    // Guards the regex above: if the constraint is rewritten, this fails loudly
    // rather than the parse silently returning something useless.
    expect(DECLARABLE.sort()).toEqual(["bulk_enrichment", "watchlist", "workflow_run"]);
  });

  it("every source an event maps to is one a rule can actually declare", () => {
    // THE ORIGINAL BUG. A source outside the CHECK constraint means the lookup
    // can only ever return zero rows.
    const impossible = Object.entries(EVENT_TO_SOURCE)
      .filter(([, source]) => !DECLARABLE.includes(source))
      .map(([kind, source]) => `${kind} → ${source}`);
    expect(impossible).toEqual([]);
  });

  it("every declarable source has at least one producing event", () => {
    // THE MIRROR BUG. A source the builder offers but nothing emits is a rule
    // the user can save, see listed as active, and never have fire.
    const produced = new Set(Object.values(EVENT_TO_SOURCE));
    const orphaned = DECLARABLE.filter((s) => !produced.has(s));
    expect(orphaned).toEqual([]);
  });

  it("ruleModel's TRIGGER_SOURCES agrees with the database", () => {
    expect(Object.values(TRIGGER_SOURCES).sort()).toEqual(DECLARABLE.sort());
  });

  it("every canonical event is either routed or explicitly unrouted — never merely forgotten", () => {
    // A kind absent from BOTH maps looks identical to one deliberately left
    // unrouted. Requiring a written reason makes the distinction visible.
    const unaccounted = SIGNAL_EVENTS.filter(
      (k) => !(k in EVENT_TO_SOURCE) && !(k in UNROUTED_EVENTS),
    );
    expect(unaccounted).toEqual([]);
  });

  it("an unrouted kind carries a reason, not just an absence", () => {
    for (const [kind, reason] of Object.entries(UNROUTED_EVENTS)) {
      expect(SIGNAL_EVENTS).toContain(kind);
      expect(String(reason).length).toBeGreaterThan(30);
    }
  });

  it("no kind is both routed and unrouted", () => {
    const both = Object.keys(EVENT_TO_SOURCE).filter((k) => k in UNROUTED_EVENTS);
    expect(both).toEqual([]);
  });
});
