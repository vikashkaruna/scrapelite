// src/lib/platformKeys.js — Mac vs. non-Mac symbols for the "mod"/"alt" combo
// syntax used by useHotkeys.js and HotkeyHelp.jsx (e.g. "mod+k", "g d").
//
// The shortcut hook itself deliberately normalizes cmd/ctrl into one generic
// "mod" string (see useHotkeys.js normalize()) — that's the right call for
// binding, since a single key handler should fire on either platform's
// modifier. But showing that same literal string to a person is a different
// problem: nobody's keyboard has a key labelled "mod". This module is only
// about *display* — it never changes what fires the shortcut.

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

const MAC_SYMBOLS = { mod: "⌘", alt: "⌥", shift: "⇧", ctrl: "⌃" };
const OTHER_LABELS = { mod: "Ctrl", alt: "Alt", shift: "Shift", ctrl: "Ctrl" };

/**
 * Format one combo token ("mod+k", "g d", "esc") into the label a person on
 * the current platform should see. Chord sequences ("g d") and bare keys
 * ("esc", "?") pass through unchanged — only mod/alt/shift/ctrl inside a
 * "+"-joined combo get platform symbols.
 */
export function formatShortcut(combo) {
  const raw = String(combo).trim();
  if (!raw.includes("+")) return raw;

  const map = isMac ? MAC_SYMBOLS : OTHER_LABELS;
  const parts = raw.split("+").map((part) => {
    const key = part.toLowerCase();
    if (map[key]) return map[key];
    return isMac ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
  });
  // Mac reads as one tight glyph cluster ("⌘K"); everyone else reads a
  // hyphenated combo more easily ("Ctrl+K") — matches how each platform's
  // own menus display shortcuts.
  return isMac ? parts.join("") : parts.join("+");
}
