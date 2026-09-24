// RuleSourcesField.jsx — "Listen to: all watchlists / only these" (0085).
//
// A rule used to hear every event of its kind. This lets it hear only chosen
// lists or watchlists. Choosing "only these" with none ticked is refused by
// the server, so the Save button is the place that says so — not a silent
// rule that matches nothing.
import { useEffect, useState } from "react";
import { scopableSourceType } from "../lib/rules/ruleSentence.js";
import { listWatchlists } from "../lib/watchlist/watchlistClient.js";
import { listLists } from "../lib/bulk/bulkClient.js";

export default function RuleSourcesField({ triggerSource, scope, setScope, selected, setSelected }) {
  const type = scopableSourceType(triggerSource);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!type) return undefined;
    let cancelled = false;
    setOptions(null);
    setError("");
    const load = type === "watchlist"
      ? listWatchlists().then((r) => r.watchlists || [])
      : listLists().then((r) => r.lists || []);
    load
      .then((rows) => { if (!cancelled) setOptions(rows.map((r) => ({ type, id: r.id, name: r.name }))); })
      .catch((e) => { if (!cancelled) { setOptions([]); setError(e.message); } });
    return () => { cancelled = true; };
  }, [type]);

  if (!type) return null;
  const noun = type === "watchlist" ? "watchlist" : "account list";
  const isOn = (id) => selected.some((s) => s.id === id);
  const toggle = (opt) => setSelected(isOn(opt.id) ? selected.filter((s) => s.id !== opt.id) : [...selected, opt]);

  return (
    <div className="wf-scope">
      <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>LISTEN TO</span>
      <div className="wf-scope-options" role="radiogroup" aria-label="Which sources this rule listens to">
        <label><input type="radio" name={`scope-${triggerSource}`} checked={scope !== "selected"} onChange={() => setScope("all")} /> Every {noun}</label>
        <label><input type="radio" name={`scope-${triggerSource}`} checked={scope === "selected"} onChange={() => setScope("selected")} /> Only the {noun}s I choose</label>
      </div>
      {scope === "selected" && (
        options === null ? <div className="wf-usedby-empty">Loading your {noun}s…</div>
        : options.length === 0 ? <div className="wf-usedby-empty">{error || `You have no ${noun}s yet. Create one first, or listen to every ${noun}.`}</div>
        : (
          <div className="wf-scope-list">
            {options.map((o) => (
              <label key={o.id}><input type="checkbox" checked={isOn(o.id)} onChange={() => toggle(o)} /> {o.name || "Untitled"}</label>
            ))}
          </div>
        )
      )}
    </div>
  );
}
