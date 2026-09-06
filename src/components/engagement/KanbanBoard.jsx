// src/components/engagement/KanbanBoard.jsx — Interactive Outreach Pipeline Kanban Board
import { useState, useMemo } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import FaviconDot from "../FaviconDot.jsx";
import { PROSPECT_STATUSES, STATUS_METADATA } from "../../lib/engagement/stateMachine.js";

const KANBAN_COLUMNS = [
  { id: "col_new", title: "New", statuses: [PROSPECT_STATUSES.NEW], icon: "inbox" },
  { id: "col_queued", title: "Queued", statuses: [PROSPECT_STATUSES.QUEUED], icon: "clock" },
  { id: "col_sent", title: "Sent", statuses: [PROSPECT_STATUSES.SENT], icon: "send" },
  { id: "col_delivered", title: "Delivered", statuses: [PROSPECT_STATUSES.DELIVERED], icon: "check" },
  { id: "col_engaged", title: "Opened / Clicked", statuses: [PROSPECT_STATUSES.OPENED, PROSPECT_STATUSES.CLICKED], icon: "eye" },
  { id: "col_replied", title: "Replied", statuses: [PROSPECT_STATUSES.REPLIED], icon: "message-circle" },
  { id: "col_followup", title: "Follow-up Due", statuses: [PROSPECT_STATUSES.FOLLOWUP_DUE], icon: "phone-call" },
  { id: "col_converted", title: "Converted", statuses: [PROSPECT_STATUSES.CONVERTED], icon: "thumbs-up" },
  { id: "col_unresponsive", title: "Closed / Opted Out", statuses: [PROSPECT_STATUSES.UNRESPONSIVE, PROSPECT_STATUSES.OPTED_OUT], icon: "thumbs-down" },
];

export default function KanbanBoard({
  prospects = [],
  onTransition,
  onSelectProspect,
  onGenerateMessage,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("all");
  const [transitioningId, setTransitioningId] = useState(null);

  const filteredProspects = useMemo(() => {
    return prospects.filter((p) => {
      if (selectedChannel !== "all" && p.channel_preference !== selectedChannel) {
        return false;
      }
      if (!searchTerm) return true;
      const s = searchTerm.toLowerCase();
      return (
        (p.first_name && p.first_name.toLowerCase().includes(s)) ||
        (p.last_name && p.last_name.toLowerCase().includes(s)) ||
        (p.company && p.company.toLowerCase().includes(s)) ||
        (p.role && p.role.toLowerCase().includes(s)) ||
        (p.email && p.email.toLowerCase().includes(s))
      );
    });
  }, [prospects, searchTerm, selectedChannel]);

  const columnsData = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => {
      const items = filteredProspects.filter((p) => col.statuses.includes(p.status));
      return { ...col, items };
    });
  }, [filteredProspects]);

  const handleQuickMove = async (e, prospect, nextStatus) => {
    e.stopPropagation();
    if (!onTransition) return;
    setTransitioningId(prospect.id);
    try {
      await onTransition(prospect.id, nextStatus);
    } finally {
      setTransitioningId(null);
    }
  };

  return (
    <div className="eng-kanban-root">
      {/* Controls: Search & Channel Filter */}
      <div className="eng-kanban-controls">
        <div className="eng-search-box">
          <Icon name="search" size={14} className="eng-search-icon" />
          <input
            type="text"
            placeholder="Search prospects by name, company, role, email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="eng-input-field"
          />
          {searchTerm && (
            <button className="eng-clear-search" onClick={() => setSearchTerm("")}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>

        <div className="eng-channel-chips">
          {["all", "email", "whatsapp", "telegram", "sms"].map((ch) => (
            <button
              key={ch}
              className={`eng-filter-chip ${selectedChannel === ch ? "active" : ""}`}
              onClick={() => setSelectedChannel(ch)}
            >
              {ch === "all" ? "All Channels" : ch.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Columns Grid */}
      <div className="eng-kanban-grid">
        {columnsData.map((col) => (
          <div key={col.id} className="eng-column">
            <div className="eng-col-header">
              <div className="eng-col-title">
                <Icon name={col.icon} size={14} />
                <span>{col.title}</span>
              </div>
              <span className="eng-col-count">{col.items.length}</span>
            </div>

            <div className="eng-col-body">
              {col.items.length === 0 ? (
                <div className="eng-col-empty">
                  <span>No prospects</span>
                </div>
              ) : (
                col.items.map((prospect) => {
                  const meta = STATUS_METADATA[prospect.status] || {};
                  const fullName = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || "Unnamed Prospect";

                  return (
                    <div
                      key={prospect.id}
                      className="eng-card"
                      onClick={() => onSelectProspect && onSelectProspect(prospect)}
                    >
                      <div className="eng-card-top">
                        <div className="eng-card-identity">
                          <FaviconDot domain={prospect.company || "datiq.app"} />
                          <div className="eng-card-names">
                            <strong className="eng-name">{fullName}</strong>
                            <span className="eng-company">{prospect.company || "Unknown Company"}</span>
                          </div>
                        </div>
                        {prospect.engagement_score > 0 && (
                          <span className="eng-score-pill" title="Engagement score">
                            <Icon name="zap" size={10} />
                            {prospect.engagement_score}
                          </span>
                        )}
                      </div>

                      {prospect.role && (
                        <div className="eng-card-role">
                          <Icon name="briefcase" size={11} />
                          <span>{prospect.role}</span>
                        </div>
                      )}

                      <div className="eng-card-footer">
                        <span className="eng-channel-badge" title={`Channel: ${prospect.channel_preference}`}>
                          <Icon
                            name={
                              prospect.channel_preference === "whatsapp"
                                ? "message-circle"
                                : prospect.channel_preference === "sms"
                                ? "phone"
                                : "mail"
                            }
                            size={11}
                          />
                          {prospect.channel_preference || "auto"}
                        </span>

                        {/* Quick action buttons based on status */}
                        <div className="eng-card-actions">
                          {prospect.status === PROSPECT_STATUSES.NEW && (
                            <button
                              className="eng-action-btn"
                              title="Draft AI personalized message"
                              onClick={(e) => {
                                e.stopPropagation();
                                onGenerateMessage && onGenerateMessage(prospect);
                              }}
                            >
                              <Icon name="wand" size={11} /> Draft
                            </button>
                          )}

                          {prospect.status === PROSPECT_STATUSES.QUEUED && (
                            <button
                              className="eng-action-btn primary"
                              title="Mark Dispatched / Sent"
                              disabled={transitioningId === prospect.id}
                              onClick={(e) => handleQuickMove(e, prospect, PROSPECT_STATUSES.SENT)}
                            >
                              <Icon name="send" size={11} /> Sent
                            </button>
                          )}

                          {prospect.status === PROSPECT_STATUSES.SENT && (
                            <button
                              className="eng-action-btn"
                              title="Mark Delivered"
                              disabled={transitioningId === prospect.id}
                              onClick={(e) => handleQuickMove(e, prospect, PROSPECT_STATUSES.DELIVERED)}
                            >
                              <Icon name="check" size={11} /> Delivered
                            </button>
                          )}

                          {(prospect.status === PROSPECT_STATUSES.DELIVERED ||
                            prospect.status === PROSPECT_STATUSES.OPENED ||
                            prospect.status === PROSPECT_STATUSES.CLICKED) && (
                            <button
                              className="eng-action-btn success"
                              title="Mark Replied"
                              disabled={transitioningId === prospect.id}
                              onClick={(e) => handleQuickMove(e, prospect, PROSPECT_STATUSES.REPLIED)}
                            >
                              <Icon name="message-circle" size={11} /> Replied
                            </button>
                          )}

                          {prospect.status === PROSPECT_STATUSES.REPLIED && (
                            <button
                              className="eng-action-btn success"
                              title="Convert Lead"
                              disabled={transitioningId === prospect.id}
                              onClick={(e) => handleQuickMove(e, prospect, PROSPECT_STATUSES.CONVERTED)}
                            >
                              <Icon name="thumbs-up" size={11} /> Convert
                            </button>
                          )}

                          {prospect.status === PROSPECT_STATUSES.FOLLOWUP_DUE && (
                            <button
                              className="eng-action-btn"
                              title="Queue Follow-up"
                              disabled={transitioningId === prospect.id}
                              onClick={(e) => handleQuickMove(e, prospect, PROSPECT_STATUSES.QUEUED)}
                            >
                              <Icon name="repeat" size={11} /> Follow up
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
