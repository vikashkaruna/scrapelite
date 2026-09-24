// UsedByRules.jsx — which rules listen to this list or watchlist (0085).
//
// Shown on a watchlist's and a list's detail view. Without it a source can be
// deleted, renamed or emptied with no hint that a rule depends on it; with it,
// the dependency is visible where the change is made, and can be undone there.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import Button from "./Button.jsx";
import * as rulesApi from "../lib/rules/rulesClient.js";

export default function UsedByRules({ sourceType, sourceId, busy = false, run, onChanged }) {
  const [rules, setRules] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    rulesApi.rulesForSource(sourceType, sourceId)
      .then((r) => { if (!cancelled) setRules(r); })
      .catch(() => { if (!cancelled) setRules([]); });
    return () => { cancelled = true; };
  }, [sourceType, sourceId]);

  useEffect(() => load(), [load]);

  const unlink = async (rule) => {
    const go = async () => {
      await rulesApi.unlinkSource(rule.id, sourceType, sourceId);
      load();
      onChanged?.(rule);
    };
    return run ? run(`Unlinking ${rule.name}…`, go) : go();
  };

  if (rules === null) return null;
  const noun = sourceType === "watchlist" ? "watchlist" : "list";
  return (
    <section className="wf-usedby" aria-label="Rules that use this source">
      <h3 className="wf-usedby-h">Used by rules</h3>
      {rules.length === 0 ? (
        <p className="wf-usedby-empty">
          No rule listens only to this {noun}. Rules set to “every {noun}” still hear it. <Link to="/rules">Open rules</Link>
        </p>
      ) : rules.map((r) => (
        <div key={r.id} className="wf-usedby-row">
          <span>
            {r.name}
            {r.status === "paused" && <span className="wf-chip wf-chip-warn" style={{ marginLeft: 6 }}>Paused</span>}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <Link to="/rules" className="btn btn-ghost btn-sm">Open</Link>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => unlink(r)}>Unlink</Button>
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * The body of the "rules still use this" dialog. Kept here so the watchlist
 * and list pages say it the same way.
 */
export function InUseMessage({ noun, rules = [] }) {
  return (
    <>
      <p style={{ margin: 0 }}>
        {rules.length === 1 ? "A rule still listens" : `${rules.length} rules still listen`} to this {noun}.
        Deleting it would leave {rules.length === 1 ? "that rule" : "them"} with nothing to hear — a rule with no
        sources left is paused, never widened to everything.
      </p>
      <ul>{rules.map((r) => <li key={r.id}>{r.name}</li>)}</ul>
    </>
  );
}
