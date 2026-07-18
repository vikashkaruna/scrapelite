// src/components/OutcomeTiles.jsx — Q3 outcome tiles above the hero composer.
//
// Single-select quick-start tiles. Click a tile to seed the composer with
// that job-to-be-done (URL + intent). Click the active tile again to
// deselect it. The label "Common jobs" deliberately differs from the
// intent-chips label ("What do you want to extract?") so the two
// affordances don't read as duplicates — the tiles are a fast-path
// picker; the chips are the precise intent selector.

import Icon from "./Icon.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

export default function OutcomeTiles({ activeKey = null, onToggle, disabled = false }) {
  return (
    <div className="outcome-tiles rise" role="list" aria-label="Common jobs to be done">
      <div className="outcome-tiles-head">
        <span className="outcome-tiles-label">
          <Icon name="zap" size={12} />
          Common jobs
        </span>
      </div>
      <div className="outcome-tiles-row">
        {OUTCOME_TILES.map((tile) => {
          const isActive = activeKey === tile.key;
          return (
            <button
              key={tile.key}
              type="button"
              className={"outcome-tile" + (isActive ? " outcome-tile-active" : "")}
              onClick={() => onToggle?.(isActive ? null : tile)}
              disabled={disabled}
              role="listitem"
              aria-pressed={isActive}
              style={{ "--tile-accent": tile.color }}
              title={isActive ? `Click to clear: ${tile.title}` : `Click to use: ${tile.title}`}
            >
              <span className="outcome-tile-icon" aria-hidden="true">
                <Icon name={isActive ? "check" : tile.icon} size={16} />
              </span>
              <span className="outcome-tile-title">{tile.title}</span>
              <span className="outcome-tile-desc">{tile.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
