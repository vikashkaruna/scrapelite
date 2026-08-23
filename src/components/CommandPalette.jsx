// CommandPalette.jsx — F10 (mod+K command palette) UI.
//
// A small Cmd-K modal that lists "jump anywhere" actions. Triggered by the
// `mod+k` hotkey (already wired into useHotkeys from Q11). Each action
// knows how to run itself (typically a `navigate(path)`).
//
// UX:
//  - Type in the search box to fuzzy-filter actions
//  - ↑/↓ to move the highlight, Enter to run, Esc to close
//  - "Run extraction" auto-focuses the URL composer instead of navigating
//  - When the user is signed in, "Workspace" appears; otherwise hidden
//
// Pure-logic helpers (filter + score) are exported for unit testing.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { resetTour } from "../lib/onboardingTour.js";

export function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx === -1) {
    // subsequence match: every char in q appears in t in order
    let ti = 0;
    for (const ch of q) {
      ti = t.indexOf(ch, ti);
      if (ti === -1) return 0;
      ti += 1;
    }
    return 0.4;
  }
  if (idx === 0) return 1;
  return Math.max(0.1, 1 - idx / Math.max(1, t.length));
}

export function filterActions(actions, query) {
  if (!query) return actions;
  const scored = actions
    .map((a) => ({ a, s: Math.max(fuzzyScore(query, a.label), fuzzyScore(query, a.hint || "")) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  return scored.map((x) => x.a);
}

export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Build the action list. The order is curated: navigation first, then
  // "run X", then help.
  const actions = useMemo(() => {
    const out = [
      { id: "extract", icon: "zap",         label: "Run extraction",     hint: "Focus the URL composer", shortcut: "/", action: () => {
        const sel = [".hero-composer-input", ".hero-composer textarea", "textarea[aria-label*='URL']"];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el) { el.focus(); return; }
        }
        navigate("/");
      } },
      { id: "dashboard", icon: "table",    label: "Go to Dashboard",    hint: "Saved extractions",      shortcut: "g d", action: () => navigate("/dashboard") },
      { id: "batch",     icon: "layers-2", label: "Go to Batch",        hint: "Multi-URL extraction",   shortcut: "g b", action: () => navigate("/batch") },
      { id: "schedules", icon: "calendar", label: "Go to Schedules",    hint: "Recurring extractions",  shortcut: "g s", action: () => navigate("/schedules") },
      { id: "pricing",   icon: "tag",      label: "Go to Pricing",      hint: "Compare plans",          shortcut: "g p", action: () => navigate("/pricing") },
      { id: "help",      icon: "command",  label: "Show keyboard shortcuts", hint: "?",                 shortcut: "?",  action: () => {} },
      { id: "tour",      icon: "map",      label: "Replay the onboarding tour", hint: "Re-show the 7-step walkthrough", shortcut: "g t", action: () => {
        resetTour();
        // Dispatch a custom event that App.jsx listens to, OR force-open via
        // a global sentinel in localStorage that App.jsx reads on mount.
        // Simplest: set a flag the Shell already reads via a synthetic
        // keyboard event. (See App.jsx: tourForceOpen is incremented on `g t`.)
        window.dispatchEvent(new CustomEvent("datiq:replay-tour"));
      } },
    ];
    if (user) {
      out.splice(5, 0, { id: "workspace", icon: "briefcase", label: "Go to Workspace", hint: "Command center", shortcut: "g w", action: () => navigate("/workspace") });
      out.splice(6, 0, { id: "account",    icon: "user",      label: "Go to Account",    hint: "Billing & usage",        action: () => navigate("/account") });
    }
    return out;
  }, [navigate, user]);

  const filtered = useMemo(() => filterActions(actions, query), [actions, query]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      // Defer focus to next tick so the input is in the DOM
      const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Keep highlight in range when filter changes
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered, highlight]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const a = filtered[highlight];
        if (a) { a.action(); onClose(); }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, filtered, highlight, onClose]);

  if (!open) return null;

  return (
    <div className="cmdpalette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="cmdpalette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmdpalette-head">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="text"
            className="cmdpalette-input"
            placeholder="Type a command, jump to a page, or run an action…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            aria-label="Command palette search"
            data-testid="cmdpalette-input"
          />
          <kbd className="cmdpalette-kbd">esc</kbd>
        </div>
        <ul className="cmdpalette-list" ref={listRef} role="listbox">
          {filtered.length === 0 && (
            <li className="cmdpalette-empty">No matches.</li>
          )}
          {filtered.map((a, i) => (
            <li
              key={a.id}
              className={"cmdpalette-item" + (i === highlight ? " cmdpalette-item--active" : "")}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => { a.action(); onClose(); }}
              data-testid={`cmdpalette-item-${a.id}`}
            >
              <span className="cmdpalette-item-icon">
                <Icon name={a.icon} size={15} />
              </span>
              <span className="cmdpalette-item-text">
                <span className="cmdpalette-item-label">{a.label}</span>
                {a.hint && <span className="cmdpalette-item-hint">{a.hint}</span>}
              </span>
              {a.shortcut && <kbd className="cmdpalette-item-kbd">{a.shortcut}</kbd>}
            </li>
          ))}
        </ul>
        <footer className="cmdpalette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
