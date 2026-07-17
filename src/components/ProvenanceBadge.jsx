// src/components/ProvenanceBadge.jsx — Q9 (per-field provenance) UI.
//
// Renders a small chip showing a field's provenance: source URL, confidence
// bar, and last-checked timestamp. Designed to sit below a field value
// in the Preview page or Dashboard.

import Icon from "./Icon.jsx";
import { timeAgoShort, hostOfUrl } from "../lib/provenanceService.js";

function confidenceLabel(c) {
  if (c == null) return "—";
  const pct = Math.round(c * 100);
  if (pct >= 90) return "high";
  if (pct >= 70) return "medium";
  return "low";
}

function confidenceClass(c) {
  if (c == null) return "unknown";
  if (c >= 0.9) return "high";
  if (c >= 0.7) return "medium";
  return "low";
}

export default function ProvenanceBadge({ prov, compact = false }) {
  if (!prov) return null;
  const source = prov.source_url ? hostOfUrl(prov.source_url) : null;
  const checked = prov.last_checked_at ? timeAgoShort(prov.last_checked_at) : "—";
  const cls = `prov-badge conf-${confidenceClass(prov.confidence)}${compact ? " compact" : ""}`;

  return (
    <span className={cls} title={`Source: ${source || "unknown"} · Confidence: ${Math.round((prov.confidence || 0) * 100)}% · Checked ${checked}`}>
      <span className="prov-conf" aria-label={`Confidence ${confidenceLabel(prov.confidence)}`}>
        <Icon name="shield" size={10} />
        {Math.round((prov.confidence || 0) * 100)}%
      </span>
      {!compact && source && (
        <span className="prov-src" aria-label={`Source: ${source}`}>
          <Icon name="globe" size={10} />
          {source}
        </span>
      )}
      {!compact && (
        <span className="prov-checked" aria-label={`Last checked ${checked}`}>
          <Icon name="clock" size={10} />
          {checked}
        </span>
      )}
    </span>
  );
}

export function ProvenanceSummary({ extraction, compact = false }) {
  const p = extraction?._provenance;
  if (!p) return null;
  const source = p.source_url ? hostOfUrl(p.source_url) : null;
  const cls = `prov-summary${compact ? " compact" : ""}`;
  return (
    <div className={cls}>
      <span className="prov-summary-line">
        <Icon name="shield" size={12} />
        <strong>Provenance</strong>
        {source && <span className="prov-summary-src">from {source}</span>}
        <span className="prov-summary-stat">{p.field_count} fields</span>
        <span className="prov-summary-stat">{Math.round((p.avg_confidence || 0) * 100)}% avg confidence</span>
        <span className="prov-summary-stat">checked {timeAgoShort(p.last_checked_at)}</span>
      </span>
    </div>
  );
}
