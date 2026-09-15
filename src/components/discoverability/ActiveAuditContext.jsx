// ActiveAuditContext.jsx — the one-line "which audit am I working on" bar.
//
// Shows the audit's short id in brackets plus the facts that make it
// recognisable at a glance: domain · profile · device · page type · date/time.
// A bare uuid told nobody which of their twenty audits the tab was scoped to.
//
// The summary comes from, in order: the audit already held by the page, the
// copy remembered in localStorage for this user/workspace, then the database
// (GET /audits/:id), which also refreshes the remembered copy.

import { useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import Icon from "../Icon.jsx";
import { AuthContext } from "../AuthProvider.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import {
  summarizeAudit, formatAuditContext, rememberActiveAudit, readActiveAudit,
} from "../../lib/discoverability/tabCache.js";

export default function ActiveAuditContext({
  auditId,
  audit = null,
  workspaceId = null,
  showReturnLink = true,
}) {
  const userId = useContext(AuthContext)?.user?.id || null;
  const ctx = { userId, workspaceId };
  const fromProp = audit ? summarizeAudit(audit) : null;
  const remembered = readActiveAudit(ctx);
  const initial = fromProp && fromProp.id === auditId
    ? fromProp
    : remembered?.id === auditId ? remembered : null;
  const [summary, setSummary] = useState(initial);

  useEffect(() => {
    if (!auditId) return undefined;
    const held = audit ? summarizeAudit(audit) : null;
    if (held && held.id === auditId && held.domain) {
      setSummary(held);
      rememberActiveAudit({ userId, workspaceId }, held);
      return undefined;
    }
    let alive = true;
    discoverability.getAudit(auditId, { workspaceId })
      .then((res) => {
        const fresh = summarizeAudit(res);
        if (!alive || !fresh) return;
        setSummary(fresh);
        rememberActiveAudit({ userId, workspaceId }, fresh);
      })
      .catch(() => { /* the bar degrades to the id alone */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, audit?.auditId, audit?.audit?.id, workspaceId, userId]);

  if (!auditId) return null;
  const shortId = String(auditId).slice(0, 8);
  const line = formatAuditContext(summary);

  return (
    <div className="dsc-active-audit-banner" data-testid="active-audit-context">
      <div className="dsc-active-audit-info" style={{ minWidth: 0 }}>
        <Icon name="scan-search" size={16} className="text-accent" />
        <span style={{ minWidth: 0 }}>
          Active audit <code title={auditId}>({shortId})</code>
          {line ? <span className="dsc-active-audit-facts"> {line}</span> : null}
        </span>
      </div>
      {showReturnLink && (
        <Link to={`/discoverability?audit=${encodeURIComponent(auditId)}`} className="btn btn-ghost btn-sm">
          Return to Audit Report &rarr;
        </Link>
      )}
    </div>
  );
}
