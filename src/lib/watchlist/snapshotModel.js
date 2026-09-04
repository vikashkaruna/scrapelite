// src/lib/watchlist/snapshotModel.js
//
// PURE. Turns a fetched page into a structured snapshot of the business fields
// PRD 4 monitors, and diffs two snapshots into field-level changes.
//
// Shared client↔server, like every other model in this codebase, so the change
// a user sees in the feed is computed by the same code that stored it.
//
// ── WHY THIS IS DETERMINISTIC AND NOT AN AI CALL ────────────────────────────
//
// PRD 4's differentiator is "do not alert on every DOM change — alert only when
// a normalized business field changes." That normalisation has to be reproducible
// across runs: if the extractor is non-deterministic, run N+1 disagrees with run
// N for reasons that have nothing to do with the customer's page, and every
// diff is noise. A model that returns "Starter / Pro / Business" one week and
// "Starter, Pro, Business" the next manufactures a change that never happened.
//
// So this reads what is literally ON the page — price tokens, plan names,
// headings, feature phrases — and nothing else. Where a field cannot be
// observed it is OMITTED, never guessed. That matters more here than anywhere:
// this repository has already had to fix production serving locally-generated
// fixture prose badged as real analysis, and a fabricated "competitor changed
// their pricing" alert is worse than that, because someone will act on it.
//
// Interpretation — what a change MEANS — is a separate concern and lives in
// materialityModel.js's `aiInterpretation`. Fact and interpretation stay in
// separate fields all the way to the UI, which renders them in separate tabs.
//
// ── `unknown` IS NEVER `0`, AND ABSENCE IS NEVER A CHANGE ───────────────────
//
// The rule the discoverability scorer already enforces applies here in its own
// form: a field missing from a snapshot means "we could not read it", not "it
// was removed". `diffSnapshots` therefore only reports a field whose value is
// present in BOTH snapshots, or genuinely newly present. A page that failed to
// render must not generate "they deleted all their pricing" alerts.

/** Categories a monitored page can be classified into. Mirrors 0042's CHECK. */
export const SNAPSHOT_TYPES = Object.freeze(["pricing", "product", "positioning"]);

/** Page-path hints used to classify a discovered URL. Order matters: first hit wins. */
export const PAGE_HINTS = Object.freeze([
  { category: "pricing", type: "pricing", patterns: ["/pricing", "/plans", "/price"] },
  { category: "product", type: "product", patterns: ["/product", "/features", "/platform", "/solutions"] },
  { category: "positioning", type: "positioning", patterns: ["/customers", "/case-stud", "/about", "/why-"] },
]);

const MAX_ITEMS = 25;
const MAX_VALUE_CHARS = 240;

/** Collapse whitespace and trim. The single normalisation everything else relies on. */
export function normalise(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_VALUE_CHARS);
}

/**
 * Classify a URL into a monitored category, or null if it looks uninteresting.
 * Used by page discovery to recommend which of a domain's pages to watch.
 */
export function classifyUrl(url) {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  // The homepage is always worth watching: it is where positioning lives.
  if (path === "" || path === "/") return { category: "positioning", type: "positioning" };
  for (const hint of PAGE_HINTS) {
    if (hint.patterns.some((p) => path.includes(p))) {
      return { category: hint.category, type: hint.type };
    }
  }
  return null;
}

/**
 * Currency-prefixed or suffixed amounts. Deliberately conservative: it wants
 * things a human would read as a price, not every number on the page. A bare
 * "2024" or "500 customers" must not register as a pricing change.
 */
const PRICE_RE = /(?:[$£€₹]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR)\b)/gi;

/** Plan-name shapes seen on virtually every SaaS pricing page. */
const PLAN_WORDS = [
  "free", "starter", "basic", "essential", "standard", "plus", "pro", "professional",
  "team", "business", "growth", "premium", "advanced", "scale", "enterprise", "custom",
];

/**
 * Extract the observable business fields from one page.
 *
 * @param {object}  page
 * @param {string}  page.text       Structure-preserving text (headings, list items, table rows).
 * @param {string}  page.title      Document title.
 * @param {string[]} [page.headings] Headings in document order, if the caller has them.
 * @param {string}  type            One of SNAPSHOT_TYPES.
 * @returns {{fields: Record<string,string>, observed: number}}
 */
export function extractSnapshot({ text = "", title = "", headings = [] } = {}, type = "positioning") {
  const fields = {};
  const body = String(text || "");
  const heads = Array.isArray(headings) ? headings.map(normalise).filter(Boolean) : [];

  const t = normalise(title);
  if (t) fields["page.title"] = t;
  if (heads.length) fields["page.headline"] = heads[0];

  if (type === "pricing") {
    // Price points, de-duplicated and ordered as they appear. Order is part of
    // the fact: a plan ladder reordering is a real repackaging signal.
    const prices = [...new Set((body.match(PRICE_RE) || []).map(normalise))].slice(0, MAX_ITEMS);
    if (prices.length) fields["pricing.amounts"] = prices.join(" | ");

    // Plan names taken from headings only. Scanning body prose for the word
    // "pro" matches "provide", "process" and "product" and produces a plan
    // ladder that is not on the page.
    const plans = heads
      .filter((h) => {
        const low = h.toLowerCase();
        return h.length <= 40 && PLAN_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(low));
      })
      .slice(0, MAX_ITEMS);
    if (plans.length) fields["pricing.tiers"] = plans.join(" | ");

    const cadence = [];
    if (/\bper month\b|\/mo\b|\bmonthly\b/i.test(body)) cadence.push("monthly");
    if (/\bper year\b|\/yr\b|\bannual(?:ly)?\b/i.test(body)) cadence.push("annual");
    if (cadence.length) fields["pricing.billing_period"] = cadence.join(" | ");
  }

  if (type === "product") {
    // Feature headings, which is what a changelog-style addition shows up as.
    const feats = heads.filter((h) => h.length >= 3 && h.length <= 80).slice(1, MAX_ITEMS + 1);
    if (feats.length) fields["product.features"] = feats.join(" | ");
    const integrations = [...new Set(
      (body.match(/\b(?:integrat\w+ with|connects? to)\s+([A-Z][\w.+-]{2,24})/g) || []).map(normalise)
    )].slice(0, MAX_ITEMS);
    if (integrations.length) fields["product.integrations"] = integrations.join(" | ");
  }

  if (type === "positioning") {
    // The hero line: the single sentence a company chooses to lead with, and
    // the cheapest reliable signal of a repositioning.
    const firstPara = body.split("\n").map(normalise).find((l) => l.length > 40 && l.length < 300);
    if (firstPara) fields["positioning.hero"] = firstPara;
    const proof = heads.filter((h) => /customer|case study|trusted|testimonial/i.test(h)).slice(0, MAX_ITEMS);
    if (proof.length) fields["positioning.customer_proof"] = proof.join(" | ");
  }

  return { fields, observed: Object.keys(fields).length };
}

/**
 * A stable content hash over the EXTRACTED FIELDS, not the raw HTML.
 *
 * Hashing raw HTML is what "alert on every DOM change" looks like in practice:
 * a rotated CSRF token, a build id or a timestamp in a comment changes the hash
 * on every fetch and every run reports a change. Hashing the normalised fields
 * means the hash moves only when a monitored business field moves.
 */
export function snapshotHash(fields = {}) {
  const safe = fields && typeof fields === "object" ? fields : {};
  const canonical = Object.keys(safe).sort().map((k) => `${k}=${safe[k]}`).join("");
  // FNV-1a, 32-bit — no crypto import, deterministic across client and server.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s${h.toString(16).padStart(8, "0")}`;
}

/**
 * Diff two snapshots into field-level changes.
 *
 * @param {Record<string,string>} previous
 * @param {Record<string,string>} current
 * @param {string} category  Passed straight through onto each change.
 * @returns {Array<{field:string, category:string, oldValue:string, newValue:string}>}
 */
export function diffSnapshots(previous = {}, current = {}, category = "other") {
  const changes = [];

  // A JS default parameter only fires for `undefined`, not `null` — and a
  // caller reading a snapshot straight out of Postgres gets `null` for a column
  // that was never written. Without this, the first monitored page whose
  // previous snapshot is absent throws inside the crawler loop.
  const prev = previous && typeof previous === "object" ? previous : {};
  const cur = current && typeof current === "object" ? current : {};

  for (const [field, newValue] of Object.entries(cur)) {
    const oldValue = prev[field];
    // Newly observed field: report it as an addition (oldValue empty), which
    // buildChangeRecord already words as "New 'x' published on…".
    if (oldValue === undefined) {
      changes.push({ field, category, oldValue: "", newValue });
      continue;
    }
    if (normalise(oldValue) !== normalise(newValue)) {
      changes.push({ field, category, oldValue, newValue });
    }
  }

  // A field present before and absent now is NOT reported. See the header: an
  // absent field means "not observed this run", and the overwhelmingly common
  // cause is a failed render or a provider returning partial content — not the
  // competitor deleting their pricing page. Reporting it would make every
  // transient fetch problem look like a dramatic competitive move.

  return changes;
}

export const _internal = { PRICE_RE, PLAN_WORDS, MAX_ITEMS };
