// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterRulesByScope, inUseConflict, SOURCE_TYPE_FOR_TRIGGER, EVENT_SOURCE_KEY } from "./ruleSources.js";

const rule = (id, trigger_source, source_scope = "all") => ({ id, trigger_source, source_scope });

describe("filterRulesByScope — a scoped rule never widens", () => {
  const rules = [rule("all", "watchlist"), rule("wA", "watchlist", "selected"), rule("empty", "watchlist", "selected")];
  const sources = { wA: [{ type: "watchlist", id: "A" }] };

  it("keeps 'all' rules for any event", () => {
    expect(filterRulesByScope(rules, sources, { payload: {} }).map((r) => r.id)).toEqual(["all"]);
  });
  it("keeps a scoped rule only for an event from one of its sources", () => {
    expect(filterRulesByScope(rules, sources, { payload: { watchlist_id: "A" } }).map((r) => r.id)).toEqual(["all", "wA"]);
    expect(filterRulesByScope(rules, sources, { payload: { watchlist_id: "B" } }).map((r) => r.id)).toEqual(["all"]);
  });
  it("a scoped rule with no links matches nothing", () => {
    expect(filterRulesByScope([rule("empty", "watchlist", "selected")], {}, { payload: { watchlist_id: "A" } })).toEqual([]);
  });
  it("list rules read list_id", () => {
    const r = [rule("L", "bulk_enrichment", "selected")];
    expect(filterRulesByScope(r, { L: [{ type: "list", id: "x" }] }, { payload: { list_id: "x" } })).toHaveLength(1);
    expect(filterRulesByScope(r, { L: [{ type: "list", id: "x" }] }, { payload: { watchlist_id: "x" } })).toHaveLength(0);
  });
});

describe("inUseConflict", () => {
  it("is a 409 that names every rule", () => {
    const c = inUseConflict("watchlist", [{ id: 1, name: "Pricing alerts" }, { id: 2, name: "Weekly digest" }]);
    expect(c).toMatchObject({ status: 409, code: "in_use" });
    expect(c.reason).toContain("2 rules: Pricing alerts, Weekly digest");
  });
});

describe("producers name their source", () => {
  it("every scopable trigger has an event key", () => {
    for (const type of Object.values(SOURCE_TYPE_FOR_TRIGGER)) expect(EVENT_SOURCE_KEY[type]).toBeTruthy();
  });
  it("the watchlist monitor puts watchlist_id on the change event", () => {
    const src = readFileSync(`${process.cwd()}/netlify/functions/watchlist-monitor.js`, "utf8");
    const block = src.slice(src.indexOf('kind: "monitor.change_detected"'), src.indexOf('kind: "monitor.change_detected"') + 600);
    expect(block).toMatch(/watchlist_id: watchlist\.id/);
  });
  it("the bulk scorer puts list_id on the score event", () => {
    const src = readFileSync(`${process.cwd()}/netlify/functions/lib/bulkStore.js`, "utf8");
    const block = src.slice(src.indexOf('kind: "account.score_changed"'), src.indexOf('kind: "account.score_changed"') + 500);
    expect(block).toMatch(/list_id: rec\.list_id/);
  });
});
