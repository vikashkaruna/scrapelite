// AdminGeneral.jsx — configure global application behavioral settings.
// These parameters control runtime behavior (guest limits, etc.) without
// requiring a code change or redeployment. Settings are persisted to the
// Supabase app_config table (key='general') and cached client-side for 5 min.
import { useState, useEffect } from "react";
import { getGeneralConfig, saveGeneralConfig } from "../../lib/adminConfigService.js";
import { updateCachedSettings } from "../../lib/globalSettingsService.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const DEFAULTS = {
  guest_trial_soft_limit: 3,
  guest_trial_reprompt_interval: 2,
  guest_single_hard_limit: 10,
  guest_batch_hard_limit: 5,
};

function SettingField({ label, hint, value, onChange, min = 1, max = 1000, step = 1 }) {
  return (
    <div className="cf-field admin-general-field">
      <label>{label}</label>
      {hint && <p className="cf-hint">{hint}</p>}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      />
    </div>
  );
}

export default function AdminGeneral() {
  const showToast = useToast();
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [persisted, setPersisted] = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  // ── Guest trial settings ─────────────────────────────────────────────────────
  const [softLimit, setSoftLimit]           = useState(DEFAULTS.guest_trial_soft_limit);
  const [repromptInterval, setRepromptInterval] = useState(DEFAULTS.guest_trial_reprompt_interval);
  const [singleHardLimit, setSingleHardLimit] = useState(DEFAULTS.guest_single_hard_limit);
  const [batchHardLimit, setBatchHardLimit] = useState(DEFAULTS.guest_batch_hard_limit);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await getGeneralConfig();
      const s = data.settings || DEFAULTS;
      setSoftLimit(s.guest_trial_soft_limit ?? DEFAULTS.guest_trial_soft_limit);
      setRepromptInterval(s.guest_trial_reprompt_interval ?? DEFAULTS.guest_trial_reprompt_interval);
      setSingleHardLimit(s.guest_single_hard_limit ?? DEFAULTS.guest_single_hard_limit);
      setBatchHardLimit(s.guest_batch_hard_limit ?? DEFAULTS.guest_batch_hard_limit);
      setPersisted(data.persisted !== false);
    } catch (e) {
      setError("Settings endpoint unreachable — showing defaults. Run with Netlify Functions to load/save.");
      setSoftLimit(DEFAULTS.guest_trial_soft_limit);
      setRepromptInterval(DEFAULTS.guest_trial_reprompt_interval);
      setSingleHardLimit(DEFAULTS.guest_single_hard_limit);
      setBatchHardLimit(DEFAULTS.guest_batch_hard_limit);
      setPersisted(false);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    const settings = {
      guest_trial_soft_limit: softLimit,
      guest_trial_reprompt_interval: repromptInterval,
      guest_single_hard_limit: singleHardLimit,
      guest_batch_hard_limit: batchHardLimit,
    };
    try {
      const res = await saveGeneralConfig(settings);
      // Also update the local cache so changes take effect immediately in this tab.
      updateCachedSettings(settings);
      if (res.persisted === false) {
        showToast(res.warning || "Saved — Supabase not configured, not persisted server-side.");
      } else {
        showToast("General settings saved.");
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1800);
      }
    } catch (e) {
      showToast(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading">
          <Icon name="loader" size={18} className="spin" /> Loading settings…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">General Settings</h2>
          <p className="admin-section-sub">
            Global application behavior parameters. Changes propagate within 5 minutes
            (settings are cached client-side). Persisted to Supabase <code>app_config</code> row{" "}
            <code>key=&apos;general&apos;</code>.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={load}>Reload</Button>
      </div>

      {!persisted && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} />
          <span>
            Supabase isn&apos;t configured (<code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_KEY</code>),
            so changes won&apos;t persist server-side. The app will use these defaults until Supabase is wired up.
          </span>
        </div>
      )}
      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      {/* ── Guest Trial Settings ──────────────────────────────────────────── */}
      <div className="admin-general-group card card-pad">
        <div className="admin-general-group-head">
          <Icon name="flask" size={18} />
          <div>
            <h3 className="admin-general-group-title">Guest Trial Settings</h3>
            <p className="admin-general-group-desc">
              Controls how many free extractions non-registered visitors can perform before
              being prompted to sign up. Changes take effect within 5 minutes.
            </p>
          </div>
        </div>

        <div className="admin-general-fields">
          <SettingField
            label="Soft prompt threshold"
            hint="Show the sign-up nudge modal after this many single-URL extractions. The prompt re-appears every N extractions after this point."
            value={softLimit}
            onChange={setSoftLimit}
            min={1} max={100}
          />
          <SettingField
            label="Re-prompt interval"
            hint="After the soft threshold, show the modal again every N extractions so guests keep seeing the sign-up CTA."
            value={repromptInterval}
            onChange={setRepromptInterval}
            min={1} max={20}
          />
          <SettingField
            label="Single-URL hard limit"
            hint="Hard block: guest cannot perform any more single-URL extractions beyond this count. Must sign up or sign in to continue."
            value={singleHardLimit}
            onChange={setSingleHardLimit}
            min={1} max={1000}
          />
          <SettingField
            label="Batch run hard limit"
            hint="Hard block: guest cannot start any more batch runs beyond this count. Must sign up or sign in to continue."
            value={batchHardLimit}
            onChange={setBatchHardLimit}
            min={1} max={100}
          />
        </div>

        <div className="admin-general-summary">
          <Icon name="info" size={14} />
          <span>
            Current defaults: soft prompt at <b>{softLimit}</b> extraction{softLimit !== 1 ? "s" : ""},{" "}
            re-prompt every <b>{repromptInterval}</b>, single hard block at <b>{singleHardLimit}</b>,{" "}
            batch hard block at <b>{batchHardLimit}</b> run{batchHardLimit !== 1 ? "s" : ""}.
          </span>
        </div>

        <div className="admin-general-actions">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : savedTick ? "Saved!" : "Save settings"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSoftLimit(DEFAULTS.guest_trial_soft_limit);
              setRepromptInterval(DEFAULTS.guest_trial_reprompt_interval);
              setSingleHardLimit(DEFAULTS.guest_single_hard_limit);
              setBatchHardLimit(DEFAULTS.guest_batch_hard_limit);
            }}
          >
            Reset to defaults
          </Button>
        </div>
      </div>
    </div>
  );
}
