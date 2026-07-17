// src/hooks/useHotkeys.js — Q11 (keyboard shortcuts / power-user mode).
//
// Lightweight keyboard shortcut layer. The hook accepts an object of
// `{ "combo": handler }` and binds them on `window` for the lifetime of
// the component. Skips events that originate in editable fields (input,
// textarea, contentEditable) so typing in the composer doesn't trigger
// shortcuts.
//
// Combos are lowercase + space-normalized. Examples:
//   "?"             — Shift + /
//   "/"             — focus next field
//   "esc"           — Escape
//   "g d"           — 'g' then 'd' within 800ms
//   "mod+k"         — Cmd+K (mac) or Ctrl+K (other)
//   "mod+enter"     — Cmd/Ctrl + Enter
//
// Chords ("g d") are tracked via a small `pending` buffer that resets on
// timeout or any other key.

import { useEffect, useRef } from "react";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(target) {
  if (!target) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

function normalize(combo) {
  return String(combo)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace("command", "mod")
    .replace("cmd", "mod")
    .replace("control", "mod")
    .replace("option", "alt");
}

function eventKey(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");

  // Use e.key for character keys; keyCode for special keys in older paths.
  const k = e.key;
  if (k === " ") parts.push("space");
  else if (k === "Escape") parts.push("esc");
  else if (k === "ArrowUp") parts.push("up");
  else if (k === "ArrowDown") parts.push("down");
  else if (k === "ArrowLeft") parts.push("left");
  else if (k === "ArrowRight") parts.push("right");
  else if (k === "Enter") parts.push("enter");
  else if (k === "/") parts.push("/");
  else if (k === "?") parts.push("?");
  else if (k === "Tab") parts.push("tab");
  else if (k.length === 1) parts.push(k.toLowerCase());
  else parts.push(k.toLowerCase());

  // Modifier+key combos use "+" as the separator (e.g. "mod+k"); chords
  // (e.g. "g d") use a single space. The pending-chord buffer in useHotkeys
  // appends the next key with a single space, so we only join modifiers+key
  // with "+" here.
  return parts.length > 1 && (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
    ? parts.join("+")
    : parts.join(" ");
}

const CHORD_TIMEOUT_MS = 800;

/**
 * Bind keyboard shortcuts. Skips events from editable fields unless the
 * combo explicitly opts in (e.g. "mod+enter" inside a textarea).
 *
 * @param {Record<string, (e: KeyboardEvent) => void>} map
 * @param {object} [opts] - { enabled?: boolean = true, allowInInputs?: string[] = [] }
 */
export function useHotkeys(map, opts = {}) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const pendingRef = useRef({ combo: null, ts: 0 });

  useEffect(() => {
    function handler(e) {
      const o = optsRef.current || {};
      if (o.enabled === false) return;

      const key = eventKey(e);
      const allowInInputs = new Set(o.allowInInputs || []);

      // Skip typing in editable fields unless the combo explicitly opts in.
      if (isEditableTarget(e.target) && !allowInInputs.has(key)) return;

      const now = Date.now();
      const pending = pendingRef.current;

      // Build the candidate combo: chord (if pending is still valid) + this key.
      const candidate = pending.combo && now - pending.ts < CHORD_TIMEOUT_MS
        ? `${pending.combo} ${key}`
        : key;

      const handlers = mapRef.current || {};
      const match = handlers[candidate] || handlers[normalize(candidate)];

      // 1) Exact match on the chord (with or without a pending prefix).
      if (match) {
        e.preventDefault();
        match(e);
        pendingRef.current = { combo: null, ts: 0 };
        return;
      }

      // 2) Maybe this key is the PREFIX of a longer chord (e.g. user pressed
      //    "g" and "g d" is a registered combo). Hold the prefix and wait for
      //    the next key.
      const isChordPrefix = Object.keys(handlers).some(
        (c) => c.startsWith(candidate + " ") && !c.endsWith(" "),
      );
      if (isChordPrefix) {
        pendingRef.current = { combo: candidate, ts: now };
        return;
      }

      // 3) Not a match and not a chord prefix. If there was a pending chord,
      //    clear it (the user typed a non-matching key while the chord was
      //    pending).
      if (pending.combo) {
        pendingRef.current = { combo: null, ts: 0 };
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}

/**
 * Pure helper: build the "key" string the hook uses. Exported for testing.
 */
export function buildKey(e) {
  return eventKey(e);
}

/**
 * Pure helper: check whether a target is editable. Exported for testing.
 */
export function isEditable(el) {
  return isEditableTarget(el);
}
