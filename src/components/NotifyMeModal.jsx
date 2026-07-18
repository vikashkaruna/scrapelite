// src/components/NotifyMeModal.jsx — F18 (Notify-me modal for Airtable/Notion).
//
// Small modal that captures the user's email when they click "Notify me"
// on a coming-soon integration card. Persists the waitlist in
// localStorage (via integrationsNotify.notifyMeWhenAvailable) and fires
// the email-capture service so marketing can reach them when the
// integration ships.

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { notifyMeWhenAvailable, isWaitlisted, getWaitlistedIntegrations } from "../lib/integrationsNotify.js";

export default function NotifyMeModal({ slug, label, open, onClose }) {
  const showToast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setEmail("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await notifyMeWhenAvailable(slug, email.trim());
      showToast(`You're on the list — we'll email you when ${label} ships.`, "check");
      onClose?.();
    } catch (err) {
      setError(err.message || "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Optional: route to /blog after success so the user can also subscribe
  // to the changelog (they're here because they want the integration;
  // they probably also want the release notes).
  const alsoSubscribeBlog = () => {
    onClose?.();
    if (location.pathname !== "/blog") navigate("/blog");
  };

  return (
    <div className="notify-modal-overlay" role="dialog" aria-modal="true">
      <div className="notify-modal">
        <button className="notify-modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
        <span className="notify-modal-eyebrow">
          <Icon name="bell" size={12} />
          Coming soon
        </span>
        <h2 className="notify-modal-title">Get notified when {label} ships</h2>
        <p className="notify-modal-sub">
          We'll email you the moment the {label} export is live. One email,
          no follow-ups.
        </p>
        <form onSubmit={handleSubmit} className="notify-modal-form">
          <input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="notify-modal-input"
            required
            autoFocus
            aria-label="Your email"
          />
          {error && <div className="notify-modal-error">{error}</div>}
          <Button
            type="submit"
            variant="primary"
            icon="bell"
            loading={busy}
            loadingText="Saving…"
          >
            Notify me
          </Button>
        </form>
        <button className="notify-modal-secondary" onClick={alsoSubscribeBlog}>
          Or subscribe to the changelog →
        </button>
      </div>
    </div>
  );
}
