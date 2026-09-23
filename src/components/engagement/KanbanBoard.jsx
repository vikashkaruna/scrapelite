// src/components/engagement/KanbanBoard.jsx — the campaign pipeline, one column per stage.
//
// Stages move by EVENTS (a send, a delivery webhook, a reply) — the only moves a
// person makes here are the ones only a person can know about: they replied,
// they converted, follow up now. There is deliberately no "mark Sent".
//
// Channel filters are gone: email is the only live channel, and chips for
// WhatsApp/Telegram/SMS filtered to nothing while implying those channels work.

import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import { PROSPECT_STATUSES as S } from "../../lib/engagement/stateMachine.js";

const COLUMNS = [
  { id: "new", title: "New", statuses: [S.NEW], icon: "inbox" },
  { id: "queued", title: "Queued", statuses: [S.QUEUED], icon: "clock" },
  { id: "sent", title: "Sent", statuses: [S.SENT], icon: "send" },
  { id: "delivered", title: "Delivered", statuses: [S.DELIVERED], icon: "check" },
  { id: "engaged", title: "Opened / clicked", statuses: [S.OPENED, S.CLICKED], icon: "eye" },
  { id: "replied", title: "Replied", statuses: [S.REPLIED], icon: "message-circle" },
  { id: "followup", title: "Follow-up due", statuses: [S.FOLLOWUP_DUE], icon: "refresh-cw" },
  { id: "converted", title: "Converted", statuses: [S.CONVERTED], icon: "thumbs-up" },
  { id: "closed", title: "Closed / opted out", statuses: [S.UNRESPONSIVE, S.OPTED_OUT], icon: "slash" },
];

/** The one move a person can make from each stage, if any. */
function nextMove(status) {
  if (status === S.NEW) return { kind: "draft", label: "Draft email", icon: "sparkles" };
  if ([S.SENT, S.DELIVERED, S.OPENED, S.CLICKED].includes(status)) return { kind: "move", to: S.REPLIED, label: "They replied", icon: "message-circle" };
  if (status === S.REPLIED) return { kind: "move", to: S.CONVERTED, label: "Converted", icon: "thumbs-up" };
  if (status === S.FOLLOWUP_DUE) return { kind: "move", to: S.QUEUED, label: "Follow up", icon: "refresh-cw" };
  return null;
}

export const initials = (p) => {
  const a = (p.first_name || p.email || "?").trim()[0] || "?";
  const b = (p.last_name || "").trim()[0] || "";
  return (a + b).toUpperCase();
};

export default function KanbanBoard({ prospects = [], testSentIds = new Set(), onTransition, onSelectProspect, onGenerateMessage, busy = false }) {
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState(null);

  const columns = useMemo(() => {
    const q = search.trim().toLowerCase();
    const shown = q
      ? prospects.filter((p) => [p.first_name, p.last_name, p.company, p.role, p.email].some((v) => v && v.toLowerCase().includes(q)))
      : prospects;
    return COLUMNS.map((c) => ({ ...c, items: shown.filter((p) => c.statuses.includes(p.status)) }));
  }, [prospects, search]);

  const act = async (e, p, move) => {
    e.stopPropagation();
    setMoving(p.id);
    try {
      if (move.kind === "draft") await onGenerateMessage?.(p.id, "email");
      else await onTransition?.(p.id, move.to);
    } finally {
      setMoving(null);
    }
  };

  return (
    <div className="engx-board">
      <div className="engx-toolbar">
        <label className="engx-search">
          <Icon name="search" size={14} />
          <input type="search" placeholder="Search name, company, role or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search prospects" />
        </label>
        <span className="engx-toolbar-note">Stages advance on real sends and delivery events; replies and conversions are yours to mark. Scroll sideways for every stage.</span>
      </div>

      <div className="engx-columns" role="list" aria-label="Pipeline">
        {columns.map((col) => (
          <section key={col.id} className="engx-col" role="listitem" aria-label={`${col.title}: ${col.items.length}`}>
            <header className="engx-col-head">
              <Icon name={col.icon} size={14} />
              <span className="engx-col-title">{col.title}</span>
              <span className="engx-count">{col.items.length}</span>
            </header>
            <div className="engx-col-body">
              {col.items.length === 0 && <p className="engx-col-empty">None</p>}
              {col.items.map((p) => {
                const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Unnamed";
                const move = nextMove(p.status);
                return (
                  <article
                    key={p.id}
                    className="engx-card"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${name}`}
                    onClick={() => onSelectProspect?.(p.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectProspect?.(p.id); } }}
                  >
                    <div className="engx-card-top">
                      <span className="engx-avatar" aria-hidden="true">{initials(p)}</span>
                      <div className="engx-card-id">
                        <strong className="engx-card-name">{name}</strong>
                        <span className="engx-card-sub">{[p.role, p.company].filter(Boolean).join(" · ") || p.email}</span>
                      </div>
                      {p.engagement_score > 0 && <span className="engx-score" title="Engagement score"><Icon name="zap" size={10} />{p.engagement_score}</span>}
                    </div>
                    {(testSentIds.has(p.id) || move) && (
                      <div className="engx-card-foot">
                        {testSentIds.has(p.id) && <span className="engx-tag is-warn" title="Sent in test mode — nothing was delivered"><Icon name="flask" size={10} /> Test send</span>}
                        {move && (
                          <button type="button" className="engx-card-action" disabled={busy || moving === p.id} onClick={(e) => act(e, p, move)}>
                            <Icon name={move.icon} size={11} /> {move.label}
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
