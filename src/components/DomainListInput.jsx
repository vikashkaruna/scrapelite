// DomainListInput — a multi-line domain box that accepts COMPANY NAMES too.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
// The single-domain field on a template already resolved a typed company name
// to a domain (DomainField in Templates.jsx). The MULTI-domain box — the one
// Bulk ICP Account Enrichment and Lists both use, and the one people actually
// paste into — was a bare <textarea>. So the smart path was on the input where
// a user types one thing, and absent from the input where they paste fifty.
//
// That asymmetry matters more than it sounds: a RevOps user's source list is
// almost always company NAMES out of a CRM export, not domains. Making them
// hand-resolve fifty names before the tool will look at them is most of the
// work the tool exists to remove.
//
// ── THE RULE THIS FOLLOWS ──────────────────────────────────────────────────
// Resolution is SUGGESTED, never silently applied. `candidateDomains()` is a
// heuristic over a company name and it will sometimes be confidently wrong —
// "Apple" is not necessarily apple.com for a user tracking a local retailer.
// Enriching the wrong company produces firmographics that look perfectly valid
// and describe somebody else, which is the expensive failure here: it is the
// same "invented data that reads as observed" shape the bulk enricher already
// had to be rebuilt to avoid. So every resolution is shown with its confidence
// and applied only on an explicit click.
import { useMemo, useState } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import * as api from "../lib/templates/templatesClient.js";

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Split a pasted blob into lines, tolerating commas and stray whitespace. */
export function splitEntries(raw) {
  return String(raw || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Which entries are already domains, and which look like company names. */
export function partitionEntries(raw) {
  const entries = splitEntries(raw);
  const domains = [];
  const names = [];
  for (const e of entries) {
    // A bare "acme" is ambiguous; treat anything without a dot as a name, which
    // is the reading that leads to a suggestion rather than a failed fetch.
    if (DOMAIN_RE.test(e.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))) domains.push(e);
    else names.push(e);
  }
  return { entries, domains, names };
}

export default function DomainListInput({ id, value, onChange, rows = 5, placeholder }) {
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(null); // [{ name, domain, confidence }]
  const [unresolved, setUnresolved] = useState([]);

  const { entries, domains, names } = useMemo(() => partitionEntries(value), [value]);

  async function resolveNames() {
    if (names.length === 0) return;
    setResolving(true);
    setResolved(null);
    setUnresolved([]);
    const hits = [];
    const misses = [];
    // Sequential on purpose: each resolution is a real fetch of a candidate
    // domain, and firing fifty at once at someone else's origin is the kind of
    // thing that gets a shared egress IP blocked — the same reasoning behind
    // the per-host rate limiter in the extract path.
    for (const name of names) {
      try {
        const r = await api.resolveCompany(name);
        if (r?.best?.domain) hits.push({ name, domain: r.best.domain, confidence: r.best.confidence ?? null });
        else misses.push(name);
      } catch {
        // A failed lookup is not an error worth showing — the user can type the
        // domain, which is what they would have done anyway.
        misses.push(name);
      }
    }
    setResolved(hits);
    setUnresolved(misses);
    setResolving(false);
  }

  /** Apply every suggestion, replacing the NAME line with its domain. */
  function applyAll() {
    if (!resolved?.length) return;
    const map = new Map(resolved.map((r) => [r.name.toLowerCase(), r.domain]));
    const next = entries.map((e) => map.get(e.toLowerCase()) || e);
    onChange(next.join("\n"));
    setResolved(null);
    setUnresolved([]);
  }

  /** Apply one, so a user can take the domains they trust and fix the rest. */
  function applyOne(hit) {
    const next = entries.map((e) => (e.toLowerCase() === hit.name.toLowerCase() ? hit.domain : e));
    onChange(next.join("\n"));
    setResolved((prev) => (prev || []).filter((r) => r.name !== hit.name));
  }

  return (
    <div className="dli">
      <textarea
        id={id}
        rows={rows}
        value={value ?? ""}
        placeholder={placeholder || "acme.com — or paste company names, one per line"}
        onChange={(e) => { onChange(e.target.value); setResolved(null); setUnresolved([]); }}
      />

      <div className="dli-bar">
        <span className="dli-count">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          {domains.length ? ` · ${domains.length} domain${domains.length === 1 ? "" : "s"}` : ""}
          {names.length ? ` · ${names.length} name${names.length === 1 ? "" : "s"}` : ""}
        </span>
        {names.length > 0 && (
          <Button variant="ghost" size="sm" onClick={resolveNames} disabled={resolving}>
            <Icon name={resolving ? "loader" : "search"} size={13} className={resolving ? "spin" : undefined} />
            {resolving ? `Looking up ${names.length}…` : `Find domains for ${names.length} name${names.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {resolved && resolved.length > 0 && (
        <div className="dli-suggest">
          <div className="dli-suggest-head">
            <span>Found {resolved.length} — review before applying</span>
            <Button variant="secondary" size="sm" onClick={applyAll}>Use all</Button>
          </div>
          <ul className="dli-list">
            {resolved.map((r) => (
              <li key={r.name}>
                <span className="dli-name">{r.name}</span>
                <Icon name="arrow-right" size={12} />
                <span className="dli-domain">{r.domain}</span>
                {r.confidence != null && <span className="dli-conf">{Math.round(r.confidence * 100)}%</span>}
                <button type="button" className="dli-use" onClick={() => applyOne(r)}>Use</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unresolved.length > 0 && (
        // Named, not silently dropped. A name we could not resolve is the
        // user's to fix, and they can only fix what we tell them about.
        <p className="dli-missed">
          <Icon name="alert-circle" size={13} />
          No confident match for: {unresolved.join(", ")}. Enter these as domains.
        </p>
      )}
    </div>
  );
}
