// AuditHistory — every audit this account has run, across every target.
//
// ── WHY THIS EXISTS SEPARATELY FROM THE "History" PANEL ────────────────────
// The panel inside a report is scoped to ONE target and only appears once that
// target has been audited twice. So a user who wanted to find a run from last
// week had to already know which URL it was against, re-audit it (spending a
// credit) and then read the panel — there was no way to answer "what have I
// audited?" at all. That is the question this answers.
//
// ── A FAILED RUN IS STILL SHOWN ───────────────────────────────────────────
// Failures are not hidden. A user who ran an audit that errored needs to see
// that it errored, not an unexplained gap in the list — and because a failed
// audit is not charged, showing it also makes the quota arithmetic legible.

import { useContext, useEffect, useMemo, useState } from "react";
import { AuthContext } from "../AuthProvider.jsx";
import { cacheKey, readCache, writeCache } from "../../lib/discoverability/tabCache.js";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { hostOf } from "../../lib/utils.js";

const PAGE_SIZE = 25;

/** PostgREST returns an embedded to-one row as either an object or a 1-element array. */
export function resultOf(row) {
  const r = row?.audit_results;
  return (Array.isArray(r) ? r[0] : r) || null;
}

export function scoreBand(score) {
  if (!Number.isFinite(score)) return "none";
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  return "poor";
}

function whenLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)}d ago`;
  return d.toLocaleDateString();
}

export default function AuditHistory({ onOpen, onClose, currentAuditId = null, workspaceId = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const cacheUserId = useContext(AuthContext)?.user?.id || null;

  useEffect(() => {
    setRows([]);
    setOffset(0);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // The first page paints from localStorage straight away; the database
    // answer then replaces it. Later pages are never cached.
    const key = cacheKey("audit-history", { userId: cacheUserId, workspaceId });
    const cached = offset === 0 ? readCache(key) : null;
    if (cached) {
      const list = cached.data?.audits || [];
      setRows(list);
      setMore(list.length === PAGE_SIZE);
    }
    setLoading(!cached);
    discoverability.listAudits({
      limit: PAGE_SIZE, offset, ...(workspaceId ? { workspace_id: workspaceId } : {}),
    })
      .then((data) => {
        if (cancelled) return;
        const list = data?.audits || [];
        if (offset === 0) writeCache(key, data);
        setRows((prev) => (offset === 0 ? list : [...prev, ...list]));
        setMore(list.length === PAGE_SIZE);
      })
      .catch((err) => { if (!cancelled) setError(err?.message || "Could not load your audit history."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [offset, workspaceId, cacheUserId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.target_url || "").toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <section className="dsc-history-page" aria-label="Audit history">
      <header className="dsc-history-page-head">
        <div>
          <h2>Audit history</h2>
          <p className="dsc-history-page-sub">
            Every discoverability audit {workspaceId ? "in this workspace" : "on this account"}. Open one to see its full report,
            or re-run it to measure a fix.
          </p>
        </div>
        <div className="dsc-history-page-actions">
          <input
            type="search"
            className="dsc-history-search"
            placeholder="Filter by URL…"
            value={query}
            aria-label="Filter audits by URL"
            onChange={(e) => setQuery(e.target.value)}
          />
          {onClose && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              <Icon name="x" size={14} /> Close
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="dsc-error" role="alert">
          <Icon name="alert-triangle" size={18} />
          <div className="dsc-error-body"><strong>Could not load history</strong><p>{error}</p></div>
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="dsc-history-empty">
          <Icon name="search" size={22} />
          <p><strong>No audits yet</strong></p>
          <p>Run your first audit and it will appear here, along with its score over time.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="dsc-history-list">
          {filtered.map((row) => {
            const res = resultOf(row);
            const score = Number(res?.final_score);
            const failed = row.status === "failed";
            const running = row.status === "running" || row.status === "queued";
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={`dsc-history-row${row.id === currentAuditId ? " is-current" : ""}`}
                  onClick={() => onOpen?.(row.id)}
                  // A failed audit has no report to open.
                  disabled={failed}
                  title={failed ? (row.error || "This audit failed") : `Open the report for ${row.target_url}`}
                >
                  <span className={`dsc-history-score-badge band-${scoreBand(score)}`}>
                    {failed ? "—" : running ? "…" : Number.isFinite(score) ? Math.round(score) : "—"}
                  </span>
                  <span className="dsc-history-main">
                    <span className="dsc-history-url">{hostOf(row.target_url) || row.target_url}</span>
                    <span className="dsc-history-path">{row.target_url}</span>
                  </span>
                  <span className="dsc-history-meta">
                    {failed && <span className="dsc-history-failed">failed</span>}
                    {running && <span className="dsc-history-running">running</span>}
                    {!failed && !running && Number.isFinite(Number(res?.critical_count)) && Number(res.critical_count) > 0 && (
                      <span className="dsc-history-crit">{res.critical_count} critical</span>
                    )}
                    <span className="dsc-history-profile">{row.audit_profile} · {row.device_profile}</span>
                    <span className="dsc-history-when">{whenLabel(row.created_at)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {loading && <p className="dsc-history-loading">Loading…</p>}

      {!loading && more && (
        <div className="dsc-history-more">
          <Button size="sm" variant="secondary" onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            Load more
          </Button>
        </div>
      )}

      {!loading && query && filtered.length === 0 && rows.length > 0 && (
        <p className="dsc-history-loading">No audits match “{query}”.</p>
      )}
    </section>
  );
}
