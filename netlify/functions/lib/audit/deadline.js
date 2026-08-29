// deadline.js — the audit's wall-clock budget.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// The pipeline had timeouts on individual calls but no notion of the platform's
// own limit, and the individual timeouts compose ADDITIVELY wherever the work
// is serial. Measured against a fully-provisioned environment where every
// third party is merely slow rather than down:
//
//   collectPage   4 scrape providers x 20s, tried in series        = 80s
//   citations     5 default prompts x 15s, awaited in a for-loop   = 75s
//   AI evaluator  runChain had no timeout at any layer             = unbounded
//
// A Netlify synchronous function is killed at 10s (26s is the ceiling on paid
// plans). So the audit could not finish, the client saw `POST /audits failed
// (504)`, and — because the audit row is opened before the run and quota counts
// every row that is not `failed` — the user was charged for it.
//
// ── THE RULE THIS APPLIES ──────────────────────────────────────────────────
//
// Rule 1.1 of the module ("`unknown` is never `0`") already says what to do
// when evidence cannot be gathered: exclude the signal, redistribute its weight,
// and let `coverage` report the thinness. Running out of TIME is just another
// reason a signal could not be measured — no different from PageSpeed being
// rate-limited. So a stage that does not fit the budget is skipped and reported
// as unmeasured, and the audit still completes with everything that did fit.
//
// That is strictly better than a 504, which returns nothing, explains nothing,
// and still bills. A thin audit that says it is thin is a usable answer.
//
// ⚠️ Slices are advisory, not enforcement. `sliceFor()` tells a stage how long
// it may take; the stage still has to honour it by passing the value to its own
// AbortController. A stage that ignores its slice can still overrun — which is
// exactly why `runChain` had to learn to accept a signal.

/**
 * Total wall clock one audit may occupy.
 *
 * ⚠️ The default is sized for Netlify's STOCK function timeout of 10s, not for
 * the 26s ceiling available on paid plans. That is deliberate, and it is the
 * conservative direction: a budget that assumes a raised timeout reintroduces
 * the exact 504 this module was failing with on any deploy where nobody raised
 * it, and the function timeout is site configuration that no code here can read
 * or verify. Guessing high fails closed; guessing low returns a thinner audit
 * that plainly reports its own coverage.
 *
 * Raising it is one env var. With the function's timeout raised to 26s in
 * Netlify (Site configuration → Functions), set `AUDIT_BUDGET_MS=20000` for
 * fuller evidence — PageSpeed and citation sampling both start fitting
 * comfortably rather than being skipped on slower pages.
 */
export const DEFAULT_AUDIT_BUDGET_MS = 8_000;

/** Held back for scoring, recommending and serialising — CPU, but not free. */
export const REPORT_RESERVE_MS = 600;

/** Below this, a network stage cannot realistically return anything useful. */
export const MIN_USEFUL_SLICE_MS = 1_200;

/** Read the budget from the environment, clamped to something sane. */
export function budgetFromEnv(env = process.env) {
  const raw = Number(env.AUDIT_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_AUDIT_BUDGET_MS;
  // Floor of 3s: below that nothing completes and every audit is empty, which
  // looks like a broken product rather than a tight budget.
  return Math.max(3_000, Math.min(120_000, Math.round(raw)));
}

/**
 * A monotonic budget.
 *
 * `now` is injectable so the tests can drive elapsed time without sleeping.
 *
 * @param {number} budgetMs
 * @param {() => number} [now]
 */
export function createDeadline(budgetMs = DEFAULT_AUDIT_BUDGET_MS, now = Date.now) {
  const totalMs = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : DEFAULT_AUDIT_BUDGET_MS;
  const startedAt = now();

  const elapsed = () => now() - startedAt;
  const remaining = () => Math.max(0, totalMs - elapsed());

  return {
    startedAt,
    totalMs,
    elapsed,
    remaining,

    /** Has the budget run out entirely? */
    expired: () => remaining() <= 0,

    /**
     * Is there enough left for a stage to be worth starting?
     *
     * Starting a 15s call with 400ms left does not produce a partial answer —
     * it produces the same unmeasured signal, one round-trip later, having
     * spent the last of the budget the stages after it needed.
     */
    allows(minMs = MIN_USEFUL_SLICE_MS, { reserveMs = REPORT_RESERVE_MS } = {}) {
      return remaining() - reserveMs >= minMs;
    },

    /**
     * How long one stage may take: never longer than it wants, never longer
     * than is left after the report reserve. Returns 0 when there is no room,
     * which callers must read as "skip".
     */
    sliceFor(preferredMs, { reserveMs = REPORT_RESERVE_MS } = {}) {
      const room = remaining() - reserveMs;
      if (room < MIN_USEFUL_SLICE_MS) return 0;
      return Math.max(0, Math.min(preferredMs, room));
    },

    /**
     * An AbortSignal that fires when this stage's slice is spent.
     * Returns null when there is no room, so the caller skips rather than
     * issuing a request that is aborted before it can be answered.
     */
    signalFor(preferredMs, opts) {
      const ms = this.sliceFor(preferredMs, opts);
      if (ms <= 0) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      // Node keeps the process alive for a pending timer; a Lambda that has
      // already returned should not be held open by one.
      timer.unref?.();
      return { signal: ctrl.signal, ms, clear: () => clearTimeout(timer) };
    },
  };
}

/** A deadline that never expires — for callers that genuinely have no budget. */
export function unlimitedDeadline() {
  return createDeadline(Number.MAX_SAFE_INTEGER);
}
