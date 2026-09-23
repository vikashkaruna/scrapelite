// src/components/engagement/CampaignModal.jsx — create, rename and delete a campaign.
//
// One dialog for both modes, so the rules cannot drift between them: the name is
// required and must not match another campaign on the account (checked here for
// an instant answer, and again by the server, which decides). Errors stay in the
// dialog next to the field — a toast that disappears in 2.6s is not where a
// person should learn their campaign was not created.
//
// Delete is a second, explicit step that says what goes with the campaign.
// Opt-outs are NOT deleted: they belong to the account, not to one campaign.

import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { findNameClash } from "../../lib/engagement/campaignLabels.js";

const STATUSES = [
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" },
];

export default function CampaignModal({ mode = "create", campaign = null, campaigns = [], prospectCount = 0, onSave, onDelete, onClose }) {
  const editing = mode === "edit" && campaign;
  const [name, setName] = useState(editing ? campaign.name || "" : "");
  const [description, setDescription] = useState(editing ? campaign.description || "" : "");
  const [status, setStatus] = useState(editing ? campaign.status || "active" : "active");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const clash = findNameClash(name, campaigns, editing ? campaign.id : null);
  const nameError = clash ? `A campaign called "${clash.name}" already exists.` : "";

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || clash) return;
    setBusy(true);
    setError("");
    try {
      const payload = { name: name.trim(), description: description.trim() };
      if (editing) payload.status = status;
      await onSave(payload);
    } catch (err) {
      setError(err.message || "Could not save the campaign.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true);
    setError("");
    try {
      await onDelete();
    } catch (err) {
      setError(err.message || "Could not delete the campaign.");
      setBusy(false);
    }
  };

  return (
    <div className="eng-modal-backdrop" onClick={onClose}>
      <div className="eng-modal-card" role="dialog" aria-modal="true" aria-labelledby="eng-campaign-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="eng-modal-header">
          <h3 className="eng-modal-title" id="eng-campaign-modal-title">{editing ? "Edit campaign" : "Create outreach campaign"}</h3>
          <button className="eng-modal-close" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>

        {confirmDelete ? (
          <div className="eng-modal-form">
            <div className="eng-danger-box" role="alert">
              <Icon name="alert-triangle" size={16} />
              <div>
                <strong>Delete “{campaign.name}”?</strong>
                <p>
                  This permanently removes its {prospectCount} prospect{prospectCount === 1 ? "" : "s"}, their drafts,
                  messages and activity history. Opt-outs are kept — they apply to your whole account.
                </p>
              </div>
            </div>
            {error && <p className="eng-field-hint is-error" role="alert">{error}</p>}
            <div className="eng-modal-actions">
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep campaign</Button>
              <Button type="button" variant="danger" icon="trash-2" onClick={doDelete} disabled={busy}>{busy ? "Deleting…" : "Delete campaign"}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="eng-modal-form" noValidate>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-campaign-name">Campaign name</label>
              <input
                id="eng-campaign-name"
                type="text"
                className="eng-input-field"
                placeholder="e.g. Q4 Healthcare SaaS Leaders"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(nameError)}
                autoFocus
              />
              {nameError && <p className="eng-field-hint is-error">{nameError} Choose a different name.</p>}
            </div>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-campaign-desc">Description</label>
              <textarea
                id="eng-campaign-desc"
                className="eng-textarea-field"
                rows={3}
                maxLength={1000}
                placeholder="Who this campaign targets and why — shown under the campaign selector."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {editing && (
              <div className="eng-form-group">
                <label className="eng-field-label" htmlFor="eng-campaign-status">Status</label>
                <select id="eng-campaign-status" className="eng-input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            )}
            {error && <p className="eng-field-hint is-error" role="alert">{error}</p>}
            <div className="eng-modal-actions">
              {editing && onDelete && (
                <Button type="button" variant="ghost" icon="trash-2" className="eng-modal-delete" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="primary" type="submit" icon="check" disabled={busy || !name.trim() || Boolean(clash)}>
                {busy ? "Saving…" : editing ? "Save changes" : "Create campaign"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
