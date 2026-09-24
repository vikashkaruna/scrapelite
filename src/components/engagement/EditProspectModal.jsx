// src/components/engagement/EditProspectModal.jsx — correct a prospect's details.
//
// Stage, score and history are not editable here: stage has its own control,
// and score and history are records of what happened. Errors stay in the
// dialog (a duplicate email names the prospect it clashes with).

import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

const FIELDS = [
  ["first_name", "First name", "text"], ["last_name", "Last name", "text"],
  ["email", "Email", "email"], ["phone", "Phone", "tel"],
  ["company", "Company", "text"], ["role", "Role", "text"],
  ["industry", "Industry", "text"], ["country", "Country", "text"],
];

export default function EditProspectModal({ prospect, onSave, onClose }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, prospect?.[k] || ""])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!prospect) return null;

  const changed = Object.fromEntries(FIELDS
    .map(([k]) => [k, form[k].trim()])
    .filter(([k, v]) => v !== (prospect[k] || "")));
  const nothingToSave = Object.keys(changed).length === 0;
  const noAddress = !form.email.trim() && !form.phone.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (nothingToSave || noAddress) return;
    setBusy(true);
    setError("");
    try {
      await onSave(changed);
    } catch (err) {
      setError(err.message || "Could not save these details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="eng-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="eng-modal-card" role="dialog" aria-modal="true" aria-labelledby="engx-edit-prospect-title" onClick={(e) => e.stopPropagation()}>
        <div className="eng-modal-header">
          <h3 className="eng-modal-title" id="engx-edit-prospect-title">Edit prospect</h3>
          <button type="button" className="eng-modal-close" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <form className="eng-modal-form" onSubmit={submit} noValidate>
          <div className="engx-form-grid">
            {FIELDS.map(([k, label, type]) => (
              <div key={k} className="eng-form-group">
                <label className="eng-field-label" htmlFor={`engx-p-${k}`}>{label}</label>
                <input id={`engx-p-${k}`} type={type} className="eng-input-field" value={form[k]}
                  maxLength={k === "email" ? 254 : 160}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          {noAddress && <p className="eng-field-hint is-error">A prospect needs an email or a phone number.</p>}
          {(changed.email !== undefined || changed.phone !== undefined) && (
            <p className="eng-field-hint">
              Consent follows the address: an opt-out recorded on the old address stays with it, and open drafts are
              updated with the new details (drafts you edited by hand are left as written).
            </p>
          )}
          {error && <p className="eng-field-hint is-error" role="alert">{error}</p>}
          <div className="eng-modal-actions">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" icon="check" disabled={busy || nothingToSave || noAddress}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
