// src/components/engagement/BrandKitEditor.jsx — Brand Voice, Guardrails & Two-Way Sync Settings
import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

export default function BrandKitEditor({
  campaign,
  syncConfig,
  onSaveBrandKit,
  onSaveSyncConfig,
  onTriggerSync,
  isSaving = false,
  isSyncing = false,
}) {
  const [brandKit, setBrandKit] = useState({
    company_name: campaign?.brand_kit?.company_name || "DatIQ",
    value_proposition: campaign?.brand_kit?.value_proposition || "Zero-code web extraction & market intelligence platform",
    primary_cta_text: campaign?.brand_kit?.primary_cta_text || "Schedule a 10-Min Demo",
    primary_cta_url: campaign?.brand_kit?.primary_cta_url || "https://datiq.app/demo",
    tone: campaign?.brand_kit?.tone || "professional",
    compliance_footer: campaign?.brand_kit?.compliance_footer || "Reply STOP to unsubscribe. DatIQ Technologies Inc.",
    ab_testing_enabled: campaign?.brand_kit?.ab_testing_enabled ?? true,
    require_human_approval: campaign?.brand_kit?.require_human_approval ?? true,
  });

  const [sync, setSync] = useState({
    provider: syncConfig?.provider || "airtable",
    spreadsheet_id: syncConfig?.credentials?.spreadsheet_id || "",
    sheet_name: syncConfig?.credentials?.sheet_name || "Prospects",
    airtable_base_id: syncConfig?.credentials?.airtable_base_id || "",
    airtable_table_name: syncConfig?.credentials?.airtable_table_name || "Prospects",
    sync_direction: syncConfig?.sync_direction || "bi_directional",
    sync_frequency: syncConfig?.sync_frequency || "hourly",
    is_active: syncConfig?.is_active ?? true,
  });

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleBrandKitSubmit = async (e) => {
    e.preventDefault();
    if (!onSaveBrandKit) return;
    await onSaveBrandKit(brandKit);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleSyncSubmit = async (e) => {
    e.preventDefault();
    if (!onSaveSyncConfig) return;
    await onSaveSyncConfig({
      provider: sync.provider,
      sync_direction: sync.sync_direction,
      sync_frequency: sync.sync_frequency,
      is_active: sync.is_active,
      credentials: {
        spreadsheet_id: sync.spreadsheet_id,
        sheet_name: sync.sheet_name,
        airtable_base_id: sync.airtable_base_id,
        airtable_table_name: sync.airtable_table_name,
      },
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="eng-settings-root">
      {savedSuccess && (
        <div className="eng-alert-banner eng-alert-success">
          <Icon name="check-circle" size={16} />
          <span>Configuration saved successfully!</span>
        </div>
      )}

      <div className="eng-settings-grid">
        {/* Left Card: AI Brand Kit & Guardrails */}
        <div className="eng-settings-card">
          <div className="eng-settings-card-header">
            <div className="eng-settings-card-icon"><Icon name="sparkles" size={16} /></div>
            <div>
              <h3 className="eng-card-title">AI Brand Kit & Tone of Voice</h3>
              <p className="eng-card-desc">Defines company positioning, CTAs, and compliance guardrails used by the AI copy generator</p>
            </div>
          </div>

          <form onSubmit={handleBrandKitSubmit} className="eng-settings-form">
            <div className="eng-form-group">
              <label className="eng-field-label">Company / Product Name</label>
              <input
                type="text"
                className="eng-input-field"
                value={brandKit.company_name}
                onChange={(e) => setBrandKit({ ...brandKit, company_name: e.target.value })}
                required
              />
            </div>

            <div className="eng-form-group">
              <label className="eng-field-label">Value Proposition / One-Liner</label>
              <textarea
                className="eng-textarea-field"
                rows={2}
                value={brandKit.value_proposition}
                onChange={(e) => setBrandKit({ ...brandKit, value_proposition: e.target.value })}
                required
              />
            </div>

            <div className="eng-form-row">
              <div className="eng-form-group">
                <label className="eng-field-label">Primary CTA Label</label>
                <input
                  type="text"
                  className="eng-input-field"
                  value={brandKit.primary_cta_text}
                  onChange={(e) => setBrandKit({ ...brandKit, primary_cta_text: e.target.value })}
                />
              </div>

              <div className="eng-form-group">
                <label className="eng-field-label">Primary CTA Target URL</label>
                <input
                  type="url"
                  className="eng-input-field"
                  value={brandKit.primary_cta_url}
                  onChange={(e) => setBrandKit({ ...brandKit, primary_cta_url: e.target.value })}
                />
              </div>
            </div>

            <div className="eng-form-group">
              <label className="eng-field-label">Tone of Voice</label>
              <select
                className="eng-select-field"
                value={brandKit.tone}
                onChange={(e) => setBrandKit({ ...brandKit, tone: e.target.value })}
              >
                <option value="professional">Professional & Authoritative</option>
                <option value="consultative">Consultative & Solution-Oriented</option>
                <option value="friendly">Friendly & Warm</option>
                <option value="direct">Direct & Concise (High Signal)</option>
                <option value="urgent">Time-Sensitive / Urgent</option>
              </select>
            </div>

            <div className="eng-form-group">
              <label className="eng-field-label">Compliance Disclosure & Opt-Out Footer</label>
              <input
                type="text"
                className="eng-input-field"
                value={brandKit.compliance_footer}
                onChange={(e) => setBrandKit({ ...brandKit, compliance_footer: e.target.value })}
              />
            </div>

            {/* Checkbox toggles */}
            <div className="eng-toggles-list">
              <label className="eng-checkbox-label">
                <input
                  type="checkbox"
                  checked={brandKit.ab_testing_enabled}
                  onChange={(e) => setBrandKit({ ...brandKit, ab_testing_enabled: e.target.checked })}
                />
                <span>Generate Multi-Variant Copy for A/B Testing (Variants A, B)</span>
              </label>

              <label className="eng-checkbox-label">
                <input
                  type="checkbox"
                  checked={brandKit.require_human_approval}
                  onChange={(e) => setBrandKit({ ...brandKit, require_human_approval: e.target.checked })}
                />
                <span>Require Human-in-the-Loop Approval Before Dispatch</span>
              </label>
            </div>

            <div className="eng-form-actions">
              <Button variant="primary" type="submit" disabled={isSaving} icon="check">
                {isSaving ? "Saving..." : "Save Brand Kit"}
              </Button>
            </div>
          </form>
        </div>

        {/* Right Card: Google Sheets & Airtable Two-Way Sync */}
        <div className="eng-settings-card">
          <div className="eng-settings-card-header">
            <div className="eng-settings-card-icon" style={{ color: "#3b82f6" }}><Icon name="database" size={16} /></div>
            <div>
              <h3 className="eng-card-title">Two-Way CRM & Spreadsheet Sync</h3>
              <p className="eng-card-desc">Synchronize prospects, stage updates, and delivery stats with Airtable or Google Sheets</p>
            </div>
          </div>

          <form onSubmit={handleSyncSubmit} className="eng-settings-form">
            <div className="eng-form-group">
              <label className="eng-field-label">Data Store Provider</label>
              <div className="eng-provider-selector">
                <button
                  type="button"
                  className={`eng-provider-btn ${sync.provider === "airtable" ? "active" : ""}`}
                  onClick={() => setSync({ ...sync, provider: "airtable" })}
                >
                  <Icon name="database" size={14} /> Airtable Base
                </button>
                <button
                  type="button"
                  className={`eng-provider-btn ${sync.provider === "google_sheets" ? "active" : ""}`}
                  onClick={() => setSync({ ...sync, provider: "google_sheets" })}
                >
                  <Icon name="file-text" size={14} /> Google Sheets
                </button>
              </div>
            </div>

            {sync.provider === "airtable" ? (
              <>
                <div className="eng-form-group">
                  <label className="eng-field-label">Airtable Base ID</label>
                  <input
                    type="text"
                    className="eng-input-field"
                    placeholder="appXXXXXXXXXXXXXX"
                    value={sync.airtable_base_id}
                    onChange={(e) => setSync({ ...sync, airtable_base_id: e.target.value })}
                  />
                </div>
                <div className="eng-form-group">
                  <label className="eng-field-label">Table Name</label>
                  <input
                    type="text"
                    className="eng-input-field"
                    placeholder="Prospects"
                    value={sync.airtable_table_name}
                    onChange={(e) => setSync({ ...sync, airtable_table_name: e.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="eng-form-group">
                  <label className="eng-field-label">Google Sheet ID or URL</label>
                  <input
                    type="text"
                    className="eng-input-field"
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                    value={sync.spreadsheet_id}
                    onChange={(e) => setSync({ ...sync, spreadsheet_id: e.target.value })}
                  />
                </div>
                <div className="eng-form-group">
                  <label className="eng-field-label">Tab / Sheet Name</label>
                  <input
                    type="text"
                    className="eng-input-field"
                    placeholder="Sheet1"
                    value={sync.sheet_name}
                    onChange={(e) => setSync({ ...sync, sheet_name: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="eng-form-row">
              <div className="eng-form-group">
                <label className="eng-field-label">Sync Direction</label>
                <select
                  className="eng-select-field"
                  value={sync.sync_direction}
                  onChange={(e) => setSync({ ...sync, sync_direction: e.target.value })}
                >
                  <option value="bi_directional">Two-Way (Bidirectional)</option>
                  <option value="import_only">Import Only (From Sheet/Base)</option>
                  <option value="export_only">Export Only (To Sheet/Base)</option>
                </select>
              </div>

              <div className="eng-form-group">
                <label className="eng-field-label">Sync Cadence</label>
                <select
                  className="eng-select-field"
                  value={sync.sync_frequency}
                  onChange={(e) => setSync({ ...sync, sync_frequency: e.target.value })}
                >
                  <option value="realtime">Webhook / Real-Time</option>
                  <option value="hourly">Hourly Automated</option>
                  <option value="daily">Daily Batch</option>
                  <option value="manual">Manual On-Demand</option>
                </select>
              </div>
            </div>

            <div className="eng-form-actions">
              <Button variant="secondary" type="submit" disabled={isSaving} icon="check">
                Save Sync Settings
              </Button>
              {onTriggerSync && (
                <Button
                  variant="primary"
                  type="button"
                  onClick={onTriggerSync}
                  disabled={isSyncing}
                  icon="refresh-cw"
                >
                  {isSyncing ? "Syncing..." : "Sync Now"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
