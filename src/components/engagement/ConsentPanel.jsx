// src/components/engagement/ConsentPanel.jsx — per-channel consent for one prospect.
//
// Each checkbox answers ONE question: "may we contact this person on this
// channel?" A channel with an address and no opt-out starts TICKED. Untick and
// Save to opt out; tick an opt-out the account's policy allows removing, and
// Save to remove it. Nothing changes until Save — and Save asks once more,
// naming exactly what will stop and what will resume.
//
// (The first version inverted this: the boxes meant "select to opt out" and
// started empty, which read as "no consent anywhere".)
//
// What the panel shows comes from the same suppressionModel the sender obeys,
// so "Can be contacted" here is exactly "will be sent" there. Opt-outs are
// per channel and apply to every campaign on the account.

import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { consentStatus, indexSuppressions, RECIPIENT_REASONS } from "../../lib/engagement/suppressionModel.js";
import { fmtDate } from "../../lib/utils.js";

const MISSING = { email: "No email on file", whatsapp: "No phone on file", sms: "No phone on file", telegram: "No Telegram chat" };

export default function ConsentPanel({ prospect, suppressions = [], onOptOut, onLift, busy = false }) {
  const rows = useMemo(() => consentStatus(prospect, indexSuppressions(suppressions)), [prospect, suppressions]);
  const suppressionFor = (r) => suppressions.find((s) => s.channel === r.channel && s.address === r.address) || null;

  // What the database says today: true = may contact.
  const saved = useMemo(() => Object.fromEntries(rows.map((r) => [r.channel, Boolean(r.address) && !r.suppressed])), [rows]);
  const [allowed, setAllowed] = useState(saved);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  // Reset only when what is SAVED actually changes (after a save or a reload),
  // not on every parent re-render that hands us a fresh array.
  const savedKey = JSON.stringify(saved);
  useEffect(() => { setAllowed(saved); setConfirming(false); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = rows.filter((r) => saved[r.channel] && !allowed[r.channel]).map((r) => r.channel);
  const resume = rows.filter((r) => !saved[r.channel] && allowed[r.channel] && r.suppressed).map((r) => r.channel);
  const dirty = stop.length + resume.length > 0;
  const reachable = rows.filter((r) => saved[r.channel]);
  const label = (c) => rows.find((r) => r.channel === c)?.label || c;

  const editable = (r) => Boolean(r.address) && (!r.suppressed || r.liftable);
  const toggle = (r) => { if (editable(r)) setAllowed((a) => ({ ...a, [r.channel]: !a[r.channel] })); };

  const save = async () => {
    if (stop.length && onOptOut) await onOptOut(stop, note.trim() || null);
    for (const ch of resume) {
      const s = suppressionFor(rows.find((r) => r.channel === ch));
      if (s && onLift) await onLift(s.id);
    }
    setConfirming(false);
    setNote("");
  };

  const stopAll = () => {
    setAllowed((a) => ({ ...a, ...Object.fromEntries(reachable.map((r) => [r.channel, false])) }));
    setConfirming(true);
  };

  return (
    <section className="eng-drawer-card eng-consent" aria-labelledby="eng-consent-title">
      <div className="eng-consent-head">
        <h4 className="eng-card-title" id="eng-consent-title">Consent by channel</h4>
        <span className="eng-consent-hint">Ticked = may be contacted. Applies to every campaign.</span>
      </div>

      <ul className="eng-consent-list">
        {rows.map((r) => {
          const s = r.suppressed ? suppressionFor(r) : null;
          const on = Boolean(allowed[r.channel]);
          const changed = on !== saved[r.channel];
          return (
            <li key={r.channel} className={`eng-consent-row ${changed ? "is-changed" : ""}`}>
              <label className={`eng-consent-check ${editable(r) ? "" : "is-disabled"}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!editable(r) || busy}
                  onChange={() => toggle(r)}
                  aria-label={`Contact by ${r.label}`}
                />
                <span className="eng-consent-channel">{r.label}</span>
                {!r.live && <span className="eng-consent-soon">not live yet</span>}
              </label>

              <span className="eng-consent-state">
                {!r.address && <span className="eng-consent-pill is-none">{MISSING[r.channel]}</span>}
                {r.address && changed && (
                  <span className={`eng-consent-pill ${on ? "is-ok" : "is-out"}`}>{on ? "Will resume on save" : "Will stop on save"}</span>
                )}
                {r.address && !changed && !r.suppressed && <span className="eng-consent-pill is-ok"><Icon name="check" size={11} /> Can be contacted</span>}
                {r.address && !changed && r.suppressed && (
                  <span className="eng-consent-pill is-out">
                    <Icon name="slash" size={11} /> {r.reasonLabel}{r.since ? ` · ${fmtDate(r.since)}` : ""}
                  </span>
                )}
              </span>

              {r.suppressed && s && !r.liftable && (
                <span className="eng-consent-locked" title={RECIPIENT_REASONS.includes(r.reason)
                  ? "The recipient made this choice, so only they can change it."
                  : "Your account's opt-out policy doesn't allow removing this one."}>
                  {RECIPIENT_REASONS.includes(r.reason) ? "Recipient's choice" : "Locked"}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {!confirming ? (
        <div className="eng-consent-actions">
          <Button type="button" variant="primary" size="sm" icon="check" disabled={busy || !dirty} onClick={() => setConfirming(true)}>
            Save consent
          </Button>
          {dirty && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setAllowed(saved)}>Undo changes</Button>}
          {!dirty && (
            <Button type="button" variant="ghost" size="sm" icon="slash" disabled={busy || reachable.length === 0} onClick={stopAll}>
              Opt out of all channels
            </Button>
          )}
        </div>
      ) : (
        <div className="eng-consent-confirm" role="alertdialog" aria-labelledby="eng-consent-confirm-title">
          <p id="eng-consent-confirm-title">
            {stop.length > 0 && <>Stop contacting this person on <strong>{stop.map(label).join(", ")}</strong>. Queued messages there will not be sent. </>}
            {resume.length > 0 && <>Resume <strong>{resume.map(label).join(", ")}</strong>.</>}
          </p>
          {stop.length > 0 && (
            <input
              type="text"
              className="eng-input-field"
              placeholder="Reason (optional) — e.g. asked on a call"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Reason for opting out"
            />
          )}
          <div className="eng-consent-actions">
            <Button type="button" variant={stop.length ? "danger" : "primary"} size="sm" disabled={busy || !dirty} onClick={save}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setConfirming(false); setAllowed(saved); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
