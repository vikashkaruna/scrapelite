// src/components/engagement/ProspectTimelineDrawer.jsx — Chronological Activity Audit Log Drawer
import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import FaviconDot from "../FaviconDot.jsx";
import { PROSPECT_STATUSES, STATUS_METADATA } from "../../lib/engagement/stateMachine.js";
import { fmtDate, timeAgo } from "../../lib/utils.js";

export default function ProspectTimelineDrawer({
  prospect,
  activityLogs = [],
  isOpen,
  onClose,
  onTransition,
  onAddNote,
  onGenerateMessage,
}) {
  const [noteText, setNoteText] = useState("");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(prospect?.status || "new");

  if (!isOpen || !prospect) return null;

  const currentMeta = STATUS_METADATA[prospect.status] || {
    label: prospect.status,
    color: "var(--text-3)",
    bgColor: "var(--surface)",
  };

  const fullName = `${prospect.first_name || ""} ${prospect.last_name || ""}`.trim() || prospect.email || "Prospect";

  const handleStatusChange = async (e) => {
    const newStatus = e.target.value;
    setSelectedStatus(newStatus);
    if (onTransition) {
      await onTransition(prospect.id, newStatus);
    }
  };

  const handleNoteSubmit = async (e) => {
    e.preventDefault();
    if (!noteText.trim() || !onAddNote) return;
    setIsSubmittingNote(true);
    try {
      await onAddNote(prospect.id, noteText.trim());
      setNoteText("");
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const getActivityIcon = (action) => {
    switch (action) {
      case "ingested":
        return "inbox";
      case "ai_message_generated":
      case "message_drafted":
        return "sparkles";
      case "queued":
        return "clock";
      case "dispatched":
      case "sent":
        return "send";
      case "delivered":
        return "check";
      case "opened":
      case "read":
        return "eye";
      case "clicked":
        return "external-link";
      case "replied":
        return "message-circle";
      case "status_transition":
        return "arrow-right";
      case "note_added":
        return "file-text";
      case "opted_out":
        return "slash";
      case "converted":
        return "award";
      default:
        return "activity";
    }
  };

  return (
    <div className="eng-drawer-backdrop" onClick={onClose}>
      <div className="eng-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="eng-drawer-header">
          <div className="eng-drawer-identity">
            {prospect.company && <FaviconDot domain={prospect.company} size={28} />}
            <div className="eng-drawer-names">
              <h3 className="eng-drawer-title">{fullName}</h3>
              <div className="eng-drawer-sub">
                {prospect.role && <span>{prospect.role}</span>}
                {prospect.role && prospect.company && <span>·</span>}
                {prospect.company && <span>{prospect.company}</span>}
              </div>
            </div>
          </div>
          <button className="eng-drawer-close" onClick={onClose} aria-label="Close drawer">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Prospect Status & Quick Transition Ribbon */}
        <div className="eng-drawer-ribbon">
          <div className="eng-ribbon-item">
            <span className="eng-ribbon-label">Current Stage</span>
            <select
              className="eng-status-select"
              value={prospect.status}
              onChange={handleStatusChange}
              style={{
                borderColor: currentMeta.color,
                color: currentMeta.color,
              }}
            >
              {Object.values(PROSPECT_STATUSES).map((st) => (
                <option key={st} value={st}>
                  {STATUS_METADATA[st]?.label || st}
                </option>
              ))}
            </select>
          </div>

          <div className="eng-ribbon-item">
            <span className="eng-ribbon-label">Engagement Score</span>
            <span className="eng-score-value">
              <Icon name="zap" size={12} /> {prospect.engagement_score ?? 0}
            </span>
          </div>

          <div className="eng-ribbon-item">
            <span className="eng-ribbon-label">Channel</span>
            <span className={`eng-channel-pill eng-ch-${prospect.channel_preference || "email"}`}>
              {(prospect.channel_preference || "email").toUpperCase()}
            </span>
          </div>
        </div>

        {/* Contact Info Card */}
        <div className="eng-drawer-card">
          <h4 className="eng-card-title">Contact & Attributes</h4>
          <div className="eng-attr-grid">
            {prospect.email && (
              <div className="eng-attr-row">
                <span className="eng-attr-key"><Icon name="mail" size={12} /> Email</span>
                <span className="eng-attr-val">{prospect.email}</span>
              </div>
            )}
            {prospect.phone && (
              <div className="eng-attr-row">
                <span className="eng-attr-key"><Icon name="phone" size={12} /> Phone</span>
                <span className="eng-attr-val">{prospect.phone}</span>
              </div>
            )}
            {prospect.industry && (
              <div className="eng-attr-row">
                <span className="eng-attr-key"><Icon name="briefcase" size={12} /> Industry</span>
                <span className="eng-attr-val">{prospect.industry}</span>
              </div>
            )}
            {prospect.country && (
              <div className="eng-attr-row">
                <span className="eng-attr-key"><Icon name="globe" size={12} /> Location</span>
                <span className="eng-attr-val">{prospect.country}</span>
              </div>
            )}
            <div className="eng-attr-row">
              <span className="eng-attr-key"><Icon name="calendar" size={12} /> Added</span>
              <span className="eng-attr-val">{fmtDate(prospect.created_at)}</span>
            </div>
            {prospect.last_contacted_at && (
              <div className="eng-attr-row">
                <span className="eng-attr-key"><Icon name="clock" size={12} /> Last Contacted</span>
                <span className="eng-attr-val">{timeAgo(prospect.last_contacted_at)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Quick Action: Generate AI Copy / Dispatch */}
        {onGenerateMessage && (
          <div className="eng-drawer-actions">
            <Button
              variant="secondary"
              icon="sparkles"
              onClick={() => onGenerateMessage(prospect.id, prospect.channel_preference || "email")}
            >
              Draft AI Message
            </Button>
          </div>
        )}

        {/* Add Note Form */}
        <div className="eng-note-box">
          <form onSubmit={handleNoteSubmit}>
            <input
              type="text"
              className="eng-input-field eng-note-input"
              placeholder="Log a touchpoint or note (e.g. Spoke on call, interested in demo)..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              type="submit"
              disabled={!noteText.trim() || isSubmittingNote}
              icon="plus"
            >
              Add Note
            </Button>
          </form>
        </div>

        {/* Activity Timeline */}
        <div className="eng-timeline-section">
          <h4 className="eng-timeline-heading">Activity & Audit Trail ({activityLogs.length})</h4>
          {activityLogs.length === 0 ? (
            <div className="eng-timeline-empty">No activity events recorded yet.</div>
          ) : (
            <div className="eng-timeline-list">
              {activityLogs.map((log) => {
                const iconName = getActivityIcon(log.action);
                return (
                  <div key={log.id || log.created_at} className="eng-timeline-item">
                    <div className="eng-timeline-icon-wrap">
                      <Icon name={iconName} size={13} />
                    </div>
                    <div className="eng-timeline-content">
                      <div className="eng-timeline-top">
                        <span className="eng-timeline-action">
                          {log.action?.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span className="eng-timeline-time">{timeAgo(log.created_at)}</span>
                      </div>
                      {log.details && (
                        <div className="eng-timeline-details">
                          {typeof log.details === "string" ? log.details : JSON.stringify(log.details)}
                        </div>
                      )}
                      {log.payload?.subject && (
                        <div className="eng-timeline-subject">"{log.payload.subject}"</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
