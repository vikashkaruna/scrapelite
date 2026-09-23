// src/components/engagement/ConsentPanel.jsx — per-channel opt-out for one prospect.
//
// Consent is stored per channel (owner decision 2026-09-23), so this panel
// shows one row per channel and lets the team opt a contact out of any
// combination — or all of them in one action. What it shows comes from the
// same suppressionModel the sender obeys, so "Opted out" here is exactly
// "will not be sent" there.
//
// Removing an opt-out is offered only where canLiftSuppression() allows it.
// Where it is not allowed, the panel says WHY in terms of who caused it.

import { useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { consentStatus, indexSuppressions, RECIPIENT_REASONS } from "../../lib/engagement/suppressionModel.js";
import { fmtDate } from "../../lib/utils.js";

const MISSING = { email: "email", whatsapp: "phone", sms: "phone", telegram: "Telegram chat" };

export default function ConsentPanel({ prospect, suppressions = [], onOptOut, onLift, busy = false }) {
  const rows = useMemo(
    () => consentStatus(prospect, indexSuppressions(suppressions)),
    [prospect, suppressions],
  );
  const suppressionFor = (channel) => suppressions.find((s) => s.channel === channel && rows.find((r) => r.channel === channel)?.address === s.address);

  const optable = rows.filter((r) => r.address && !r.suppressed);
  const [selected, setSelected] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // { channels: [] }
  const [note, setNote] = useState("");

  const toggle = (channel) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(channel)) next.delete(channel); else next.add(channel);
    return next;
  });

  const ask = (channels) => { setNote(""); setConfirm({ channels }); };
  const doOptOut = async () => {
    if (!confirm || !onOptOut) return;
    await onOptOut(confirm.channels, note.trim() || null);
    setConfirm(null);
    setSelected(new Set());
  };

  return (
    <section className="eng-drawer-card eng-consent" aria-labelledby="eng-consent-title">
      <div className="eng-consent-head">
        <h4 className="eng-card-title" id="eng-consent-title">Consent by channel</h4>
        <span className="eng-consent-hint">Opt-outs apply to every campaign on this account.</span>
      </div>

      <ul className="eng-consent-list">
        {rows.map((r) => {
          const s = r.suppressed ? suppressionFor(r.channel) : null;
          const selectable = Boolean(r.address) && !r.suppressed;
          return (
            <li key={r.channel} className="eng-consent-row">
              <label className={`eng-consent-check ${selectable ? "" : "is-disabled"}`}>
                <input
                  type="checkbox"
                  disabled={!selectable || busy}
                  checked={selected.has(r.channel)}
                  onChange={() => toggle(r.channel)}
                  aria-label={`Select ${r.label}`}
                />
                <span className="eng-consent-channel">{r.label}</span>
                {!r.live && <span className="eng-consent-soon">not live yet</span>}
              </label>

              <span className="eng-consent-state">
                {!r.address && <span className="eng-consent-pill is-none">No {MISSING[r.channel]} on file</span>}
                {r.address && !r.suppressed && <span className="eng-consent-pill is-ok"><Icon name="check" size={11} /> Can be contacted</span>}
                {r.suppressed && (
                  <span className="eng-consent-pill is-out" title={r.since ? `Since ${fmtDate(r.since)}` : undefined}>
                    <Icon name="alert-circle" size={11} /> {r.reasonLabel}
                    {r.since ? ` · ${fmtDate(r.since)}` : ""}
                  </span>
                )}
              </span>

              {r.suppressed && s && (r.liftable
                ? <button type="button" className="eng-consent-lift" disabled={busy} onClick={() => onLift?.(s.id)}>Remove opt-out</button>
                : RECIPIENT_REASONS.includes(r.reason)
                  ? <span className="eng-consent-locked" title="The recipient made this choice, so only they can change it.">Recipient's choice</span>
                  : <span className="eng-consent-locked" title="Your account's opt-out policy doesn't allow removing this one.">Locked</span>)}
            </li>
          );
        })}
      </ul>

      {!confirm && (
        <div className="eng-consent-actions">
          <Button variant="secondary" size="sm" disabled={busy || selected.size === 0} onClick={() => ask([...selected])}>
            Opt out of selected{selected.size ? ` (${selected.size})` : ""}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy || optable.length === 0} onClick={() => ask(optable.map((r) => r.channel))}>
            Opt out of all channels
          </Button>
        </div>
      )}

      {confirm && (
        <div className="eng-consent-confirm" role="alertdialog" aria-labelledby="eng-consent-confirm-title">
          <p id="eng-consent-confirm-title">
            Stop contacting this person on <strong>{confirm.channels.map((c) => rows.find((r) => r.channel === c)?.label || c).join(", ")}</strong>?
            Queued messages on {confirm.channels.length > 1 ? "these channels" : "this channel"} will not be sent.
          </p>
          <input
            type="text"
            className="eng-input-field"
            placeholder="Reason (optional) — e.g. asked on a call"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="eng-consent-actions">
            <Button variant="danger" size="sm" disabled={busy} onClick={doOptOut}>Confirm opt-out</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
