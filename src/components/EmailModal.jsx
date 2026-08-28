// EmailModal.jsx — popup to email selected extractions, as a real attached
// file (CSV / PDF / Markdown / JSON), to one or more recipients. Sent
// server-side via Resend (see netlify/functions/export-email.js) — this
// component only builds the recipient list + chosen format and hands both to
// the caller's onSend(emails, format).
// Reuses the error-modal shell (backdrop, card, actions) for visual consistency.
import { useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { parseEmails } from "../lib/utils.js";

const ALL_FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "pdf", label: "PDF" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
];

export default function EmailModal({ items, hint, onSend, onClose, formats }) {
  // `formats` is the caller's list of plan-allowed formats (via
  // checkCanExport) — this modal never re-derives entitlement itself. Falls
  // back to CSV-only, which every plan that reaches this modal already has.
  const available = ALL_FORMATS.filter((f) => !formats || formats.includes(f.value));
  const options = available.length ? available : [ALL_FORMATS[0]];

  const [value, setValue] = useState("");
  const [format, setFormat] = useState(options[0].value);
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
      await onSend(ok, format);
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
            {items.length} {items.length === 1 ? "extraction" : "extractions"} will be sent as an attached file.
            {hint ? " " + hint : ""}
          </p>
        </div>

        {/* format selector */}
        {options.length > 1 && (
          <div className="email-format-row">
            <label htmlFor="email-format-select" className="email-format-label">Send as</label>
            <select
              id="email-format-select"
              className="field-input email-format-select"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              {options.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

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
