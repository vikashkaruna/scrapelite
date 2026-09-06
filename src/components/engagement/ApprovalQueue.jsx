// src/components/engagement/ApprovalQueue.jsx — Human-in-the-Loop Message Review & Dispatch
import { useState, useMemo } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import FaviconDot from "../FaviconDot.jsx";
import { validateComplianceGuardrails } from "../../lib/engagement/aiMessageGenerator.js";

export default function ApprovalQueue({
  queueItems = [], // array of { message, prospect }
  onApprove,
  onReject,
  onRegenerate,
  onApproveAll,
  isProcessing = false,
}) {
  const [selectedId, setSelectedId] = useState(queueItems[0]?.message?.id || null);
  const [edits, setEdits] = useState({}); // { [messageId]: { subject, body } }
  const [instructions, setInstructions] = useState("");
  const [regeneratingId, setRegeneratingId] = useState(null);

  // Keep selected item valid
  const currentItem = useMemo(() => {
    return queueItems.find((item) => item.message.id === selectedId) || queueItems[0] || null;
  }, [queueItems, selectedId]);

  const activeMessage = currentItem?.message;
  const activeProspect = currentItem?.prospect;

  const currentSubject = edits[activeMessage?.id]?.subject ?? activeMessage?.subject ?? "";
  const currentBody = edits[activeMessage?.id]?.body ?? activeMessage?.body ?? "";

  // Run guardrails on current subject + body
  const guardrailCheck = useMemo(() => {
    if (!activeMessage) return { passed: true, issues: [] };
    const res = validateComplianceGuardrails({
      subject: currentSubject,
      body: currentBody,
      channel: activeMessage.channel,
    });
    return {
      passed: res.passed,
      issues: res.violations || [],
    };
  }, [activeMessage, currentSubject, currentBody]);

  const handleFieldChange = (field, value) => {
    if (!activeMessage) return;
    setEdits((prev) => ({
      ...prev,
      [activeMessage.id]: {
        subject: field === "subject" ? value : currentSubject,
        body: field === "body" ? value : currentBody,
      },
    }));
  };

  const handleApproveCurrent = async () => {
    if (!activeMessage || !onApprove) return;
    await onApprove(activeMessage.id, {
      subject: currentSubject,
      body: currentBody,
    });
  };

  const handleRejectCurrent = async () => {
    if (!activeMessage || !onReject) return;
    await onReject(activeMessage.id);
  };

  const handleRegenerateCurrent = async () => {
    if (!activeProspect || !onRegenerate) return;
    setRegeneratingId(activeMessage.id);
    try {
      await onRegenerate(activeProspect.id, activeMessage.channel, instructions);
      setInstructions("");
    } finally {
      setRegeneratingId(null);
    }
  };

  if (queueItems.length === 0) {
    return (
      <div className="eng-queue-empty">
        <div className="eng-queue-empty-icon">
          <Icon name="check-circle" size={40} />
        </div>
        <h3 className="eng-queue-empty-title">All Caught Up!</h3>
        <p className="eng-queue-empty-desc">
          There are no messages pending human review. New AI-drafted messages requiring approval will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="eng-queue-root">
      {/* Header bar with count and Bulk Action */}
      <div className="eng-queue-header">
        <div className="eng-queue-header-left">
          <span className="eng-queue-badge">{queueItems.length}</span>
          <span className="eng-queue-title">Pending Human Review</span>
          <span className="eng-queue-sub">Verify AI personalization and compliance before dispatch</span>
        </div>
        {onApproveAll && (
          <Button
            variant="primary"
            onClick={onApproveAll}
            disabled={isProcessing}
            icon="send"
          >
            Approve All ({queueItems.length})
          </Button>
        )}
      </div>

      {/* Split Screen: List on Left, Editor / Preview on Right */}
      <div className="eng-queue-split">
        {/* Left Column: List of items */}
        <div className="eng-queue-list">
          {queueItems.map(({ message, prospect }) => {
            const isSelected = message.id === currentItem?.message?.id;
            const prospectName = `${prospect?.first_name || ""} ${prospect?.last_name || ""}`.trim() || prospect?.email || "Unknown Prospect";
            const channelIcon = message.channel === "email" ? "mail" : message.channel === "whatsapp" ? "message-circle" : message.channel === "telegram" ? "send" : "phone";

            return (
              <div
                key={message.id}
                className={`eng-queue-item ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedId(message.id)}
              >
                <div className="eng-queue-item-header">
                  <div className="eng-queue-item-identity">
                    {prospect?.company && <FaviconDot domain={prospect.company} size={18} />}
                    <div className="eng-queue-item-names">
                      <div className="eng-queue-item-name">{prospectName}</div>
                      <div className="eng-queue-item-company">{prospect?.company || prospect?.role || "Lead"}</div>
                    </div>
                  </div>
                  <span className={`eng-channel-tag eng-ch-${message.channel}`}>
                    <Icon name={channelIcon} size={11} />
                    {message.channel.toUpperCase()}
                  </span>
                </div>

                <div className="eng-queue-item-preview">
                  {message.subject ? (
                    <div className="eng-queue-preview-subject">{message.subject}</div>
                  ) : null}
                  <div className="eng-queue-preview-body">
                    {message.body?.slice(0, 90)}...
                  </div>
                </div>

                <div className="eng-queue-item-meta">
                  <span className="eng-queue-variant-pill">
                    Variant {message.variant_id?.toUpperCase() || "A"}
                  </span>
                  <span className="eng-score-pill">Score: {prospect?.engagement_score ?? 0}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Review, Guardrails & Action Panel */}
        {currentItem && (
          <div className="eng-queue-detail">
            {/* Prospect Context Banner */}
            <div className="eng-detail-context">
              <div className="eng-detail-prospect">
                <h4 className="eng-detail-name">
                  {`${activeProspect?.first_name || ""} ${activeProspect?.last_name || ""}`.trim() || activeProspect?.email}
                </h4>
                <div className="eng-detail-role-company">
                  {activeProspect?.role && <span>{activeProspect.role}</span>}
                  {activeProspect?.role && activeProspect?.company && <span>·</span>}
                  {activeProspect?.company && <span>{activeProspect.company}</span>}
                  {activeProspect?.industry && <span className="eng-detail-industry">({activeProspect.industry})</span>}
                </div>
                <div className="eng-detail-contacts">
                  {activeProspect?.email && (
                    <span className="eng-detail-contact-chip">
                      <Icon name="mail" size={12} /> {activeProspect.email}
                    </span>
                  )}
                  {activeProspect?.phone && (
                    <span className="eng-detail-contact-chip">
                      <Icon name="phone" size={12} /> {activeProspect.phone}
                    </span>
                  )}
                </div>
              </div>

              {/* Compliance / Guardrails Status */}
              <div className={`eng-guardrail-badge ${guardrailCheck.passed ? "passed" : "warning"}`}>
                <Icon name={guardrailCheck.passed ? "shield-check" : "alert-triangle"} size={16} />
                <div>
                  <div className="eng-guardrail-title">
                    {guardrailCheck.passed ? "Compliance Guardrails Passed" : "Attention Needed"}
                  </div>
                  {guardrailCheck.issues.length > 0 ? (
                    <div className="eng-guardrail-issues">
                      {guardrailCheck.issues.map((issue, idx) => (
                        <div key={idx} className="eng-issue-item">· {issue}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="eng-guardrail-sub">No spam words · Length within limits · Disclosures present</div>
                  )}
                </div>
              </div>
            </div>

            {/* Editable Message Content */}
            <div className="eng-editor-box">
              {activeMessage.channel === "email" && (
                <div className="eng-editor-field">
                  <label className="eng-field-label">Subject Line</label>
                  <input
                    type="text"
                    className="eng-input-field eng-subject-input"
                    value={currentSubject}
                    onChange={(e) => handleFieldChange("subject", e.target.value)}
                    placeholder="Subject line..."
                  />
                </div>
              )}

              <div className="eng-editor-field">
                <div className="eng-field-header">
                  <label className="eng-field-label">Message Body</label>
                  <span className="eng-char-count">
                    {currentBody.length} chars
                    {activeMessage.channel === "sms" && ` (${Math.ceil(currentBody.length / 160)} SMS parts)`}
                  </span>
                </div>
                <textarea
                  className="eng-textarea-field"
                  rows={8}
                  value={currentBody}
                  onChange={(e) => handleFieldChange("body", e.target.value)}
                  placeholder="Personalized message body..."
                />
              </div>

              {/* Prompt feedback / Regeneration instructions */}
              <div className="eng-regen-field">
                <input
                  type="text"
                  className="eng-input-field eng-regen-input"
                  placeholder="Custom AI adjustments (e.g. 'Make it shorter and mention our recent case study')..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRegenerateCurrent();
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRegenerateCurrent}
                  disabled={regeneratingId === activeMessage.id}
                  icon="sparkles"
                >
                  {regeneratingId === activeMessage.id ? "Regenerating..." : "Regenerate AI"}
                </Button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="eng-detail-actions">
              <Button
                variant="ghost"
                onClick={handleRejectCurrent}
                disabled={isProcessing}
                icon="x"
              >
                Reject & Archive
              </Button>

              <div className="eng-detail-actions-right">
                <Button
                  variant="primary"
                  onClick={handleApproveCurrent}
                  disabled={isProcessing}
                  icon="send"
                >
                  Approve & Dispatch Now
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
