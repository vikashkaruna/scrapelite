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
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import { useExtraction } from "./ExtractionProvider.jsx";
import { useBatchRun } from "./BatchRunProvider.jsx";
import { useToast } from "./Toast.jsx";
import { ingestUrls } from "../lib/urlIngest.js";
import { classifyInput, extractUrls, normalizeUrl } from "../lib/utils.js";
import { knownDisallowedHost } from "../lib/scrapeConsentService.js";
import { enrichMeta, enrichMetaForIntent } from "../lib/extractionPresets.js";
import { buildSchedule, saveSchedule, SCHEDULE_PRESETS, presetByKey } from "../lib/schedulerService.js";


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
  generateContent = null,
  accentColor,
  placeholder,
}) {
  const navigate = useNavigate();
  const showToast = useToast();
  const { extract } = useExtraction();
  const { startBatchRun } = useBatchRun();

  const [batchMode, setBatchMode] = useState(false);
  // Sticky "run in background" preference — lives in the + menu rather than as
  // another toolbar chip, so the composer's bottom row stays uncluttered.
  const [background, setBackground] = useState(() => {
    try { return localStorage.getItem("datiq.runInBackground") === "1"; } catch { return false; }
  });
  // When prose carries links we ask instead of guessing: "extract the N links"
  // and "extract this text as one page" are both legitimate readings and only
  // the reader knows which they meant. null = not yet answered.
  const [embeddedChoice, setEmbeddedChoice] = useState(null); // null | "urls" | "text"
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
  // Prose carrying >= 2 links. Answered via the inline chooser below; until it
  // is answered the action button stays in whatever mode the raw text implies.
  const isEmbedded = classification.kind === "embedded";
  const embeddedAsUrls = isEmbedded && embeddedChoice === "urls";
  const embeddedAsText = isEmbedded && embeddedChoice === "text";
  const isMulti = batchMode || classification.kind === "multi" || embeddedAsUrls;
  const urlCount = detectedUrls.length;
  // Raw pasted text can't be scheduled (no URL to re-fetch).
  const canSchedule = classification.kind !== "text" && !embeddedAsText;
  // Discoverability audits exactly one page, so it needs one resolvable URL.
  // A batch of 40 is not a discoverability request; the benchmark flow on
  // /discoverability is, and that is a different screen.
  const canDiscover = detectedUrls.length === 1 && !embeddedAsText;

  // Pre-flight hint for sites we know disallow every crawler. A HINT ONLY: it
  // never blocks submission, because robots.txt is fetched live on the server
  // and is the only thing that decides. Its job is to stop someone learning
  // that LinkedIn is off-limits by watching a request fail. First match wins —
  // naming one site is useful, listing six is noise.
  const disallowedHint = detectedUrls.map(knownDisallowedHost).find(Boolean) || null;

  // Reset the chooser whenever the input changes shape, so a previous answer
  // can't silently apply to a completely different paste.
  useEffect(() => { setEmbeddedChoice(null); }, [classification.kind, urlCount]);

  // Persist the background preference.
  useEffect(() => {
    try { localStorage.setItem("datiq.runInBackground", background ? "1" : "0"); } catch { /* ignore */ }
  }, [background]);

  // ── Action mode → icon + label (the "intelligent" three-mode button) ────────
  const actionMode =
    presetKey && canSchedule ? "schedule" :
    isMulti                  ? "batch" :
    (classification.kind === "text" || embeddedAsText) ? "text" :
    isEmbedded               ? "choose" :
    intent === "map"         ? "map" : "single";

  const ACTION = {
    schedule: { icon: "calendar-clock", label: "Schedule" },
    batch:    { icon: "layers-2",       label: `Extract${urlCount ? ` ${urlCount}` : ""}` },
    text:     { icon: "zap",            label: "Extract" },
    // Waiting on the embedded chooser — pressing it just focuses the question.
    choose:   { icon: "help-circle",    label: "Choose" },
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

    // Prose with links, question not yet answered — don't guess.
    if (isEmbedded && !embeddedChoice) {
      showToast(`Found ${urlCount} links — choose whether to extract them or this text.`);
      return;
    }

    // Batch / multi-URL → dedicated screen (auto-runs).
    if (isMulti || classification.kind === "csv") {
      const urls = classification.urls?.length ? classification.urls : detectedUrls;
      if (urls.length < 2) { showToast("Add at least 2 URLs for batch mode."); return; }
      // Background: start the run right here and stay put. Navigating to /batch
      // to then say "you can navigate away" would defeat the point — the whole
      // request is not to be moved off the page. The run lives in
      // BatchRunProvider either way, so it doesn't care which route started it.
      if (background) {
        startBatchRun({
          urls,
          intent,
          renderJs,
          customPrompt: resolvePrompt({ intent, customPrompt }),
          generateContent,
          background: true,
        });
        return;
      }

      // Foreground: hand off to /batch, which auto-runs and shows the table.
      // Carry the full run configuration. Only { urls, intent, autorun } used to
      // travel, so a Home batch with intent:"custom" arrived with an empty
      // prompt and auto-ran immediately — silently extracting nothing useful.
      // renderJs was dropped the same way.
      navigate("/batch", {
        state: {
          urls,
          intent,
          autorun: true,
          source: classification.kind === "csv" ? "csv" : "multi",
          customPrompt: resolvePrompt({ intent, customPrompt }),
          renderJs,
          generateContent,
          background,
        },
      });
      return;
    }

    // Raw text (paste-anything)
    if (classification.kind === "text" || embeddedAsText) {
      if (text.length < TEXT_MIN_LEN && !/\s/.test(text)) {
        showToast("That doesn't look like a valid URL. Paste a full URL or longer text.");
        return;
      }
      const prompt = resolvePrompt({ intent, customPrompt });
      const opts = { rawText: text, intent, background };
      if (generateContent) opts.generateContent = generateContent;
      if (prompt) {
        opts.customPrompt = prompt;
        const meta = enrichMetaForIntent(intent, prompt);
        if (meta) opts.enrichMeta = meta;
      }
      extract(`text://pasted-${Date.now().toString(36)}`, opts);
      return;
    }

    // Single URL
    const target = normalizeUrl(classification.urls[0] || text);
    if (intent === "map") { extract(target, { mapMode: true, intent }); return; }
    const prompt = resolvePrompt({ intent, customPrompt });
    const opts = { renderJs, intent, background };
    if (generateContent) opts.generateContent = generateContent;
    if (prompt) {
      opts.customPrompt = prompt;
      const meta = enrichMetaForIntent(intent, prompt);
      if (meta) opts.enrichMeta = meta;
    }
    extract(target, opts);
  };

  // "Extract all N links" — reuse the same ingest path drag-drop and CSV import
  // already use, so there is exactly one way text becomes a URL list.
  const chooseEmbeddedUrls = () => {
    setEmbeddedChoice("urls");
    setBatchMode(true);
    onChange(classification.urls.join("\n"));
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
  }

  /**
   * Hand the pasted URL to /discoverability with the run armed.
   *
   * Router state, not a query string: the URL is the user's, not ours to put in
   * our own address bar, and /discoverability is a private prefix whose noindex
   * rules are an exact path match. `navigate`, never window.location — a hard
   * navigation would drop the SPA and, for any prerendered route, land on a
   * static snapshot instead of the app.
   */
  function goDiscover() {
    const target = detectedUrls[0];
    if (!target) return;
    navigate("/discoverability", { state: { auditUrl: normalizeUrl(target), autorun: true } });
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
          {isEmbedded && (
            <>
              <Icon name="link" size={12} />
              {embeddedChoice === "text"
                ? "Will extract this text as one page"
                : `${urlCount} links found in this text`}
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

      {/* Known-blocked host — warn before the request, not after. This is a
          hint, not a gate: the button stays enabled, because this list can go
          stale and only the live robots.txt on the server is authoritative. */}
      {disallowedHint && (
        <div className="hero-blocked-hint" role="status">
          <Icon name="shield" size={13} />
          <span>
            <b>{disallowedHint.label}</b> blocks automated tools in its robots.txt,
            and DatIQ honours that — this will be declined. Try the company's own
            website instead.
          </span>
        </div>
      )}

      {/* Prose carrying links — ask, don't guess. A newsletter with ten links
          is genuinely ambiguous: extract the ten pages, or summarise the
          newsletter? Before this, the classifier required nearly every token to
          be a URL to say "multi", so this input silently became one pasted
          document and the links it had already found were thrown away. */}
      {isEmbedded && !embeddedChoice && (
        <div className="hero-embedded-choice" role="group" aria-label="How should this text be handled?">
          <span className="hero-embedded-q">
            <Icon name="link" size={13} />
            Found <b>{urlCount}</b> links in this text — what would you like?
          </span>
          <div className="hero-embedded-actions">
            <button type="button" className="hero-embedded-btn hero-embedded-primary" onClick={chooseEmbeddedUrls}>
              <Icon name="layers-2" size={13} /> Extract all {urlCount}
            </button>
            <button type="button" className="hero-embedded-btn" onClick={() => setEmbeddedChoice("text")}>
              <Icon name="file-text" size={13} /> Extract this text as one page
            </button>
          </div>
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
              title={background ? "Options — running in background" : "Add content — import a CSV of URLs"}
              aria-label="Add content and options"
              aria-expanded={plusOpen}
            >
              <Icon name="plus" size={18} />
              {background && <span className="hero-plus-dot" aria-hidden="true" />}
            </button>
            {plusOpen && (
              <div className="hero-menu">
                <button type="button" className="hero-menu-item" onClick={() => { setPlusOpen(false); fileRef.current?.click(); }}>
                  <Icon name="file-up" size={15} /> <span><b>Import CSV</b><span className="hero-menu-hint">Upload a list of URLs</span></span>
                </button>
                <button type="button" className="hero-menu-item" onClick={() => { setPlusOpen(false); setBatchMode(true); taRef.current?.focus(); }}>
                  <Icon name="list-checks" size={15} /> <span><b>Paste multiple URLs</b><span className="hero-menu-hint">Switch to a batch list</span></span>
                </button>
                {/* Applies to single AND batch runs. A menu item rather than a
                    toolbar chip so the bottom row doesn't grow a third toggle. */}
                <button
                  type="button"
                  className={"hero-menu-item" + (background ? " hero-menu-item-on" : "")}
                  role="menuitemcheckbox"
                  aria-checked={background}
                  onClick={() => setBackground((v) => !v)}
                >
                  <Icon name="clock" size={15} />
                  <span>
                    <b>Run in background</b>
                    <span className="hero-menu-hint">Stay on this page — progress shows in the corner</span>
                  </span>
                  {background && <Icon name="check" size={14} className="hero-menu-check" />}
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

          {/* ── Discover ──────────────────────────────────────────────────
              A DOOR, not a second implementation.

              Discoverability answers a different question about a page than
              Extract does — "can this be found and cited?" rather than "what is
              on it?" — but people arrive at the composer with a URL already
              pasted, and that is the moment the question occurs to them.

              So this hands the URL to /discoverability with the run armed and
              does no auditing itself. Duplicating even a thin version of the
              audit flow here would mean two entry points that must be kept
              telling the same story about quota, compliance refusals and the
              signed-in requirement — which is exactly how the guest-credit leak
              happened when four extraction paths each wired their own check.

              Hidden for raw pasted text: there is no URL to audit. */}
          {canDiscover && (
            <button
              type="button"
              className="hero-chip-btn"
              onClick={goDiscover}
              title="Discoverability — score this page for search, answer engines and generative engines"
            >
              <Icon name="scan-search" size={16} />
              Discover
            </button>
          )}

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
