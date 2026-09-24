// src/components/engagement/SendPanel.jsx — approved messages, and what happened to them.
//
// Approving a draft queues it; sending is a separate, explicit act. This panel
// is the only "Send" in the product. What the request cannot finish, the
// engagement-dispatcher cron sends within minutes — the copy says so, rather
// than implying everything went out at once.

import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

/** Codes the server records on a message → words a person can act on. */
export const OUTCOME_COPY = {
  channel_not_enabled: "This channel can't send yet.",
  no_address: "No address on file for this channel.",
  opted_out: "The contact has opted out.",
  suppressed_unsubscribe: "The contact unsubscribed.",
  suppressed_stop_keyword: "The contact replied STOP.",
  suppressed_bounce: "This address bounced earlier.",
  suppressed_complaint: "The contact marked a previous email as spam.",
  suppressed_manual: "Your team opted this contact out.",
  prospect_missing: "The prospect was deleted.",
  campaign_missing: "The campaign was deleted.",
  sender_missing: "Set a sender for this campaign (Brand kit & sender).",
  sender_invalid: "The campaign's sender address isn't valid.",
  sender_name_invalid: "The campaign's sender name isn't valid.",
  sender_domain_not_allowed: "The sender's domain isn't verified for sending.",
  email_not_configured: "Email sending isn't configured on this environment.",
  unsubscribe_not_configured: "Unsubscribe links aren't configured on this environment.",
  provider_rejected: "The email provider refused this message.",
  provider_unavailable: "The email provider was unavailable; it will be retried.",
  network_error: "Couldn't reach the email provider; it will be retried.",
  timeout: "The email provider didn't answer in time; it will be retried.",
  bounced: "The email bounced.",
  insufficient_credits: "Waiting for credits — it will send once you have them.",
};

export const outcomeText = (code) => OUTCOME_COPY[code] || "It could not be sent.";

export default function SendPanel({ messages = [], prospectsById = new Map(), onSend, onRetry, busy = false, senderReady = true }) {
  const [showIssues, setShowIssues] = useState(false);

  const { ready, inFlight, issues } = useMemo(() => ({
    ready: messages.filter((m) => m.status === "queued"),
    inFlight: messages.filter((m) => m.status === "sending"),
    issues: messages.filter((m) => m.status === "failed" || m.status === "skipped"),
  }), [messages]);

  if (!ready.length && !inFlight.length && !issues.length) return null;

  const name = (m) => {
    const p = prospectsById.get(m.prospect_id) || m.engagement_prospects || {};
    return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "Prospect";
  };

  return (
    <section className="eng-send-panel" aria-label="Sending">
      <div className="eng-send-row">
        <div className="eng-send-summary">
          <Icon name="send" size={16} />
          <span>
            <strong>{ready.length}</strong> approved and ready to send
            {inFlight.length ? ` · ${inFlight.length} sending` : ""}
            {ready.some((m) => m.failure_code === "insufficient_credits") ? " · some waiting for credits" : ""}
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="send"
          disabled={busy || !ready.length || !senderReady}
          title={senderReady ? undefined : "Set a sender for this campaign first"}
          onClick={() => onSend?.(ready.map((m) => m.id))}
        >
          {busy ? "Sending…" : `Send ${ready.length || ""} now`.replace("  ", " ")}
        </Button>
      </div>

      {!senderReady && (
        <p className="eng-send-note is-warning">
          <Icon name="alert-circle" size={13} /> This campaign has no sender yet. Add one under <em>Brand kit &amp; sender</em>.
        </p>
      )}

      {issues.length > 0 && (
        <>
          <button type="button" className="eng-send-issues-toggle" aria-expanded={showIssues} onClick={() => setShowIssues((v) => !v)}>
            <Icon name={showIssues ? "chevron-down" : "chevron-right"} size={13} />
            {issues.length} not sent
          </button>
          {showIssues && (
            <ul className="eng-send-issues">
              {issues.map((m) => (
                <li key={m.id}>
                  <span className="eng-send-issue-name">{name(m)}</span>
                  <span className="eng-send-issue-why">{outcomeText(m.failure_code)}</span>
                  {m.status === "failed" && onRetry && (
                    <button type="button" className="eng-consent-lift" disabled={busy} onClick={() => onRetry(m.id)}>Retry</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
