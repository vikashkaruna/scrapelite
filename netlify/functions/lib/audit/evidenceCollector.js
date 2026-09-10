// evidenceCollector.js — the thing an analyser records its workings into.
//
// SERVER ONLY. The record SHAPE is pure and lives in
// src/lib/discoverability/evidenceModel.js, shared with React; this is the
// small mutable collector the four analysers write to while they work, and it
// has no business in a browser bundle.
//
// ── WHY A COLLECTOR AND NOT A RETURN VALUE ─────────────────────────────────
// An analyser computes a signal in one place and raises an issue about it
// twenty lines later. Threading an evidence array through both by hand means
// every new check has to remember to do it, and the ones that forget produce a
// finding with no provenance — which is precisely the state this workstream
// exists to end. A collector lets the analyser record the observation AT THE
// POINT IT IS MADE, and lets the issue inherit it automatically from the signal
// it names.
//
// ── THE INHERITANCE RULE, AND ITS ONE EXCEPTION ────────────────────────────
// An issue carries `signalCode`, so `evidenceFor(code)` gives it the same
// observations that produced the score. That is right almost always: "the
// heading tree scored 40" and "this page skips heading levels" are two readings
// of one observation. The exception is an issue that observes something the
// signal did not — a schema block that parses but names the wrong entity, say —
// and `note()` exists for exactly that: extra evidence attached to the ISSUE
// code rather than the signal.
//
// ── FAILURE IS ALWAYS SILENT HERE ──────────────────────────────────────────
// `makeEvidence` returns null for anything it will not vouch for, and this
// collector drops nulls without comment. An analyser must never be able to fail
// an audit because a `section` string was undefined. The finding still stands;
// it is simply less well supported, and `evidenceConfidence` reports that
// honestly rather than the audit 500ing on a cosmetic defect.

import { makeEvidence } from "../../../../src/lib/discoverability/evidenceModel.js";

/**
 * @param {object} opts
 * @param {string} opts.url          the audited URL — the default source for every record
 * @param {number|string|Date} opts.collectedAt  injected clock; the model has none
 */
export function createEvidenceCollector({ url, collectedAt } = {}) {
  /** @type {Map<string, object[]>} keyed by signal code OR issue code */
  const bySignal = new Map();
  const byIssue = new Map();

  function push(map, key, spec) {
    if (!key) return null;
    const record = makeEvidence({
      sourceUrl: spec.sourceUrl || url,
      collectedAt: spec.collectedAt ?? collectedAt,
      ...spec,
    });
    if (!record) return null;                     // see the header: always silent
    const list = map.get(key) || [];
    list.push(record);
    map.set(key, list);
    return record;
  }

  return {
    /**
     * Record how a signal's value was arrived at.
     *
     * @param {string} signalCode  a code from signalRegistry.js
     * @param {object} spec        everything makeEvidence takes bar url/collectedAt
     */
    signal(signalCode, spec = {}) {
      return push(bySignal, signalCode, spec);
    },

    /**
     * Record something an ISSUE saw that its signal did not.
     *
     * Use sparingly — most issues should inherit from their signal. This is for
     * the case where the finding rests on a different observation entirely.
     */
    note(issueCode, spec = {}) {
      return push(byIssue, issueCode, spec);
    },

    /** Every record for one signal, newest last. */
    evidenceFor(signalCode) {
      return [...(bySignal.get(signalCode) || [])];
    },

    /**
     * Everything supporting one issue: its signal's observations, then its own.
     *
     * Signal evidence comes first because it is the broader reading; an issue's
     * own note is the specific thing that turned that reading into a finding,
     * and a reader follows the narrowing rather than the widening.
     */
    evidenceForIssue(issueCode, signalCode) {
      return [
        ...(signalCode ? (bySignal.get(signalCode) || []) : []),
        ...(byIssue.get(issueCode) || []),
      ];
    },

    /** The whole signal map, for merging across analysers. */
    signalMap() {
      return Object.fromEntries(bySignal);
    },

    /** The whole issue map, for merging across analysers. */
    issueMap() {
      return Object.fromEntries(byIssue);
    },
  };
}

/**
 * A collector that records nothing.
 *
 * Every analyser takes its collector from `ctx`, and every analyser has tests
 * that call it with a bare `{}`. Rather than make each one guard every call
 * site with `ctx.evidence?.signal?.(…)` — which is four chances per analyser to
 * write the optional chain wrongly and silently stop recording — an absent
 * collector becomes this one. The analyser code stays unconditional and the
 * tests stay short.
 */
export function nullEvidenceCollector() {
  const empty = [];
  return {
    signal: () => null,
    note: () => null,
    evidenceFor: () => empty,
    evidenceForIssue: () => empty,
    signalMap: () => ({}),
    issueMap: () => ({}),
  };
}

/** Merge the per-analyser maps the pipeline collects into one. */
export function mergeEvidenceMaps(maps = []) {
  const out = {};
  for (const map of maps) {
    for (const [key, list] of Object.entries(map || {})) {
      out[key] = [...(out[key] || []), ...list];
    }
  }
  return out;
}
