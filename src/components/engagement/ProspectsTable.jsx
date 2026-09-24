// src/components/engagement/ProspectsTable.jsx — every prospect in the campaign, filterable.
//
// Split out of Engagement.jsx. "Draft AI" became "Draft email": generation is
// template slots filled from the prospect's own fields (review F-11) — calling
// it AI promised something the button does not do.

import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { PROSPECT_STATUSES, STATUS_METADATA } from "../../lib/engagement/stateMachine.js";
import { timeAgo } from "../../lib/utils.js";
import { initials } from "./KanbanBoard.jsx";

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function prospectsCsv(rows) {
  return [
    ["first_name", "last_name", "email", "phone", "company", "role", "status", "engagement_score"].join(","),
    ...rows.map((p) => [p.first_name, p.last_name, p.email, p.phone, p.company, p.role, STATUS_METADATA[p.status]?.label || p.status, p.engagement_score || 0].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ProspectsTable({ prospects = [], campaignName = "campaign", testSentIds = new Set(), onSelectProspect, onGenerateMessage, onEditProspect, initialStage = "all", busy = false }) {
  const [search, setSearch] = useState("");
  // A stage may name several statuses ("opened,clicked"), from the board's "+N more".
  const [stage, setStage] = useState(initialStage);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const stages = stage === "all" ? null : stage.split(",");
    return prospects.filter((p) => (!stages || stages.includes(p.status))
      && (!q || [p.first_name, p.last_name, p.company, p.role, p.email].some((v) => v && v.toLowerCase().includes(q))));
  }, [prospects, search, stage]);

  const exportCsv = () => downloadText(`datiq-prospects-${campaignName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, prospectsCsv(rows));

  return (
    <div className="engx-panel">
      <div className="engx-toolbar">
        <label className="engx-search">
          <Icon name="search" size={14} />
          <input type="search" placeholder="Search name, company, role or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search prospects" />
        </label>
        <div className="engx-toolbar-right">
          <select className="engx-select" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by stage">
            <option value="all">All stages</option>
            {stage.includes(",") && <option value={stage}>{stage.split(",").map((s) => STATUS_METADATA[s]?.label || s).join(" / ")}</option>}
            {Object.values(PROSPECT_STATUSES).map((s) => <option key={s} value={s}>{STATUS_METADATA[s]?.label || s}</option>)}
          </select>
          <Button type="button" variant="secondary" size="sm" icon="download" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
        </div>
      </div>

      <div className="engx-table-wrap">
        <table className="engx-table">
          <thead>
            <tr><th>Prospect</th><th>Company &amp; role</th><th>Stage</th><th className="is-num">Score</th><th>Last contact</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="engx-table-empty">{prospects.length ? "No prospects match these filters." : "No prospects yet — use Import to add some."}</td></tr>
            )}
            {rows.map((p) => {
              const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
              const meta = STATUS_METADATA[p.status] || { label: p.status };
              return (
                <tr key={p.id} tabIndex={0} className="engx-row"
                  onClick={() => onSelectProspect?.(p.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onSelectProspect?.(p.id); }}>
                  <td>
                    <div className="engx-ident">
                      <span className="engx-avatar is-sm" aria-hidden="true">{initials(p)}</span>
                      <div><div className="engx-strong">{name}</div><div className="engx-muted">{p.email || p.phone}</div></div>
                    </div>
                  </td>
                  <td><div>{p.company || "—"}</div><div className="engx-muted">{p.role || ""}</div></td>
                  <td>
                    <span className={`engx-stage is-${p.status}`}>{meta.label}</span>
                    {testSentIds.has(p.id) && <span className="engx-tag is-warn" title="Sent in test mode — nothing was delivered"><Icon name="flask" size={10} /> Test</span>}
                  </td>
                  <td className="is-num">{p.engagement_score ?? 0}</td>
                  <td className="engx-muted">{p.last_contacted_at ? timeAgo(p.last_contacted_at) : "Never"}</td>
                  <td className="is-actions">
                    {onEditProspect && (
                      <Button type="button" variant="ghost" size="sm" icon="pencil" disabled={busy} aria-label={`Edit ${name}`}
                        onClick={(e) => { e.stopPropagation(); onEditProspect(p.id); }}>
                        Edit
                      </Button>
                    )}
                    {[PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.FOLLOWUP_DUE].includes(p.status) && (
                      <Button type="button" variant="ghost" size="sm" icon="sparkles" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); onGenerateMessage?.(p.id, "email"); }}>
                        Draft email
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
