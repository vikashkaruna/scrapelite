// src/components/engagement/ProspectTimelineDrawer.jsx — one prospect: who they
// are, whether we may contact them, what has happened, and a note.
//
// The timeline reads the log's real columns (`event_type`, `timestamp`) through
// describeActivity(); it used to read `action`/`created_at`, which do not
// exist, and showed "Invalid Date" over raw JSON for every entry.

import { useEffect, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { PROSPECT_STATUSES, STATUS_METADATA, isValidTransition } from "../../lib/engagement/stateMachine.js";
import { fmtDate, timeAgo } from "../../lib/utils.js";
import { describeActivity, activityTime } from "../../lib/engagement/activityCopy.js";
import ConsentPanel from "./ConsentPanel.jsx";
import { initials } from "./KanbanBoard.jsx";

const MANUAL = [PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.QUEUED, PROSPECT_STATUSES.REPLIED,
  PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.CONVERTED, PROSPECT_STATUSES.UNRESPONSIVE];

export default function ProspectTimelineDrawer({
  prospect, activityLogs = [], isOpen, onClose, onTransition, onAddNote, onGenerateMessage,
  suppressions = [], onOptOut, onLiftSuppression, onEdit, consentBusy = false, busy = false,
}) {
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);
  useEffect(() => { setNote(""); }, [prospect?.id]);

  if (!isOpen || !prospect) return null;

  const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || prospect.email || "Prospect";
  // Only stages a person may set — delivery stages come from real events, and
  // opting out is per channel in the consent panel.
  const stageOptions = Object.values(PROSPECT_STATUSES).filter((s) => s === prospect.status
    || (MANUAL.includes(s) && isValidTransition(prospect.status, s)));

  const saveNote = async (e) => {
    e.preventDefault();
    const text = note.trim();
    if (!text || !onAddNote) return;
    setSavingNote(true);
    try {
      const ok = await onAddNote(prospect.id, text);
      if (ok !== false) setNote("");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="engx-drawer-backdrop" onClick={onClose}>
      <aside className="engx-drawer" role="dialog" aria-modal="true" aria-labelledby="engx-drawer-title" onClick={(e) => e.stopPropagation()}>
        <header className="engx-drawer-head">
          <span className="engx-avatar is-lg" aria-hidden="true">{initials(prospect)}</span>
          <div className="engx-drawer-id">
            <h3 id="engx-drawer-title">{name}</h3>
            <p>{[prospect.role, prospect.company].filter(Boolean).join(" · ") || prospect.email}</p>
          </div>
          {onEdit && (
            <button type="button" className="engx-icon-btn" onClick={() => onEdit(prospect.id)} disabled={busy} aria-label="Edit prospect" title="Edit details">
              <Icon name="pencil" size={16} />
            </button>
          )}
          <button type="button" className="engx-icon-btn" onClick={onClose} aria-label="Close drawer"><Icon name="x" size={18} /></button>
        </header>

        <div className="engx-drawer-body">
          <div className="engx-drawer-facts">
            <label className="engx-fact">
              <span>Stage</span>
              <select className="engx-select" value={prospect.status} disabled={busy}
                onChange={(e) => e.target.value !== prospect.status && onTransition?.(prospect.id, e.target.value)}>
                {stageOptions.map((s) => <option key={s} value={s}>{STATUS_METADATA[s]?.label || s}</option>)}
              </select>
            </label>
            <div className="engx-fact"><span>Score</span><strong><Icon name="zap" size={12} /> {prospect.engagement_score ?? 0}</strong></div>
            <div className="engx-fact"><span>Added</span><strong>{prospect.created_at ? fmtDate(prospect.created_at) : "—"}</strong></div>
            <div className="engx-fact"><span>Last contact</span><strong>{prospect.last_contacted_at ? timeAgo(prospect.last_contacted_at) : "Never"}</strong></div>
          </div>

          <section className="engx-drawer-section">
            <h4>Contact</h4>
            <dl className="engx-dl">
              {prospect.email && <><dt><Icon name="mail" size={12} /> Email</dt><dd>{prospect.email}</dd></>}
              {prospect.phone && <><dt><Icon name="phone" size={12} /> Phone</dt><dd>{prospect.phone}</dd></>}
              {prospect.industry && <><dt><Icon name="briefcase" size={12} /> Industry</dt><dd>{prospect.industry}</dd></>}
              {prospect.country && <><dt><Icon name="globe" size={12} /> Country</dt><dd>{prospect.country}</dd></>}
            </dl>
            {onGenerateMessage && (
              <Button type="button" variant="secondary" size="sm" icon="sparkles" disabled={busy} onClick={() => onGenerateMessage(prospect.id, "email")}>
                Draft email
              </Button>
            )}
          </section>

          <ConsentPanel
            prospect={prospect}
            suppressions={suppressions}
            onOptOut={onOptOut ? (channels, n) => onOptOut(prospect.id, channels, n) : undefined}
            onLift={onLiftSuppression}
            busy={consentBusy}
          />

          <section className="engx-drawer-section">
            <h4>Add a note</h4>
            <form className="engx-note" onSubmit={saveNote}>
              <textarea
                rows={2}
                maxLength={1000}
                placeholder="Log a call, a meeting or anything worth remembering"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Note"
              />
              <Button type="submit" variant="primary" size="sm" icon="plus" disabled={!note.trim() || savingNote}>
                {savingNote ? "Saving…" : "Save note"}
              </Button>
            </form>
          </section>

          <section className="engx-drawer-section">
            <h4>Activity <span className="engx-count">{activityLogs.length}</span></h4>
            {activityLogs.length === 0 ? (
              <p className="engx-muted">Nothing has happened yet.</p>
            ) : (
              <ol className="engx-timeline">
                {activityLogs.map((log, i) => {
                  const a = describeActivity(log);
                  return (
                    <li key={log.id || i} className={`engx-tl-item is-${a.tone}`}>
                      <span className="engx-tl-icon" aria-hidden="true"><Icon name={a.icon} size={12} /></span>
                      <div className="engx-tl-body">
                        <div className="engx-tl-top">
                          <strong>{a.title}</strong>
                          <time dateTime={a.at || undefined} title={a.at ? new Date(a.at).toLocaleString() : undefined}>{activityTime(a.at)}</time>
                        </div>
                        {a.detail && <p className={a.tone === "note" ? "engx-tl-note" : "engx-tl-detail"}>{a.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
