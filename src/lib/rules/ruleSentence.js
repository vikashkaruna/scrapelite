// src/lib/rules/ruleSentence.js — a rule, read back as one plain sentence.
//
// The builder has five controls; people check a rule by reading it, not by
// re-reading five controls. PURE, so the builder, the rule cards and the
// Workflow hub say the same thing about the same rule.
import { TRIGGER_SOURCES, ACTION_TYPES } from "./ruleModel.js";

/** Which kind of source a trigger can be limited to, or null when it cannot. */
export function scopableSourceType(triggerSource) {
  if (triggerSource === TRIGGER_SOURCES.WATCHLIST) return "watchlist";
  if (triggerSource === TRIGGER_SOURCES.BULK_ENRICHMENT) return "list";
  return null;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** "any watchlist" / "the watchlist Acme rivals" / "no watchlist yet". */
export function describeSources(triggerSource, scope, sources = []) {
  const type = scopableSourceType(triggerSource);
  if (!type) return triggerSource === TRIGGER_SOURCES.WORKFLOW_RUN ? "any template run" : "any source";
  const noun = type === "watchlist" ? "watchlist" : "account list";
  if (scope !== "selected") return `any ${noun}`;
  const names = sources.map((s) => s.name || "an unnamed source");
  if (names.length === 0) return `no ${noun} yet`;
  return `${names.length === 1 ? `the ${noun}` : `the ${noun}s`} ${joinNames(names)}`;
}

const EVENT = {
  [TRIGGER_SOURCES.WATCHLIST]: "something changes on",
  [TRIGGER_SOURCES.BULK_ENRICHMENT]: "an account is scored in",
  [TRIGGER_SOURCES.WORKFLOW_RUN]: "a run finishes in",
};

function describeAction(actionType, dest) {
  if (actionType === ACTION_TYPES.SLACK) return `post to Slack${dest ? ` ${dest}` : ""}`;
  if (actionType === ACTION_TYPES.EMAIL) return `email ${dest || "you"}`;
  if (actionType === ACTION_TYPES.WEBHOOK) return "send it to your webhook";
  if (actionType === ACTION_TYPES.HUBSPOT) return "sync the company to HubSpot";
  return "do nothing yet";
}

function describeCondition(c) {
  if (!c?.field) return "";
  if (c.operator === "not_empty") return ` and ${c.field} is set`;
  const op = { equals: "is", not_equals: "is not", gte: "is at least", lte: "is at most", contains: "contains" }[c.operator] || c.operator;
  return ` and ${c.field} ${op} ${c.value}`;
}

/**
 * One sentence for a rule, e.g.
 * "When something changes on the watchlist Acme rivals and materiality is critical, post to Slack #alerts."
 */
export function describeRule({ triggerSource, scope = "all", sources = [], condition = null, actionType, actionDest = "" }) {
  const event = EVENT[triggerSource] || "something happens in";
  return `When ${event} ${describeSources(triggerSource, scope, sources)}${describeCondition(condition)}, ${describeAction(actionType, actionDest)}.`;
}
