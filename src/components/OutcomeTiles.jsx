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

// `tiles` defaults to the seven FILL tiles so existing callers keep working;
// Home passes the full 12 from homeTiles(). An OPEN tile (tile.open) goes to
// another module and says so on the tile, so a click never surprises anyone.

export default function OutcomeTiles({ tiles = OUTCOME_TILES, activeKey = null, onToggle, onOpen, disabled = false, recommendedKeys = new Set(), recommendColor, personaLabel }) {
  return (
    <section className="outcome-tiles rise" aria-label="Common jobs to be done">
      <div className="outcome-tiles-head">
        <span className="outcome-tiles-label">
          <Icon name="zap" size={12} />
          Common jobs
        </span>
      </div>
      <div className="outcome-tiles-row" role="list" aria-label="Common jobs to be done">
        {tiles.map((tile) => {
          const opens = Boolean(tile.open);
          const isActive = !opens && activeKey === tile.key;
          const recommended = recommendedKeys.has(tile.key);
          return (
            <div key={tile.key} className="outcome-tile-item" role="listitem">
              <button
                type="button"
                className={"outcome-tile" + (opens ? " outcome-tile-open" : "") + (isActive ? " outcome-tile-active" : "") + (recommended ? " outcome-tile-recommended" : "")}
                onClick={() => (opens ? onOpen?.(tile) : onToggle?.(isActive ? null : tile))}
                disabled={disabled}
                aria-pressed={opens ? undefined : isActive}
                style={{ "--tile-accent": recommended && recommendColor ? recommendColor : tile.color }}
                title={opens ? `Opens ${tile.open.module}: ${tile.title}` : isActive ? `Click to clear: ${tile.title}` : `Click to use: ${tile.title}${recommended && personaLabel ? ` — recommended for ${personaLabel}` : ""}`}
              >
                <span className="outcome-tile-icon" aria-hidden="true">
                  <Icon name={isActive ? "check" : tile.icon} size={16} />
                </span>
                <span className="outcome-tile-title">{tile.title}</span>
                {recommended && <span className="outcome-tile-rec">Recommended</span>}
                <span className="outcome-tile-desc">{tile.desc}</span>
                {opens && (
                  <span className="outcome-tile-opens">
                    Opens {tile.open.module}{tile.open.beta ? " (beta)" : ""} <Icon name="arrow-right" size={11} />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
