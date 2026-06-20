// ScheduleEditor.jsx — inline create/edit panel for the /schedules page.
//
// Replaces the old Home popup. Supports preset cadences AND a custom builder
// (frequency · time · weekday/day-of-month), an "alive until" end date, alert
// email, name, intent, and (for batch) an editable URL list. Used both for new
// schedules (handed off from Home with a prefilled draft) and for editing
// existing ones in place.
import { useState, useMemo } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { useAuth } from "./AuthProvider.jsx";
import {
  SCHEDULE_PRESETS,
  presetByKey,
  buildSchedule,
  applyEdits,
  saveSchedule,
  buildCron,
  describeCron,
  estimateNextRun,
} from "../lib/schedulerService.js";
import { isValidEmail, fmtDate, hostOf, extractUrls } from "../lib/utils.js";

const INTENTS = [
  { key: "summary",  icon: "sparkles", label: "AI summary" },
  { key: "contacts", icon: "users",    label: "Contacts" },
  { key: "pricing",  icon: "hash",     label: "Pricing" },
  { key: "custom",   icon: "code",     label: "Custom" },
];

const FREQS = [
  { key: "hourly",  label: "Hourly" },
  { key: "daily",   label: "Daily" },
  { key: "weekday", label: "Weekdays" },
  { key: "weekly",  label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];
const DOW = [["1", "Mon"], ["2", "Tue"], ["3", "Wed"], ["4", "Thu"], ["5", "Fri"], ["6", "Sat"], ["0", "Sun"]];

// Best-effort parse of a cron back into builder fields (for editing custom schedules).
function cronToBuilder(cron) {
  const parts = String(cron || "").trim().split(/\s+/);
  const out = { frequency: "daily", hour: 9, minute: 0, weekday: 1, dayOfMonth: 1, everyHours: 6 };
  if (parts.length !== 5) return out;
  const [min, hour, dom, , dow] = parts;
  out.minute = parseInt(min, 10) || 0;
  if (hour.startsWith("*/")) { out.frequency = "hourly"; out.everyHours = parseInt(hour.slice(2), 10) || 6; return out; }
  out.hour = parseInt(hour, 10) || 9;
  if (dow === "1-5") out.frequency = "weekday";
  else if (dow !== "*" && dow !== "?") { out.frequency = "weekly"; out.weekday = parseInt(dow, 10) || 1; }
  else if (dom !== "*" && dom !== "?") { out.frequency = "monthly"; out.dayOfMonth = parseInt(dom, 10) || 1; }
  else out.frequency = "daily";
  return out;
}

export default function ScheduleEditor({ draft, existing, onSaved, onCancel }) {
  const showToast = useToast();
  const { user } = useAuth();

  const seed = existing || draft || {};
  const isEdit = Boolean(existing);
  const isBatch = (seed.type === "batch");

  const [intent, setIntent] = useState(seed.intent || "summary");
  const [customPrompt, setCustomPrompt] = useState(seed.customPrompt || "");
  const [label, setLabel] = useState(seed.label || "");
  const [alertEmail, setAlertEmail] = useState(seed.alertEmail || user?.email || "");
  const [expiresAt, setExpiresAt] = useState(seed.expiresAt ? seed.expiresAt.slice(0, 10) : "");
  const [emailTouched, setEmailTouched] = useState(false);

  // Target editing
  const [singleUrl, setSingleUrl] = useState(isBatch ? "" : (seed.target || ""));
  const [batchText, setBatchText] = useState(isBatch ? (Array.isArray(seed.target) ? seed.target.join("\n") : "") : "");

  // Cadence: preset key, or "custom" with the builder
  const initialCadence = seed.cadenceKey || (draft?.cadenceKey) || "daily";
  const [cadenceKey, setCadenceKey] = useState(initialCadence);
  const [builder, setBuilder] = useState(() => cronToBuilder(seed.cron));

  const customCron = useMemo(() => buildCron(builder), [builder]);
  const effectiveCron = cadenceKey === "custom" ? customCron : presetByKey(cadenceKey).cron;
  const nextRun = useMemo(() => estimateNextRun(effectiveCron), [effectiveCron]);

  const emailOk = !alertEmail.trim() || isValidEmail(alertEmail);
  const setB = (patch) => setBuilder((b) => ({ ...b, ...patch }));

  const nextRunText = () => {
    const d = new Date(nextRun);
    return `${fmtDate(nextRun)} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };

  const handleSave = async () => {
    if (!emailOk) { setEmailTouched(true); return; }

    // Resolve target
    let target;
    if (isBatch) {
      const { valid } = extractUrls(batchText);
      if (valid.length < 2) { showToast("Add at least 2 valid URLs."); return; }
      target = valid;
    } else {
      const { valid } = extractUrls(singleUrl);
      if (valid.length < 1) { showToast("Enter a valid URL to track."); return; }
      target = valid[0];
    }

    const common = {
      intent,
      customPrompt: intent === "custom" ? customPrompt.trim() : (seed.customPrompt || ""),
      cadenceKey,
      cron: effectiveCron,
      alertEmail,
      label,
      expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
      target,
    };

    try {
      let schedule;
      if (isEdit) {
        schedule = applyEdits(existing, common);
      } else {
        schedule = buildSchedule({ type: seed.type || "track", renderJs: seed.renderJs || false, ...common });
      }
      await saveSchedule(schedule);
      showToast(isEdit ? "Schedule updated" : "Schedule created", "calendar-clock");
      onSaved?.(schedule);
    } catch (err) {
      console.error("[DatIQ] Schedule save failed:", err);
      showToast("Couldn't save the schedule. Please try again.");
    }
  };

  return (
    <div className="sch-editor card rise">
      <div className="sch-editor-head">
        <div className="sch-editor-icon"><Icon name={isBatch ? "layers-2" : "repeat"} size={20} /></div>
        <div>
          <h2 className="sch-editor-title">{isEdit ? "Edit schedule" : isBatch ? "Schedule a batch" : "Track changes on a page"}</h2>
          <p className="sch-editor-sub">
            {isBatch ? "Re-run this multi-URL extraction automatically." : "Re-extract this page on a cadence and get alerted when it changes."}
          </p>
        </div>
        <button className="sch-editor-close" onClick={onCancel} aria-label="Close editor"><Icon name="x" size={18} /></button>
      </div>

      {/* Target */}
      <div className="sch-editor-section">
        <label className="schedule-label">{isBatch ? "URLs" : "Page URL"}</label>
        {isBatch ? (
          <textarea
            className="sch-editor-textarea"
            rows={4}
            placeholder={"https://example.com\nhttps://stripe.com/pricing"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
        ) : (
          <div className="field-shell field-shell-sm">
            <span className="field-lead"><Icon name="globe" size={16} /></span>
            <input className="field-input" type="text" placeholder="https://example.com" value={singleUrl} onChange={(e) => setSingleUrl(e.target.value)} />
          </div>
        )}
        {isBatch && (() => { const { valid } = extractUrls(batchText); return <span className="sch-editor-hint"><Icon name="globe" size={12} /> {valid.length} URL{valid.length !== 1 ? "s" : ""}</span>; })()}
      </div>

      {/* Intent */}
      <div className="sch-editor-section">
        <label className="schedule-label">What to extract</label>
        <div className="sch-editor-chips">
          {INTENTS.map((i) => (
            <button key={i.key} type="button" className={"sch-editor-chip" + (intent === i.key ? " on" : "")} onClick={() => setIntent(i.key)}>
              <Icon name={i.icon} size={13} /> {i.label}
            </button>
          ))}
        </div>
        {intent === "custom" && (
          <textarea className="sch-editor-textarea" rows={2} style={{ marginTop: 8 }} placeholder='e.g. "Extract the pricing tiers and their prices"' value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} />
        )}
      </div>

      {/* Cadence */}
      <div className="sch-editor-section">
        <label className="schedule-label">How often</label>
        <div className="sch-editor-chips">
          {SCHEDULE_PRESETS.map((p) => (
            <button key={p.key} type="button" className={"sch-editor-chip" + (cadenceKey === p.key ? " on" : "")} onClick={() => setCadenceKey(p.key)} title={p.desc}>
              <Icon name={p.icon} size={13} /> {p.label}
            </button>
          ))}
          <button type="button" className={"sch-editor-chip" + (cadenceKey === "custom" ? " on" : "")} onClick={() => setCadenceKey("custom")}>
            <Icon name="settings" size={13} /> Custom
          </button>
        </div>

        {cadenceKey === "custom" && (
          <div className="sch-custom-builder">
            <div className="sch-custom-row">
              <label>Frequency</label>
              <select value={builder.frequency} onChange={(e) => setB({ frequency: e.target.value })} className="sch-select">
                {FREQS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>
            {builder.frequency === "hourly" && (
              <div className="sch-custom-row">
                <label>Every</label>
                <select value={builder.everyHours} onChange={(e) => setB({ everyHours: Number(e.target.value) })} className="sch-select">
                  {[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n} hour{n !== 1 ? "s" : ""}</option>)}
                </select>
              </div>
            )}
            {builder.frequency === "weekly" && (
              <div className="sch-custom-row">
                <label>On</label>
                <select value={builder.weekday} onChange={(e) => setB({ weekday: Number(e.target.value) })} className="sch-select">
                  {DOW.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </div>
            )}
            {builder.frequency === "monthly" && (
              <div className="sch-custom-row">
                <label>Day</label>
                <select value={builder.dayOfMonth} onChange={(e) => setB({ dayOfMonth: Number(e.target.value) })} className="sch-select">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}
            {builder.frequency !== "hourly" && (
              <div className="sch-custom-row">
                <label>Time (UTC)</label>
                <select value={builder.hour} onChange={(e) => setB({ hour: Number(e.target.value) })} className="sch-select">
                  {Array.from({ length: 24 }, (_, i) => i).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </div>
            )}
          </div>
        )}
        <p className="schedule-nextrun">
          <Icon name="calendar-clock" size={12} /> {describeCron(effectiveCron)} · first run ≈ {nextRunText()}
        </p>
      </div>

      {/* Alert email + end date */}
      <div className="sch-editor-grid2">
        <div className="sch-editor-section">
          <label className="schedule-label" htmlFor="sch-email">Alert email <span className="schedule-label-opt">(optional)</span></label>
          <div className={"field-shell field-shell-sm" + (emailTouched && !emailOk ? " field-error" : "")}>
            <span className="field-lead"><Icon name="mail" size={16} /></span>
            <input id="sch-email" className="field-input" type="email" placeholder="you@company.com" value={alertEmail} onChange={(e) => { setAlertEmail(e.target.value); if (emailTouched) setEmailTouched(false); }} />
          </div>
          {emailTouched && !emailOk && <span className="schedule-field-err">Invalid email.</span>}
        </div>
        <div className="sch-editor-section">
          <label className="schedule-label" htmlFor="sch-exp">Run until <span className="schedule-label-opt">(optional)</span></label>
          <div className="field-shell field-shell-sm">
            <span className="field-lead"><Icon name="calendar" size={16} /></span>
            <input id="sch-exp" className="field-input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Name */}
      <div className="sch-editor-section">
        <label className="schedule-label" htmlFor="sch-name">Name <span className="schedule-label-opt">(optional)</span></label>
        <div className="field-shell field-shell-sm">
          <span className="field-lead"><Icon name="tag" size={16} /></span>
          <input id="sch-name" className="field-input" type="text" placeholder={isBatch ? "Competitor pricing watch" : "Homepage hero monitor"} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>

      <div className="sch-editor-actions">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={handleSave}>{isEdit ? "Save changes" : "Create schedule"}</Button>
      </div>
    </div>
  );
}
