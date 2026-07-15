// test/fixtures/buildExtraction.js
// Factory for an "extraction" record. Mirrors the shape produced by
// src/components/ExtractionProvider.jsx → saveExtraction() and consumed by
// src/pages/Dashboard.jsx, src/pages/Preview.jsx, and the batch page.

/**
 * @typedef {Object} Extraction
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} createdAt
 * @property {"single"|"batch"|"schedule"} [kind]
 * @property {string} [summary]
 * @property {string} [html]
 * @property {Array<{label:string,href:string}>} [links]
 * @property {Array<{tag:string,text:string}>} [headings]
 * @property {Object} [enrichments]
 * @property {Object} [meta]
 */

/**
 * Build an extraction record for tests. The default URL and title point at
 * a stable hostname so log snapshots are deterministic.
 *
 * @param {Partial<Extraction>} [overrides]
 * @returns {Extraction}
 */
export function buildExtraction(overrides = {}) {
  const id = overrides.id ?? `ext_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = overrides.createdAt ?? new Date().toISOString();
  return {
    id,
    url: "https://example.com/pricing",
    title: "Example Pricing",
    createdAt,
    kind: "single",
    summary: "Pricing tiers for the Example product.",
    links: [
      { label: "Sign up", href: "https://example.com/signup" },
      { label: "Contact", href: "https://example.com/contact" },
    ],
    headings: [
      { tag: "h1", text: "Pricing" },
      { tag: "h2", text: "Plans" },
    ],
    enrichments: {},
    meta: {},
    ...overrides,
  };
}

/**
 * Build a batch of N extraction records, one per URL, with deterministic
 * ids and timestamps. Useful for batch / dashboard tests that need a known
 * dataset size.
 *
 * @param {string[]} urls
 * @param {Partial<Extraction>} [shared]
 * @returns {Extraction[]}
 */
export function buildExtractionBatch(urls, shared = {}) {
  const base = new Date("2026-07-15T10:00:00.000Z").getTime();
  return urls.map((url, i) =>
    buildExtraction({
      id: `ext_batch_${i + 1}`,
      url,
      title: `Page ${i + 1}`,
      createdAt: new Date(base + i * 1000).toISOString(),
      ...shared,
    }),
  );
}
