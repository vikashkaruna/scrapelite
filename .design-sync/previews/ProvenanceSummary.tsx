import { ProvenanceSummary } from "datiq";

// ProvenanceSummary reads extraction._provenance (see attachProvenance() in
// src/lib/provenanceService.js): { source_url, field_count, avg_confidence,
// last_checked_at }. timeAgoShort reads Date.now() internally, so offsets
// are computed the same way at render time.
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

export function FullSummary() {
  return (
    <ProvenanceSummary
      extraction={{
        url: "https://linear.app/pricing",
        _provenance: {
          run_id: "run_1a2b3c",
          source_url: "https://linear.app/pricing",
          field_count: 24,
          avg_confidence: 0.91,
          last_checked_at: minutesAgo(5),
        },
      }}
    />
  );
}

export function CompactSummary() {
  return (
    <ProvenanceSummary
      compact
      extraction={{
        url: "https://mixpanel.com/blog/pricing-strategy",
        _provenance: {
          run_id: "run_9f8e7d",
          source_url: "https://mixpanel.com/blog/pricing-strategy",
          field_count: 9,
          avg_confidence: 0.68,
          last_checked_at: hoursAgo(6),
        },
      }}
    />
  );
}
