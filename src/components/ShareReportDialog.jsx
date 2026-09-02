// src/components/ShareReportDialog.jsx — PRD 2's sharing controls.
//
// The UI half of the §2.2a state machine. It exists to make three things
// obvious that a single "Share" toggle would hide:
//   1. the report is PRIVATE until you deliberately publish it;
//   2. "Stop sharing" is reversible and keeps the link working if you
//      re-publish — that is what people mean by "hide this for now";
//   3. "Revoke" is NOT reversible, and says so before you click it.
//
// Collapsing 2 and 3 into one control is what makes people stop using the safe
// one, so they are visually and verbally separate here.

import { useState } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { VISIBILITY, SHAREABLE, VISIBILITY_LABELS, isIndexable } from "../lib/reports/visibilityModel.js";
import * as api from "../lib/reports/reportsClient.js";

export default function ShareReportDialog({ report, onClose, onChanged }) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const current = report.visibility || VISIBILITY.PRIVATE;
  const url = api.reportUrl(report.slug);
  const revoked = current === VISIBILITY.REVOKED;

  async function change(visibility) {
    setBusy(true);
    try {
      const r = visibility === VISIBILITY.PRIVATE
        ? await api.unpublishReport(report.id)
        : await api.publishReport(report.id, visibility);
      onChanged?.({ ...report, visibility: r.visibility, slug: r.slug });
      showToast(
        visibility === VISIBILITY.PRIVATE
          ? "Sharing stopped. Re-publish any time — the same link will work again."
          : `Shared: ${VISIBILITY_LABELS[visibility].label.toLowerCase()}.`,
      );
    } catch (e) {
      showToast(e.message);
    } finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true);
    try {
      await api.revokeReport(report.id, "revoked by owner");
      onChanged?.({ ...report, visibility: VISIBILITY.REVOKED });
      showToast("Link permanently revoked. It can never be restored.");
      setConfirmRevoke(false);
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  }

  async function addGrant() {
    const email = grantEmail.trim();
    if (!email) return;
    setBusy(true);
    try {
      await api.grantAccess(report.id, email);
      showToast(`${email} can now open this report.`);
      setGrantEmail("");
    } catch (e) { showToast(e.message); }
    finally { setBusy(false); }
  }

  function copy() {
    if (!url) return;
    navigator.clipboard?.writeText(url).then(
      () => showToast("Link copied."),
      () => showToast("Couldn't copy — select the link and copy it manually."),
    );
  }

  return (
    <div className="srd-overlay" role="dialog" aria-modal="true" aria-label="Share report">
      <div className="srd-card">
        <div className="srd-head">
          <h2>Share this report</h2>
          <button className="srd-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        {revoked ? (
          <div className="srd-revoked">
            <Icon name="alert-triangle" size={18} />
            <div>
              <strong>This link was revoked.</strong>
              <p>{VISIBILITY_LABELS.revoked.hint} Create a new report to share this work again.</p>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="srd-options">
              <legend>Who can open it</legend>
              {[VISIBILITY.PRIVATE, ...SHAREABLE].map((v) => (
                <label key={v} className={`srd-option${current === v ? " on" : ""}`}>
                  <input
                    type="radio" name="visibility" value={v} checked={current === v}
                    disabled={busy} onChange={() => change(v)}
                  />
                  <span className="srd-option-body">
                    <strong>{VISIBILITY_LABELS[v].label}</strong>
                    <span>{VISIBILITY_LABELS[v].hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {current !== VISIBILITY.PRIVATE && url && (
              <div className="srd-link">
                <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Report link" />
                <Button variant="secondary" onClick={copy}>Copy</Button>
              </div>
            )}

            {current === VISIBILITY.NAMED && (
              <div className="srd-grants">
                <label htmlFor="srd-grant">Give access to an email address</label>
                <div className="srd-grant-row">
                  <input
                    id="srd-grant" type="email" placeholder="colleague@company.com"
                    value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)}
                  />
                  <Button variant="secondary" onClick={addGrant} disabled={busy}>Add</Button>
                </div>
                <p className="srd-hint">
                  They'll need to sign in with that exact address — a forwarded link
                  won't work for anyone else.
                </p>
              </div>
            )}

            {current !== VISIBILITY.PRIVATE && isIndexable(current) && (
              <p className="srd-warn">
                <Icon name="alert-triangle" size={14} /> Public reports can be found by
                search engines and may appear in the DatIQ gallery.
              </p>
            )}

            {report.slug && (
              <div className="srd-danger">
                {confirmRevoke ? (
                  <>
                    <p>
                      <strong>Revoking is permanent.</strong> This link stops working for
                      everyone immediately and can never be restored — not even by you.
                      If you only want to hide the report for now, choose <em>Private</em> above instead.
                    </p>
                    <div className="srd-danger-row">
                      <Button variant="danger" onClick={revoke} disabled={busy}>
                        Yes, revoke permanently
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
                    </div>
                  </>
                ) : (
                  <button className="srd-revoke-link" onClick={() => setConfirmRevoke(true)}>
                    Revoke this link permanently
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
