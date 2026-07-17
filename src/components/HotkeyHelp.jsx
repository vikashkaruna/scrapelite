// src/components/HotkeyHelp.jsx — Q11 (keyboard shortcuts) help modal.
//
// Triggered by the "?" hotkey. Lists every shortcut the app supports.

import Icon from "./Icon.jsx";

const SHORTCUTS = [
  { combo: "?",            label: "Show this shortcuts panel",         group: "Help" },
  { combo: "Esc",          label: "Close modal / cancel",               group: "Help" },
  { combo: "/",            label: "Focus the URL composer",             group: "Compose" },
  { combo: "mod+k",        label: "Open the command palette",           group: "Compose" },
  { combo: "mod+enter",    label: "Run extraction (when in composer)",  group: "Compose" },
  { combo: "g d",          label: "Go to Dashboard",                    group: "Navigate" },
  { combo: "g b",          label: "Go to Batch",                        group: "Navigate" },
  { combo: "g s",          label: "Go to Schedules",                    group: "Navigate" },
  { combo: "g w",          label: "Go to Workspace (signed in)",        group: "Navigate" },
  { combo: "g p",          label: "Go to Pricing",                      group: "Navigate" },
  { combo: "g t",          label: "Replay the onboarding tour",         group: "Help" },
];

export default function HotkeyHelp({ open, onClose }) {
  if (!open) return null;

  // Group by group label.
  const groups = SHORTCUTS.reduce((acc, s) => {
    (acc[s.group] = acc[s.group] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="hotkey-backdrop" role="dialog" aria-modal="true" aria-labelledby="hotkey-title" onClick={onClose}>
      <div className="hotkey-modal card" onClick={(e) => e.stopPropagation()}>
        <header className="hotkey-head">
          <h2 id="hotkey-title"><Icon name="command" size={18} /> Keyboard shortcuts</h2>
          <button type="button" className="hotkey-close" onClick={onClose} aria-label="Close shortcuts">
            <Icon name="x" size={16} />
          </button>
        </header>
        <p className="hotkey-sub">
          Press <kbd>?</kbd> at any time to open this panel. <kbd>Esc</kbd> closes it.
        </p>
        <div className="hotkey-list">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="hotkey-group">
              <h3 className="hotkey-group-title">{group}</h3>
              <ul>
                {items.map((s) => (
                  <li key={s.combo}>
                    <kbd className="hotkey-combo">{s.combo}</kbd>
                    <span className="hotkey-label">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <footer className="hotkey-foot">
          <p>
            <Icon name="info" size={12} />
            Shortcuts are skipped while you're typing in an input or textarea.
          </p>
        </footer>
      </div>
    </div>
  );
}
