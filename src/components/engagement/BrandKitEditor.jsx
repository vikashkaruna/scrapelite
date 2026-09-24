// src/components/engagement/BrandKitEditor.jsx — who a campaign sends as, and what it says.
//
// ⚠️ The field names here are the ones the server STORES and the generator
// READS (engagementStore.cleanBrandKit / aiMessageGenerator.slots). The
// previous editor saved `value_proposition` / `primary_cta_url` while the
// generator read `value_prop` / `cta_url`, so no brand-kit edit ever reached a
// message. It also pre-filled DatIQ's name and an invented legal footer.
//
// Spreadsheet sync (Google Sheets / Airtable) is not built yet — the form that
// stood here saved to the browser only and synced nothing, so it is gone
// until the feature is real (review F-19).

import { useEffect, useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

const emptyKit = (kit = {}) => ({
  company_name: kit.company_name || "",
  value_prop: kit.value_prop || "",
  cta_label: kit.cta_label || "",
  cta_url: kit.cta_url || "",
  signoff_name: kit.signoff_name || "",
  tone: kit.tone || "professional",
});

const emptySender = (s = {}) => ({
  from_name: s.from_name || "",
  from_email: s.from_email || "",
  reply_to: s.reply_to || "",
});

export default function BrandKitEditor({
  campaign,
  senderDomains = [],
  onSaveBrandKit,
  onSaveSender,
  onLoadAccountKit, // () => Promise<{ brandKit, sender }> — throws with a readable message
  isSaving = false,
}) {
  const [brandKit, setBrandKit] = useState(() => emptyKit(campaign?.brand_kit));
  const [sender, setSender] = useState(() => emptySender(campaign?.sender));
  const [accountKitNote, setAccountKitNote] = useState(null); // { tone: "ok"|"error", text }
  const [loadingKit, setLoadingKit] = useState(false);

  // Fills the forms from the account Brand Kit — it does NOT save, so the
  // result can be reviewed first (owner decision 2026-09-24).
  const applyAccountKit = async () => {
    setLoadingKit(true);
    setAccountKitNote(null);
    try {
      const m = await onLoadAccountKit();
      const filledBrand = Object.keys(m.brandKit || {});
      const filledSender = Object.keys(m.sender || {});
      if (!filledBrand.length && !filledSender.length) {
        setAccountKitNote({ tone: "error", text: "Your account brand kit is empty — fill it in under Account → Brand kit." });
        return;
      }
      setBrandKit((k) => ({ ...k, ...m.brandKit }));
      if (filledSender.length) setSender((sv) => ({ ...sv, ...m.sender }));
      setAccountKitNote({ tone: "ok", text: `Filled from your account brand kit${filledSender.length ? " (including reply-to)" : ""}. Review, then save.` });
    } catch (e) {
      setAccountKitNote({ tone: "error", text: e.message || "Could not load your account brand kit." });
    } finally {
      setLoadingKit(false);
    }
  };

  // Re-seed when the selected campaign changes.
  useEffect(() => {
    setBrandKit(emptyKit(campaign?.brand_kit));
    setSender(emptySender(campaign?.sender));
  }, [campaign?.id]);

  const domain = sender.from_email.split("@")[1]?.toLowerCase() || "";
  const domainOk = !sender.from_email || senderDomains.includes(domain);

  return (
    <div className="eng-settings-root">
      <div className="eng-settings-grid">
        {/* Sender identity */}
        <div className="eng-settings-card">
          <div className="eng-settings-card-header">
            <div className="eng-settings-card-icon"><Icon name="mail" size={16} /></div>
            <div>
              <h3 className="eng-card-title">Sender</h3>
              <p className="eng-card-desc">Who recipients see the email from, and where their replies go.</p>
            </div>
          </div>

          <form
            className="eng-settings-form"
            onSubmit={(e) => { e.preventDefault(); onSaveSender?.(sender); }}
          >
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-from-name">From name</label>
              <input id="eng-from-name" type="text" className="eng-input-field" maxLength={80}
                placeholder="Priya from Acme"
                value={sender.from_name} onChange={(e) => setSender({ ...sender, from_name: e.target.value })} />
            </div>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-from-email">From email</label>
              <input id="eng-from-email" type="email" className="eng-input-field" required
                placeholder={senderDomains[0] ? `name@${senderDomains[0]}` : "name@your-domain.com"}
                aria-invalid={!domainOk}
                value={sender.from_email} onChange={(e) => setSender({ ...sender, from_email: e.target.value.trim() })} />
              <span className={`eng-field-hint ${domainOk ? "" : "is-error"}`}>
                {senderDomains.length
                  ? `Must be on a verified domain: ${senderDomains.join(", ")}`
                  : "No sending domain has been verified yet — sending is unavailable."}
              </span>
            </div>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-reply-to">Reply-to (optional)</label>
              <input id="eng-reply-to" type="email" className="eng-input-field"
                placeholder="you@your-company.com"
                value={sender.reply_to} onChange={(e) => setSender({ ...sender, reply_to: e.target.value.trim() })} />
              <span className="eng-field-hint">Replies go here. Use an inbox someone reads.</span>
            </div>
            <div className="eng-form-actions">
              <Button variant="primary" type="submit" disabled={isSaving || !domainOk || !sender.from_email} icon="check">
                Save sender
              </Button>
            </div>
          </form>
        </div>

        {/* Brand kit */}
        <div className="eng-settings-card">
          <div className="eng-settings-card-header">
            <div className="eng-settings-card-icon"><Icon name="sparkles" size={16} /></div>
            <div>
              <h3 className="eng-card-title">Brand kit</h3>
              <p className="eng-card-desc">Filled into every draft. Leave a field empty and the draft leaves it out rather than inventing it.</p>
            </div>
          </div>
          {onLoadAccountKit && (
            <div className="engx-account-kit">
              <Button type="button" variant="secondary" size="sm" icon="download" disabled={loadingKit} onClick={applyAccountKit}>
                {loadingKit ? "Loading…" : "Use my account brand kit"}
              </Button>
              {accountKitNote && (
                <span className={`eng-field-hint ${accountKitNote.tone === "error" ? "is-error" : ""}`} role="status">{accountKitNote.text}</span>
              )}
            </div>
          )}

          <form
            className="eng-settings-form"
            onSubmit={(e) => { e.preventDefault(); onSaveBrandKit?.(brandKit); }}
          >
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-company">Company / product name</label>
              <input id="eng-company" type="text" className="eng-input-field" maxLength={80}
                value={brandKit.company_name} onChange={(e) => setBrandKit({ ...brandKit, company_name: e.target.value })} />
            </div>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-value">What you offer (one line)</label>
              <textarea id="eng-value" className="eng-textarea-field" rows={2} maxLength={200}
                placeholder="e.g. same-day payroll for teams under 50"
                value={brandKit.value_prop} onChange={(e) => setBrandKit({ ...brandKit, value_prop: e.target.value })} />
            </div>
            <div className="eng-form-row">
              <div className="eng-form-group">
                <label className="eng-field-label" htmlFor="eng-cta-label">Link label</label>
                <input id="eng-cta-label" type="text" className="eng-input-field" maxLength={60}
                  value={brandKit.cta_label} onChange={(e) => setBrandKit({ ...brandKit, cta_label: e.target.value })} />
              </div>
              <div className="eng-form-group">
                <label className="eng-field-label" htmlFor="eng-cta-url">Link URL</label>
                <input id="eng-cta-url" type="url" className="eng-input-field"
                  placeholder="https://"
                  value={brandKit.cta_url} onChange={(e) => setBrandKit({ ...brandKit, cta_url: e.target.value })} />
              </div>
            </div>
            <div className="eng-form-group">
              <label className="eng-field-label" htmlFor="eng-signoff">Sign-off (up to 4 lines)</label>
              <textarea id="eng-signoff" className="eng-textarea-field" rows={3} maxLength={200}
                placeholder={"e.g. Priya Sharma\nHead of Growth, Acme"}
                value={brandKit.signoff_name} onChange={(e) => setBrandKit({ ...brandKit, signoff_name: e.target.value })} />
            </div>
            <p className="eng-field-hint">
              Every email carries a one-click unsubscribe link automatically, and every draft is
              reviewed by a person before it can be sent.
            </p>
            <div className="eng-form-actions">
              <Button variant="primary" type="submit" disabled={isSaving} icon="check">Save brand kit</Button>
            </div>
          </form>
        </div>
      </div>

      <div className="eng-settings-card eng-settings-note">
        <Icon name="database" size={16} />
        <p>
          <strong>Google Sheets and Airtable sync</strong> isn't available yet. Import prospects
          with <em>Import</em> (CSV) or from a DatIQ extraction in the meantime.
        </p>
      </div>
    </div>
  );
}
