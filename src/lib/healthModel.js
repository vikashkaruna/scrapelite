// healthModel.js — PURE. The shared contract for service/host health.
//
// Same rule as monitoringModel.js: imported by BOTH the React admin page and
// the Netlify functions, so a probe result is classified once and identically
// on each side. No network, no env, no DOM.
//
// THE DISTINCTION THIS FILE EXISTS TO ENFORCE:
//
//   down    — we asked, and it did not answer.
//   unknown — we never asked, or could not ask.
//
// Collapsing those two is the classic monitoring lie. A dashboard that paints
// "Razorpay: DOWN" because nobody configured the key sends an operator chasing
// a vendor outage that isn't happening; one that paints it green because the
// probe was skipped is worse still. `configured: false` therefore produces
// `unknown`, and `unknown` NEVER contributes to the overall verdict.

// ── Component registry ───────────────────────────────────────────────────────
//
// `critical: true` means a failure here takes the product down for users, and
// so drives the headline status. Everything else degrades rather than fails:
// Resend being unreachable stops alert mail, which matters, but the app works.
export const HEALTH_COMPONENTS = [
  // Hosting / edge
  {
    id: "netlify-site",
    label: "Netlify site",
    group: "platform",
    critical: true,
    description: "The deployed site: which context, branch and deploy is answering. Read from the function's own runtime env (CONTEXT, BRANCH, DEPLOY_ID, SITE_NAME) — no token required.",
    // Previously required NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID, but the same
    // information is available from the build env every function gets. Keeping
    // `requires` empty here is deliberate: the probe is "always configured"
    // when the function is running at all, which it must be to answer.
    requires: [],
  },
  {
    id: "netlify-platform",
    label: "Netlify platform",
    group: "platform",
    critical: false,
    description: "Netlify's public status page — provider-side incidents affecting all sites.",
  },
  {
    id: "functions-runtime",
    label: "Functions runtime",
    group: "platform",
    critical: true,
    description: "The serverless runtime answering this request: context, region and deploy id.",
  },
  // Data
  {
    id: "supabase-db",
    label: "Supabase database",
    group: "database",
    critical: true,
    description: "PostgREST round-trip against a real table — the query path the app actually uses.",
    requires: ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"],
  },
  {
    id: "supabase-auth",
    label: "Supabase auth (GoTrue)",
    group: "database",
    critical: true,
    description: "The auth service health endpoint. Sign-in breaks before the database does.",
    requires: ["SUPABASE_URL"],
  },
  {
    id: "supabase-platform",
    label: "Supabase platform",
    group: "database",
    critical: false,
    description: "Supabase's public status page — provider-side incidents.",
  },
  // Services the product calls out to
  {
    id: "email-resend",
    label: "Email (Resend)",
    group: "services",
    critical: false,
    description: "Transactional mail: invoices, dunning, contact form, change alerts.",
    requires: ["RESEND_API_KEY"],
  },
  {
    id: "payments-razorpay",
    label: "Payments (Razorpay)",
    group: "services",
    critical: false,
    description: "Razorpay payment gateway API and checkout service. Checkout is INR-only in v1.0.",
  },
  {
    id: "ai-providers",
    label: "AI providers",
    group: "services",
    critical: false,
    description:
      "Enrichment chain (Gemini → Claude → OpenAI). Reported from key presence only — " +
      "probing it would spend tokens on every dashboard refresh.",
  },
  {
    id: "scrape-providers",
    label: "Scrape providers",
    group: "services",
    critical: false,
    description:
      "Extraction chain (Firecrawl → Spider → Jina → Direct). Direct fetch needs no key, " +
      "so extraction degrades rather than stops.",
  },
];

export const HEALTH_COMPONENT_IDS = HEALTH_COMPONENTS.map((c) => c.id);

const BY_ID = HEALTH_COMPONENTS.reduce((m, c) => ((m[c.id] = c), m), {});

export function componentById(id) {
  return BY_ID[id] || null;
}

export const HEALTH_GROUPS = [
  { id: "platform", label: "Hosting & edge", icon: "server" },
  { id: "database", label: "Data & identity", icon: "database" },
  { id: "services", label: "External services", icon: "network" },
];

export function componentsInGroup(groupId) {
  return HEALTH_COMPONENTS.filter((c) => c.group === groupId);
}

// ── Status vocabulary ────────────────────────────────────────────────────────

export const HEALTH_STATUS = {
  OK: "ok",
  DEGRADED: "degraded",
  DOWN: "down",
  UNKNOWN: "unknown",
};

const STATUS_RANK = {
  [HEALTH_STATUS.DOWN]: 3,
  [HEALTH_STATUS.DEGRADED]: 2,
  [HEALTH_STATUS.OK]: 1,
  [HEALTH_STATUS.UNKNOWN]: 0,
};

export function statusRank(status) {
  return STATUS_RANK[status] ?? 0;
}

const STATUS_META = {
  [HEALTH_STATUS.OK]:       { label: "Operational",   tone: "ok",     icon: "check-circle" },
  [HEALTH_STATUS.DEGRADED]: { label: "Degraded",      tone: "warn",   icon: "alert-triangle" },
  [HEALTH_STATUS.DOWN]:     { label: "Down",          tone: "danger", icon: "alert-octagon" },
  [HEALTH_STATUS.UNKNOWN]:  { label: "Not checked",   tone: "muted",  icon: "help-circle" },
};

export function healthStatusMeta(status) {
  return STATUS_META[status] || STATUS_META[HEALTH_STATUS.UNKNOWN];
}

// ── Latency grading ──────────────────────────────────────────────────────────
//
// Thresholds are per-component because the honest budget differs by an order of
// magnitude: a PostgREST query in the same region should answer in tens of
// milliseconds, while a third-party status page crossing the public internet is
// fine at half a second. One global threshold would either cry wolf on the
// status pages or never notice a slow database.
export const DEFAULT_LATENCY_BUDGET = { fast: 300, slow: 1500 };

export const LATENCY_BUDGETS = {
  "supabase-db":       { fast: 150, slow: 800 },
  "supabase-auth":     { fast: 200, slow: 1000 },
  "netlify-site":      { fast: 400, slow: 2000 },
  "netlify-platform":  { fast: 500, slow: 2500 },
  "supabase-platform": { fast: 500, slow: 2500 },
  "payments-razorpay": { fast: 500, slow: 2500 },
  "email-resend":      { fast: 400, slow: 2000 },
  "functions-runtime": { fast: 5,   slow: 50 },
};

export function latencyBudget(componentId) {
  return LATENCY_BUDGETS[componentId] || DEFAULT_LATENCY_BUDGET;
}

/** 'fast' | 'ok' | 'slow' | null (when there is no measurement). */
export function gradeLatency(latencyMs, componentId) {
  // Guard the value BEFORE Number(): Number(null) and Number("") are both 0,
  // which would grade "we never measured this" as the fastest possible response.
  if (latencyMs === null || latencyMs === undefined || latencyMs === "") return null;
  const v = Number(latencyMs);
  if (!Number.isFinite(v) || v < 0) return null;
  const { fast, slow } = latencyBudget(componentId);
  if (v <= fast) return "fast";
  if (v >= slow) return "slow";
  return "ok";
}

/**
 * Turn a raw probe result into a classified component reading.
 *
 * A reachable-but-slow component is DEGRADED, not OK: by the time it is fully
 * down there is nothing left to warn about.
 *
 * @param {object} probe {id, configured, reachable, httpStatus, latencyMs, detail, status?, note?}
 */
export function classifyProbe(probe = {}) {
  const id = probe.id;
  const meta = componentById(id);
  const latencyMs = Number.isFinite(Number(probe.latencyMs)) ? Number(probe.latencyMs) : null;
  const base = {
    id,
    label: meta?.label || id,
    group: meta?.group || "services",
    critical: !!meta?.critical,
    description: meta?.description || "",
    latencyMs,
    latencyGrade: gradeLatency(latencyMs, id),
    detail: probe.detail || {},
    note: probe.note || "",
    checkedAt: probe.checkedAt || null,
  };

  if (probe.configured === false) {
    return { ...base, status: HEALTH_STATUS.UNKNOWN,
      note: probe.note || `Not configured${meta?.requires?.length ? ` — needs ${meta.requires.join(", ")}` : ""}.` };
  }

  // A probe may classify itself (a status page reporting "partial outage" is
  // not something a latency number can express).
  if (probe.status && STATUS_RANK[probe.status] !== undefined) {
    return { ...base, status: probe.status };
  }

  if (probe.reachable === false) {
    return { ...base, status: HEALTH_STATUS.DOWN, note: probe.note || "No response." };
  }

  if (base.latencyGrade === "slow") {
    return { ...base, status: HEALTH_STATUS.DEGRADED,
      note: probe.note || `Responding slowly (${latencyMs}ms).` };
  }

  return { ...base, status: HEALTH_STATUS.OK };
}

/**
 * Headline verdict across all components.
 *
 * Only CRITICAL components can make the platform 'down'; a non-critical failure
 * caps the verdict at 'degraded'. 'unknown' is ignored entirely — see the note
 * at the top of this file.
 */
export function overallHealth(components = []) {
  const known = components.filter((c) => c.status !== HEALTH_STATUS.UNKNOWN);
  if (!known.length) return HEALTH_STATUS.UNKNOWN;

  let verdict = HEALTH_STATUS.OK;
  for (const c of known) {
    if (c.status === HEALTH_STATUS.DOWN) {
      if (c.critical) return HEALTH_STATUS.DOWN;
      verdict = HEALTH_STATUS.DEGRADED;
    } else if (c.status === HEALTH_STATUS.DEGRADED && verdict === HEALTH_STATUS.OK) {
      verdict = HEALTH_STATUS.DEGRADED;
    }
  }
  return verdict;
}

/** Counters for the summary tiles. */
export function summarizeHealth(components = []) {
  const out = { total: components.length, ok: 0, degraded: 0, down: 0, unknown: 0 };
  for (const c of components) {
    if (c.status === HEALTH_STATUS.OK) out.ok++;
    else if (c.status === HEALTH_STATUS.DEGRADED) out.degraded++;
    else if (c.status === HEALTH_STATUS.DOWN) out.down++;
    else out.unknown++;
  }
  out.overall = overallHealth(components);
  return out;
}

// ── Uptime from stored samples ───────────────────────────────────────────────

/**
 * Availability over a window of health_samples rows.
 *
 * 'unknown' samples are EXCLUDED from both numerator and denominator, not
 * counted as downtime. An hour when the probe could not run is an hour with no
 * evidence; scoring it as an outage manufactures incidents out of missing data.
 * 'degraded' counts as available — the service answered.
 *
 * Returns null when the window holds no usable samples, so the UI can say
 * "no data" rather than "0%".
 */
export function computeUptime(samples = [], { windowMs = 24 * 60 * 60 * 1000, now = new Date() } = {}) {
  const cutoff = now.getTime() - windowMs;
  let total = 0;
  let up = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let worst = 0;

  for (const s of samples) {
    const t = Date.parse(s?.observed_at ?? s?.observedAt ?? "");
    if (!Number.isFinite(t) || t < cutoff) continue;
    const status = s.status;
    if (status === HEALTH_STATUS.UNKNOWN) continue;
    total++;
    if (status === HEALTH_STATUS.OK || status === HEALTH_STATUS.DEGRADED) up++;
    const l = Number(s.latency_ms ?? s.latencyMs);
    if (Number.isFinite(l) && l >= 0) {
      latencySum += l;
      latencyCount++;
      if (l > worst) worst = l;
    }
  }

  if (!total) return null;
  return {
    samples: total,
    uptimePct: Math.round((up / total) * 1000) / 10, // one decimal
    avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
    maxLatencyMs: latencyCount ? worst : null,
  };
}

/** Group samples by component id, then compute uptime for each. */
export function uptimeByComponent(samples = [], opts = {}) {
  const buckets = {};
  for (const s of samples) {
    const id = s?.component;
    if (!id) continue;
    (buckets[id] ||= []).push(s);
  }
  const out = {};
  for (const [id, rows] of Object.entries(buckets)) {
    const u = computeUptime(rows, opts);
    if (u) out[id] = u;
  }
  return out;
}

// ── Statuspage translation ───────────────────────────────────────────────────
//
// Netlify, Supabase and Razorpay all publish Atlassian Statuspage JSON at
// /api/v2/status.json, whose `status.indicator` is one of:
//   none | minor | major | critical  (plus 'maintenance' on some tenants)
const INDICATOR_MAP = {
  none: HEALTH_STATUS.OK,
  minor: HEALTH_STATUS.DEGRADED,
  maintenance: HEALTH_STATUS.DEGRADED,
  major: HEALTH_STATUS.DOWN,
  critical: HEALTH_STATUS.DOWN,
};

/** Map a Statuspage indicator to our vocabulary. Unrecognised → unknown. */
export function statusPageIndicatorToStatus(indicator) {
  return INDICATOR_MAP[String(indicator || "").toLowerCase()] ?? HEALTH_STATUS.UNKNOWN;
}
