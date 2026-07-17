// src/components/OutcomeTiles.jsx — Q3 (outcome tiles above the hero) UI.
//
// 6 pre-wired enrichment outcomes rendered as a row of clickable tiles above
// the Home hero composer. Multi-select: clicking a tile toggles it in/out
// of the active set so the user can stack multiple "jobs to be done" (e.g.
// "Build a lead list" + "Scrape pricing") into one combined prompt.

import Icon from "./Icon.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

export default function OutcomeTiles({ activeKeys = [], onToggle, disabled = false }) {
  const active = new Set(activeKeys);

  return (
    <div className="outcome-tiles rise" role="list" aria-label="Common jobs to be done">
      <div className="outcome-tiles-head">
        <span className="outcome-tiles-label">
          <Icon name="zap" size={12} />
          What do you want to extract?
        </span>
        {active.size > 0 && (
          <button
            type="button"
            className="outcome-tiles-clear"
            onClick={() => onToggle?.("__clear__")}
            title="Clear all selected outcomes"
          >
            <Icon name="x" size={11} />
            Clear ({active.size})
          </button>
        )}
      </div>
      <div className="outcome-tiles-row">
        {OUTCOME_TILES.map((tile) => {
          const isActive = active.has(tile.key);
          return (
            <button
              key={tile.key}
              type="button"
              className={"outcome-tile" + (isActive ? " outcome-tile-active" : "")}
              onClick={() => onToggle?.(tile)}
              disabled={disabled}
              role="listitem"
              aria-pressed={isActive}
              style={{ "--tile-accent": tile.color }}
              title={isActive ? `Click to remove: ${tile.title}` : `Click to add: ${tile.title}`}
            >
              <span className="outcome-tile-icon" aria-hidden="true">
                <Icon name={isActive ? "check" : tile.icon} size={16} />
              </span>
              <span className="outcome-tile-title">{tile.title}</span>
              <span className="outcome-tile-desc">{tile.desc}</span>
              {isActive && (
                <span className="outcome-tile-check" aria-hidden="true">
                  <Icon name="check-circle" size={11} />
                  Selected
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
