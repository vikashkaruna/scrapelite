import { ProvenanceBadge } from "datiq";

// prov shape (see src/lib/provenanceService.js#makeProvenanceField):
//   { field, source_url, confidence: 0..1, last_checked_at: iso, retrieval }
// confidenceClass buckets: >=0.9 "high", >=0.7 "medium", else "low".
// timeAgoShort reads Date.now() internally, so offsets are computed the
// same way at render time (never a fixed calendar date).
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

export function HighConfidenceScraped() {
  return (
    <ProvenanceBadge
      prov={{
        field: "title",
        source_url: "https://stripe.com/pricing",
        confidence: 0.95,
        last_checked_at: minutesAgo(12),
        retrieval: "scraped",
      }}
    />
  );
}

export function MediumConfidenceAiInferred() {
  return (
    <ProvenanceBadge
      prov={{
        field: "custom",
        source_url: "https://acme-widgets.com/about",
        confidence: 0.75,
        last_checked_at: hoursAgo(3),
        retrieval: "ai_inferred",
      }}
    />
  );
}

export function LowConfidenceCompact() {
  return (
    <ProvenanceBadge
      compact
      prov={{
        field: "enrichment",
        source_url: "https://shopify.com/products/desk-lamp",
        confidence: 0.42,
        last_checked_at: daysAgo(2),
        retrieval: "ai_inferred",
      }}
    />
  );
}

export function JustCheckedHighConfidence() {
  return (
    <ProvenanceBadge
      prov={{
        field: "link",
        source_url: "https://vercel.com/blog",
        confidence: 0.95,
        last_checked_at: minutesAgo(0),
        retrieval: "scraped",
      }}
    />
  );
}
