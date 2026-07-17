// src/components/OutcomeTiles.jsx — Q3 (outcome tiles above hero) UI.
//
// 6 pre-wired enrichment outcomes rendered as a row of clickable tiles above
// the Home hero composer. Clicking a tile sets the URL + intent + prompt
// in the Home composer, so one click = one structured answer.

import Icon from "./Icon.jsx";
import { OUTCOME_TILES } from "../lib/outcomeTiles.js";

export default function OutcomeTiles({ onSelect, disabled = false }) {
  return (
    <div className="outcome-tiles rise" role="list" aria-label="Common jobs to be done">
      <span className="outcome-tiles-label">
        <Icon name="zap" size={12} />
        What do you want to extract?
      </span>
      <div className="outcome-tiles-row">
        {OUTCOME_TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className="outcome-tile"
            onClick={() => onSelect?.(tile)}
            disabled={disabled}
            role="listitem"
            style={{ "--tile-accent": tile.color }}
            title={tile.desc}
          >
            <span className="outcome-tile-icon" aria-hidden="true">
              <Icon name={tile.icon} size={16} />
            </span>
            <span className="outcome-tile-title">{tile.title}</span>
            <span className="outcome-tile-desc">{tile.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
