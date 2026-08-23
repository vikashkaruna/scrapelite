// ScrapeConsentModal — the attestation behind an override of a robots.txt refusal.
//
// Shown only AFTER a refusal, never before. Advertising an override to someone
// who has not hit the wall turns a compliance feature into a setting people
// switch off pre-emptively; the wall is what makes the question meaningful.
//
// Three properties this dialog must keep:
//
//   1. It states plainly that the site said no. It is not framed as a
//      formality or a loading step — the person has to read a refusal and
//      decide to override it.
//   2. Confirm stays DISABLED until the checkbox is ticked. Same pattern as
//      the reason dialog in AdminMonitoring: an attestation nobody actively
//      made is not an attestation. The server re-checks `confirmed === true`,
//      so this is the UI half of a rule enforced in both places.
//   3. It never claims to grant anything. Ticking the box records a statement
//      by the user; /api/extract still re-reads that record server-side on the
//      next request and still decides.
import { useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { grantConsentFor } from "../lib/scrapeConsentService.js";

export default function ScrapeConsentModal({ host, url, onGranted, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!confirmed || saving) return;
    setSaving(true);
    setError("");
    try {
      await grantConsentFor(host, "extract_refusal");
      onGranted?.(host);
    } catch (err) {
      setError(err?.message || "Couldn't record your confirmation. Please try again.");
      setSaving(false);
    }
  };

  return createPortal(
    <div className="scm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div className="scm-card" role="dialog" aria-modal="true" aria-labelledby="scm-title">
        <button className="scm-close" onClick={onCancel} aria-label="Close">
          <Icon name="x" size={18} />
        </button>

        <div className="scm-icon"><Icon name="shield" size={22} /></div>
        <h2 className="scm-title" id="scm-title">{host} asks tools not to extract it</h2>

        <p className="scm-body">
          This site's <code>robots.txt</code> tells automated tools to stay away, and
          DatIQ honours that by default. Nothing went wrong — the extraction was
          declined before it started, and no credit was used.
        </p>

        {url && (
          <div className="scm-url" title={url}>
            <Icon name="link" size={13} /> <span>{url}</span>
          </div>
        )}

        <label className="scm-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I confirm I have permission to extract <b>{host}</b> — it is my own
            site, or I have the owner's written consent — and I take
            responsibility for how this data is used.
          </span>
        </label>

        <p className="scm-fine">
          Recorded against your account for this site only, for 180 days. It does
          not cover other sites or other subdomains, and you can withdraw it at any
          time from your account.
        </p>

        {error && (
          <div className="scm-error" role="alert">
            <Icon name="alert-triangle" size={14} /> {error}
          </div>
        )}

        <div className="scm-actions">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="arrow-right"
            onClick={submit}
            disabled={!confirmed || saving}
            loading={saving}
          >
            {saving ? "Recording…" : "Confirm and extract"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
