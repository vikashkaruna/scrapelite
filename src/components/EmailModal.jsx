// EmailModal.jsx — popup to email selected extractions to one or more recipients.
// Reuses the error-modal shell (backdrop, card, actions) for visual consistency.
import { useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { parseEmails } from "../lib/utils.js";

export default function EmailModal({ items, hint, onSend, onClose }) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const { valid } = parseEmails(value);

  const submit = async (e) => {
    e?.preventDefault();
    const { valid: ok, invalid } = parseEmails(value);
    if (!ok.length) {
      setError(
        invalid.length
          ? "That doesn't look like a valid email address."
          : "Enter at least one email address.",
      );
      return;
    }
    setError("");
    setSending(true);
    try {
      await onSend(ok);
      // Parent unmounts this modal on success — nothing else to do here.
    } catch (err) {
      console.error("[DatIQ] Send email failed:", err);
      setError(err?.message || "Couldn't send the email. Please try again.");
      setSending(false);
    }
  };

  return createPortal(
    <div
      className="error-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      onClick={onClose}
    >
      <form className="error-modal email-modal card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm error-close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="x" size={17} />
        </button>

        <div className="email-icon-wrap">
          <Icon name="mail" size={24} strokeWidth={2} />
        </div>

        <div className="error-body">
          <h2 className="error-title" id="email-title">Email these extractions</h2>
          <p className="error-message">
            {items.length} {items.length === 1 ? "extraction" : "extractions"} will be sent.
            {hint ? " " + hint : ""}
          </p>
        </div>

        {/* recipient input */}
        <div>
          <div className={"field-shell email-field" + (error ? " field-error" : "")}>
            <span className="field-lead">
              <Icon name="mail" size={18} />
            </span>
            <input
              className="field-input"
              type="text"
              autoFocus
              placeholder="name@example.com, another@example.com"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError("");
              }}
              aria-label="Recipient email addresses"
            />
          </div>
          <div className="email-help">
            {error ? (
              <span className="email-err">{error}</span>
            ) : valid.length ? (
              <span>
                {valid.length} recipient{valid.length > 1 ? "s" : ""}
              </span>
            ) : (
              <span>Separate multiple emails with commas.</span>
            )}
          </div>
        </div>

        {/* preview of what's being sent */}
        <ul className="email-list scroll-y">
          {items.map((it) => (
            <li key={it.id}>
              <Icon name="file" size={13} />
              <span className="email-list-title">{it.page_title}</span>
            </li>
          ))}
        </ul>

        <div className="error-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={sending ? null : "send"} disabled={sending}>
            {sending ? (
              <>
                <span
                  className="spinner"
                  style={{
                    "--sp-size": "16px",
                    borderColor: "rgba(255,255,255,.4)",
                    borderTopColor: "#fff",
                  }}
                />{" "}
                Sending…
              </>
            ) : (
              "Send email"
            )}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
