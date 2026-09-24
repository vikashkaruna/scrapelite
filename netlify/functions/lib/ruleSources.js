// netlify/functions/lib/ruleSources.js — which lists / watchlists a rule
// listens to (migration 0085, plan §6b).
//
// A rule's scope is 'all' (every source of its kind — the behaviour every rule
// had before 0085) or 'selected' (only the linked sources). Two invariants:
//
//   1. A SCOPED RULE NEVER WIDENS. With no linked source it matches nothing;
//      the 0085 trigger also pauses it with paused_reason 'no_sources'.
//   2. OWNERSHIP IS CHECKED, NOT TRUSTED. A source id in a request body is a
//      claim. Every id is checked against a row the caller owns, and a miss is
//      a 404 — a 403 would confirm another tenant's id exists.

/** A rule's trigger kind → the source type it can be scoped to. */
export const SOURCE_TYPE_FOR_TRIGGER = Object.freeze({
  watchlist: "watchlist",
  bulk_enrichment: "list",
});

const TABLE = { watchlist: "watchlists", list: "lists" };
const COLUMN = { watchlist: "watchlist_id", list: "list_id" };
/** The event payload key that names the source an event came from. */
export const EVENT_SOURCE_KEY = Object.freeze({ watchlist: "watchlist_id", list: "list_id" });

function normaliseSources(sources) {
  const out = [];
  const seen = new Set();
  for (const s of Array.isArray(sources) ? sources : []) {
    const type = s?.type;
    const id = String(s?.id || "").trim();
    if (!TABLE[type] || !id) continue;
    const k = `${type}:${id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type, id });
  }
  return out;
}

/**
 * Check a requested scope + sources for a rule of `triggerSource`.
 * @returns {Promise<{ok:true, scope:string, sources:{type,id,name}[]} | {ok:false, status:number, reason:string}>}
 */
export async function validateScope(db, userId, triggerSource, scope = "all", sources = []) {
  if (scope !== "all" && scope !== "selected") {
    return { ok: false, status: 400, reason: "Scope must be 'all' or 'selected'." };
  }
  if (scope === "all") return { ok: true, scope, sources: [] };

  const type = SOURCE_TYPE_FOR_TRIGGER[triggerSource];
  if (!type) {
    return { ok: false, status: 400, reason: "This kind of rule cannot be limited to chosen sources." };
  }
  const list = normaliseSources(sources);
  if (list.length === 0) {
    return { ok: false, status: 400, reason: `Choose at least one ${type === "list" ? "account list" : "watchlist"}, or listen to all of them.` };
  }
  if (list.some((s) => s.type !== type)) {
    return { ok: false, status: 400, reason: `A ${triggerSource === "watchlist" ? "watchlist" : "list"} rule can only be limited to ${type === "list" ? "account lists" : "watchlists"}.` };
  }
  const ids = list.map((s) => s.id);
  const { data, error } = await db.from(TABLE[type]).select("id,name").eq("user_id", userId).in("id", ids);
  if (error) return { ok: false, status: 500, reason: "Could not check the chosen sources." };
  const found = new Map((data || []).map((r) => [r.id, r.name]));
  if (ids.some((id) => !found.has(id))) {
    return { ok: false, status: 404, reason: "One of the chosen sources was not found." };
  }
  return { ok: true, scope, sources: list.map((s) => ({ ...s, name: found.get(s.id) })) };
}

/**
 * Make a rule's links equal `sources` (already validated). ADDS first, then
 * removes: deleting first would momentarily leave a scoped rule with no links,
 * and the 0085 trigger would pause a rule that was only changing its sources.
 * To drop every link (scope → 'all'), update the rule's scope BEFORE calling
 * this, for the same reason.
 */
export async function replaceRuleSources(db, userId, ruleId, sources) {
  const cur = await db.from("signal_rule_sources").select("id,list_id,watchlist_id").eq("rule_id", ruleId).eq("user_id", userId);
  if (cur.error) return { ok: false, reason: cur.error.message };
  const key = (type, id) => `${type}:${id}`;
  const existing = new Map((cur.data || []).map((r) => [key(r.watchlist_id ? "watchlist" : "list", r.watchlist_id || r.list_id), r.id]));
  const wanted = new Set(sources.map((s) => key(s.type, s.id)));

  const toAdd = sources.filter((s) => !existing.has(key(s.type, s.id)))
    .map((s) => ({ rule_id: ruleId, user_id: userId, [COLUMN[s.type]]: s.id }));
  if (toAdd.length) {
    const ins = await db.from("signal_rule_sources").insert(toAdd);
    if (ins.error) return { ok: false, reason: ins.error.message };
  }
  const toRemove = [...existing].filter(([k]) => !wanted.has(k)).map(([, id]) => id);
  if (toRemove.length) {
    const del = await db.from("signal_rule_sources").delete().eq("user_id", userId).in("id", toRemove);
    if (del.error) return { ok: false, reason: del.error.message };
  }
  return { ok: true };
}

/** { ruleId: [{type, id, name}] } for the given rules. Plain queries, no embeds. */
export async function sourcesForRules(db, userId, ruleIds) {
  const out = {};
  if (!ruleIds.length) return out;
  const { data, error } = await db
    .from("signal_rule_sources")
    .select("rule_id,list_id,watchlist_id")
    .eq("user_id", userId)
    .in("rule_id", ruleIds);
  if (error || !data?.length) return out;
  const names = {};
  for (const type of ["watchlist", "list"]) {
    const ids = [...new Set(data.map((r) => r[COLUMN[type]]).filter(Boolean))];
    if (!ids.length) continue;
    const res = await db.from(TABLE[type]).select("id,name").eq("user_id", userId).in("id", ids);
    for (const row of res.data || []) names[row.id] = row.name;
  }
  for (const r of data) {
    const type = r.watchlist_id ? "watchlist" : "list";
    const id = r.watchlist_id || r.list_id;
    (out[r.rule_id] ||= []).push({ type, id, name: names[id] || null });
  }
  return out;
}

/** The rules (id, name, status, scope) linked to one list or watchlist. */
export async function rulesUsingSource(db, userId, type, sourceId) {
  if (!COLUMN[type]) return [];
  const links = await db
    .from("signal_rule_sources")
    .select("rule_id")
    .eq("user_id", userId)
    .eq(COLUMN[type], sourceId);
  const ids = [...new Set((links.data || []).map((r) => r.rule_id))];
  if (links.error || !ids.length) return [];
  const { data } = await db.from("signal_rules").select("id,name,status,source_scope").eq("user_id", userId).in("id", ids);
  return data || [];
}

/** Remove one link. The 0085 trigger pauses the rule if it was the last one. */
export async function unlinkSource(db, userId, ruleId, type, sourceId) {
  if (!COLUMN[type]) return { ok: false, status: 400, reason: "Unknown source type." };
  const { error } = await db
    .from("signal_rule_sources")
    .delete()
    .eq("user_id", userId)
    .eq("rule_id", ruleId)
    .eq(COLUMN[type], sourceId);
  if (error) return { ok: false, status: 500, reason: error.message };
  return { ok: true };
}

/** Remove every link to one source (used by "unlink and delete"). */
export async function unlinkAllFromSource(db, userId, type, sourceId) {
  const { error } = await db.from("signal_rule_sources").delete().eq("user_id", userId).eq(COLUMN[type], sourceId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}

/**
 * PURE. Keep the rules an event may fire, given each rule's links.
 * A rule with scope 'all' always stays. A scoped rule stays only when the
 * event names a source it is linked to — and an event that names no source
 * matches no scoped rule (never widen).
 */
export function filterRulesByScope(rules, sourcesByRule, event) {
  return (rules || []).filter((rule) => {
    if ((rule.source_scope || "all") !== "selected") return true;
    const type = SOURCE_TYPE_FOR_TRIGGER[rule.trigger_source];
    const key = type && EVENT_SOURCE_KEY[type];
    const eventSource = key ? event?.payload?.[key] : null;
    if (!eventSource) return false;
    return (sourcesByRule[rule.id] || []).some((s) => s.type === type && s.id === eventSource);
  });
}

/** A delete refused because rules still use the source. */
export function inUseConflict(type, rules) {
  const noun = type === "watchlist" ? "watchlist" : "list";
  const names = rules.map((r) => r.name).filter(Boolean);
  return {
    ok: false,
    status: 409,
    code: "in_use",
    rules: rules.map((r) => ({ id: r.id, name: r.name })),
    reason: `This ${noun} is used by ${names.length === 1 ? "1 rule" : `${names.length} rules`}: ${names.join(", ")}. Unlink ${names.length === 1 ? "it" : "them"} first, or choose "Unlink and delete".`,
  };
}
