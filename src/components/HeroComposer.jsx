// HeroComposer.jsx — the unified, clutter-free Home input box.
//
// One composer handles every entry mode via a single compact action button that
// lives INSIDE the textarea (bottom-right) and changes its icon by mode:
//   • Single URL     → arrow-up   → inline extraction (global loader → /preview)
//   • Raw text/HTML  → arrow-up   → paste-anything extraction (no network)
//   • Multiple URLs  → layers     → routes to /batch (auto-runs)
//   • Scheduled      → calendar   → creates a schedule (single or batch) and opens /schedules
//
// Scheduling on Home is intentionally minimal: a "Schedule" preset dropdown arms
// a cadence (works for a single URL or a batch). Anything more (custom cadence,
// end date, editing) happens on the dedicated /schedules page — Home stays
// popup-free. The "Custom schedule…" item routes to /schedules with the current
// input pre-populated.
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { useExtraction } from "./ExtractionProvider.jsx";
import { useToast } from "./Toast.jsx";
import { ingestUrls } from "../lib/urlIngest.js";
import { classifyInput, extractUrls, normalizeUrl } from "../lib/utils.js";
import { enrichMeta } from "../lib/extractionPresets.js";
import { buildSchedule, saveSchedule, SCHEDULE_PRESETS, presetByKey } from "../lib/schedulerService.js";

// Map an intent → the enrichment-tab metadata so a custom/contacts/pricing run
// from the composer persists as a named tab on the Preview screen.
function enrichMetaForIntent(intent) {
  if (intent === "contacts") return enrichMeta("leadership");
  if (intent === "pricing")  return enrichMeta("pricing");
  if (intent === "custom")   return enrichMeta("custom");
  return null;
}

const TEXT_MIN_LEN = 40; // raw text shorter than this with no URL is likely a typo'd URL

function resolvePrompt({ intent, customPrompt }) {
  if (intent === "custom") return (customPrompt || "").trim();
  return (customPrompt || "").trim();
}

export default function HeroComposer({
  value,
  onChange,
  intent = "summary",
  customPrompt = "",
  renderJs = false,
  accentColor,
  placeholder,
}) {
  const navigate = useNavigate();
  const showToast = useToast();
  const { extract } = useExtraction();

  const [batchMode, setBatchMode] = useState(false);
  const [presetKey, setPresetKey] = useState(null); // armed cadence
  const [plusOpen, setPlusOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const fileRef = useRef(null);
  const plusRef = useRef(null);
  const presetRef = useRef(null);
  const taRef = useRef(null);

  // Close popovers on outside click
  useEffect(() => {
    if (!plusOpen && !presetMenuOpen) return;
    const handler = (e) => {
      if (plusRef.current && !plusRef.current.contains(e.target)) setPlusOpen(false);
      if (presetRef.current && !presetRef.current.contains(e.target)) setPresetMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [plusOpen, presetMenuOpen]);

  // Auto-grow textarea to fit content (capped by CSS max-height).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 260) + "px";
  }, [value, batchMode]);

  const classification = classifyInput(value);
  const { valid: detectedUrls } = extractUrls(value);
  const isMulti = batchMode || classification.kind === "multi";
  const urlCount = detectedUrls.length;
  // Raw pasted text can't be scheduled (no URL to re-fetch).
  const canSchedule = classification.kind !== "text";

  // ── Action mode → icon + label (the "intelligent" three-mode button) ────────
  const actionMode =
    presetKey && canSchedule ? "schedule" :
    isMulti                  ? "batch" :
    classification.kind === "text" ? "text" :
    intent === "map"         ? "map" : "single";

  const ACTION = {
    schedule: { icon: "calendar-clock", label: "Schedule" },
    batch:    { icon: "layers-2",       label: `Extract${urlCount ? ` ${urlCount}` : ""}` },
    text:     { icon: "zap",            label: "Extract" },
    map:      { icon: "network",        label: "Map" },
    single:   { icon: "zap",            label: "Extract" },
  }[actionMode];

  // ── CSV / file / text import (QW#1 — plain-text URL drag-drop) ────────────
  // Pure logic lives in lib/urlIngest.js (testable in isolation). The composer
  // is just the FileReader + dataTransfer glue + state updates.
  const importIngested = useCallback((text, sourceLabel) => {
    const { urls, source } = ingestUrls(text);
    if (urls.length === 0) {
      showToast("No URLs found. Add one URL per line or a CSV with a 'url' column.");
      return 0;
    }
    setBatchMode(true);
    onChange(urls.join("\n"));
    const via = source === "csv" ? "CSV" : "text";
    showToast(`${urls.length} URL${urls.length === 1 ? "" : "s"} imported from ${sourceLabel} (${via})`, "file-up");
    return urls.length;
  }, [onChange, showToast]);

  const importFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => importIngested(String(e.target.result || ""), file.name);
    reader.readAsText(file);
  }, [importIngested]);

  const onFileChange = (e) => {
    importFile(e.target.files?.[0] ?? null);
    e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) { importFile(file); return; }
    // No file — could be a URL dragged from the browser address bar, a
    // selection dragged from another tab, or text dragged from a code editor.
    const text =
      e.dataTransfer.getData("text/uri-list") ||
      e.dataTransfer.getData("text/plain") ||
      "";
    if (text.trim()) importIngested(text, "drop");
  };

  // Build a schedule draft from the current input (null when not schedulable).
  const buildDraft = () => {
    if (isMulti) {
      if (urlCount < 2) return null;
      return { type: "batch", target: detectedUrls, intent, customPrompt: resolvePrompt({ intent, customPrompt }), renderJs };
    }
    if (classification.kind === "single") {
      return { type: "track", target: normalizeUrl(classification.urls[0]), intent, customPrompt: resolvePrompt({ intent, customPrompt }), renderJs };
    }
    return null;
  };

  // ── Dispatch: the single action button ──────────────────────────────────────
  const runAction = async () => {
    const text = String(value || "").trim();
    if (!text) { taRef.current?.focus(); return; }

    // Scheduled (preset armed) — create the schedule and hand off to /schedules.
    if (presetKey && canSchedule) {
      const draft = buildDraft();
      if (!draft) {
        showToast(isMulti ? "Add at least 2 URLs to schedule a batch." : "Enter a URL to schedule.");
        return;
      }
      setBusy(true);
      try {
        const schedule = buildSchedule({ ...draft, cadenceKey: presetKey });
        await saveSchedule(schedule);
        showToast(`Scheduled · ${presetByKey(presetKey).label}`, "calendar-clock");
        navigate("/schedules", { state: { highlightId: schedule.id } });
      } catch (err) {
        console.error("[DatIQ] Schedule save failed:", err);
        showToast(err?.message || "Couldn't save the schedule. Please try again.");
      } finally {
        setBusy(false);
      }
      return;
    }

    // Batch / multi-URL → dedicated screen (auto-runs).
    if (isMulti || classification.kind === "csv") {
      const urls = classification.urls?.length ? classification.urls : detectedUrls;
      if (urls.length < 2) { showToast("Add at least 2 URLs for batch mode."); return; }
      navigate("/batch", { state: { urls, intent, autorun: true, source: classification.kind === "csv" ? "csv" : "multi" } });
      return;
    }

    // Raw text (paste-anything)
    if (classification.kind === "text") {
      if (text.length < TEXT_MIN_LEN && !/\s/.test(text)) {
        showToast("That doesn't look like a valid URL. Paste a full URL or longer text.");
        return;
      }
      const prompt = resolvePrompt({ intent, customPrompt });
      const opts = { rawText: text };
      if (prompt) {
        opts.customPrompt = prompt;
        const meta = enrichMetaForIntent(intent);
        if (meta) opts.enrichMeta = meta;
      }
      extract(`text://pasted-${Date.now().toString(36)}`, opts);
      return;
    }

    // Single URL
    const target = normalizeUrl(classification.urls[0] || text);
    if (intent === "map") { extract(target, { mapMode: true }); return; }
    const prompt = resolvePrompt({ intent, customPrompt });
    const opts = { renderJs };
    if (prompt) {
      opts.customPrompt = prompt;
      const meta = enrichMetaForIntent(intent);
      if (meta) opts.enrichMeta = meta;
    }
    extract(target, opts);
  };

  // "Custom schedule…" → hand off to the /schedules editor with the input prefilled.
  const goCustomSchedule = () => {
    setPresetMenuOpen(false);
    const draft = buildDraft();
    if (!draft) {
      showToast(isMulti ? "Add at least 2 URLs to schedule a batch." : "Enter a URL to schedule.");
      return;
    }
    navigate("/schedules", { state: { draftSchedule: { ...draft, cadenceKey: presetKey || undefined }, openEditor: true } });
  };

  // Enter submits in single mode; batch mode keeps Enter for newlines.
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isMulti) {
      e.preventDefault();
      runAction();
    }
  };

  const accent = accentColor ? { "--accent": accentColor } : undefined;
  const scheduleLabel = presetKey ? presetByKey(presetKey).label : "Schedule";

  return (
    <div
      className={"hero-composer" + (dragOver ? " hero-composer-drag" : "") + (isMulti ? " hero-composer-batch" : "")}
      style={accent}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="hero-composer-dropzone">
          <Icon name="upload" size={26} /> Drop a CSV, text file, or URL to import
        </div>
      )}

      {/* Input */}
      <textarea
        ref={taRef}
        className="hero-composer-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || (isMulti
          ? "Paste URLs — one per line — or import a CSV…"
          : "Paste a URL, or any text / HTML to extract…")}
        rows={isMulti ? 4 : 1}
        aria-label="URL or content to extract"
        autoFocus
      />

      {/* Q1 — Smart auto-detect hint: shows what the input was classified as. */}
      {classification.kind !== "empty" && classification.kind !== "single" && (
        <div className={`hero-composer-count hero-detect tone-${classification.kind}`}>
          {classification.kind === "multi" && (
            <>
              <Icon name="globe" size={12} />
              {urlCount} URL{urlCount !== 1 ? "s" : ""} detected — will run as batch
            </>
          )}
          {classification.kind === "csv" && (
            <>
              <Icon name="file-up" size={12} />
              CSV detected — {classification.urls.length} URL{classification.urls.length === 1 ? "" : "s"} found
            </>
          )}
          {classification.kind === "text" && (
            <>
              <Icon name="file-text" size={12} />
              Raw text detected — will run as paste-anything
            </>
          )}
          {presetKey && (
            <span className="hero-composer-armed">
              <Icon name="calendar-clock" size={11} /> {presetByKey(presetKey).label}
              <button type="button" onClick={() => setPresetKey(null)} aria-label="Clear schedule" className="hero-armed-x">
                <Icon name="x" size={10} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Legacy URL count hint for explicit batch mode */}
      {isMulti && classification.kind === "single" && urlCount > 0 && (
        <div className="hero-composer-count">
          <Icon name="globe" size={12} /> {urlCount} URL{urlCount !== 1 ? "s" : ""} detected
          {presetKey && (
            <span className="hero-composer-armed">
              <Icon name="calendar-clock" size={11} /> {presetByKey(presetKey).label}
              <button type="button" onClick={() => setPresetKey(null)} aria-label="Clear schedule" className="hero-armed-x">
                <Icon name="x" size={10} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="hero-composer-bar">
        <div className="hero-composer-left">
          {/* + menu */}
          <div className="hero-plus-wrap" ref={plusRef}>
            <button
              type="button"
              className="hero-icon-btn"
              onClick={() => setPlusOpen((v) => !v)}
              title="Add content — import a CSV of URLs"
              aria-label="Add content"
              aria-expanded={plusOpen}
            >
              <Icon name="plus" size={18} />
            </button>
            {plusOpen && (
              <div className="hero-menu">
                <button type="button" className="hero-menu-item" onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}>
                  <Icon name="file-up" size={15} /> <span><b>Import CSV</b><span className="hero-menu-hint">Upload a list of URLs</span></span>
                </button>
                <button type="button" className="hero-menu-item" onClick={() => { setPlusOpen(false); setBatchMode(true); taRef.current?.focus(); }}>
                  <Icon name="list-checks" size={15} /> <span><b>Paste multiple URLs</b><span className="hero-menu-hint">Switch to a batch list</span></span>
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={onFileChange}
              style={{ display: "none" }}
              aria-hidden="true"
            />
          </div>

          {/* Batch toggle (renamed from "Batch Mode") */}
          <button
            type="button"
            className={"hero-chip-btn" + (batchMode ? " on" : "")}
            onClick={() => { setBatchMode((v) => !v); if (batchMode) setPresetKey(null); }}
            title="Batch — extract many URLs at once. Paste a list, import a CSV, or drag-drop a file."
            aria-pressed={batchMode}
          >
            <Icon name={batchMode ? "toggle-right" : "toggle-left"} size={16} />
            Batch
          </button>

          {/* Schedule (preset cadence — works for a single URL or a batch) */}
          {canSchedule && (
            <div className="hero-plus-wrap" ref={presetRef}>
              <button
                type="button"
                className={"hero-chip-btn" + (presetKey ? " on" : "")}
                onClick={() => setPresetMenuOpen((v) => !v)}
                title="Schedule — re-run this on a recurring cadence and get alerted on changes"
                aria-expanded={presetMenuOpen}
              >
                <Icon name="calendar-clock" size={15} />
                {scheduleLabel}
                <Icon name="chevron-down" size={13} />
              </button>
              {presetMenuOpen && (
                <div className="hero-menu hero-menu-up">
                  <div className="hero-menu-head">
                    {isMulti ? "Run this batch automatically" : "Re-run & watch for changes"}
                  </div>
                  {SCHEDULE_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className={"hero-menu-item" + (presetKey === p.key ? " on" : "")}
                      onClick={() => { setPresetKey(p.key); setPresetMenuOpen(false); }}
                      title={p.desc}
                    >
                      <Icon name={p.icon} size={15} /> <span><b>{p.label}</b><span className="hero-menu-hint">{p.desc}</span></span>
                    </button>
                  ))}
                  <div className="hero-menu-sep" />
                  <button type="button" className="hero-menu-item hero-menu-custom" onClick={goCustomSchedule}>
                    <Icon name="settings" size={15} /> <span><b>Custom schedule…</b><span className="hero-menu-hint">Set days, time & end date on the Schedules page</span></span>
                  </button>
                  {presetKey && (
                    <button type="button" className="hero-menu-item hero-menu-clear" onClick={() => { setPresetKey(null); setPresetMenuOpen(false); }}>
                      <Icon name="x" size={15} /> Clear schedule
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compact action button — far right, within the composer border */}
        <button
          type="button"
          className={"hero-action-btn hero-action-" + actionMode}
          onClick={runAction}
          disabled={busy}
          title={actionMode === "schedule"
            ? `Create a ${scheduleLabel.toLowerCase()} schedule`
            : actionMode === "batch" ? `Extract ${urlCount} URLs` : ACTION.label}
          aria-label={ACTION.label}
        >
          {busy
            ? <Icon name="loader" size={15} className="spin" />
            : <Icon name={ACTION.icon} size={15} />}
          <span className="hero-action-label">{ACTION.label}</span>
        </button>
      </div>
    </div>
  );
}
