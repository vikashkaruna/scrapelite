// src/lib/rules/retryModel.test.js
//
// PRD 5's "retry failed actions" is one sentence with a lot of ways to get it
// wrong. The assertions that matter here are the ones about what must NOT be
// retried — a retry loop pointed at the wrong outcome is worse than no retry at
// all, because it is automated and repeats.

import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATUS, ALLOWED_STATUSES, MAX_ATTEMPTS,
  backoffMs, shouldRetry, nextRetryAt, statusFor, describeRetry,
} from "./retryModel.js";

const failed = (httpStatus = null) => ({ status: EXECUTION_STATUS.FAILED, httpStatus });

describe("what is retryable", () => {
  it("a transient failure is retried", () => {
    expect(shouldRetry(failed(), 1).retry).toBe(true);
    expect(shouldRetry(failed(503), 1).retry).toBe(true);
    expect(shouldRetry(failed(500), 2).retry).toBe(true);
  });

  it("🔴 a REFUSED destination is never retried", () => {
    // The single most important assertion in this file. `refused` means the
    // SSRF guard rejected the destination. Retrying would convert one blocked
    // request into a scheduled, repeating attempt to reach a private address.
    const r = shouldRetry({ status: EXECUTION_STATUS.REFUSED }, 1);
    expect(r.retry).toBe(false);
    expect(nextRetryAt({ status: EXECUTION_STATUS.REFUSED }, 1)).toBeNull();
  });

  it("🔴 a SKIPPED outcome is never retried", () => {
    // No mailer configured, no HubSpot connection. Waiting changes nothing, and
    // retrying buries the one signal telling an operator to go and fix it.
    expect(shouldRetry({ status: EXECUTION_STATUS.SKIPPED }, 1).retry).toBe(false);
  });

  it("a success is never retried", () => {
    expect(shouldRetry({ status: EXECUTION_STATUS.SUCCESS }, 1).retry).toBe(false);
  });

  it("an unknown status is not retried", () => {
    expect(shouldRetry({ status: "banana" }, 1).retry).toBe(false);
    expect(shouldRetry({}, 1).retry).toBe(false);
  });
});

describe("4xx from the destination", () => {
  it("🔴 a 4xx is not retried — the destination said the request was wrong", () => {
    for (const code of [400, 401, 403, 404, 422]) {
      expect(shouldRetry(failed(code), 1).retry, `${code} must not retry`).toBe(false);
    }
  });

  it("…except 408 and 429, which are exactly what a backoff is for", () => {
    expect(shouldRetry(failed(408), 1).retry).toBe(true);
    expect(shouldRetry(failed(429), 1).retry).toBe(true);
  });

  it("5xx is retried", () => {
    for (const code of [500, 502, 503, 504]) {
      expect(shouldRetry(failed(code), 1).retry, `${code} should retry`).toBe(true);
    }
  });

  it("a missing http status (timeout, DNS) is retried", () => {
    expect(shouldRetry(failed(null), 1).retry).toBe(true);
  });
});

describe("the ceiling", () => {
  it("stops at MAX_ATTEMPTS", () => {
    expect(shouldRetry(failed(), MAX_ATTEMPTS - 1).retry).toBe(true);
    expect(shouldRetry(failed(), MAX_ATTEMPTS).retry).toBe(false);
    expect(shouldRetry(failed(), MAX_ATTEMPTS + 5).retry).toBe(false);
  });

  it("says why it stopped, so the history is readable", () => {
    expect(shouldRetry(failed(), MAX_ATTEMPTS).reason).toMatch(/exhausted/i);
  });
});

describe("backoff", () => {
  it("matches the schedule the rest of the platform uses (1m, 5m, 30m, 2h, 12h)", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(5 * 60_000);
    expect(backoffMs(3)).toBe(30 * 60_000);
    expect(backoffMs(4)).toBe(2 * 60 * 60_000);
    expect(backoffMs(5)).toBe(12 * 60 * 60_000);
  });

  it("is monotonic — a later attempt never waits less", () => {
    for (let n = 1; n < 6; n += 1) {
      expect(backoffMs(n + 1)).toBeGreaterThanOrEqual(backoffMs(n));
    }
  });

  it("clamps rather than returning undefined past the table", () => {
    expect(backoffMs(99)).toBe(12 * 60 * 60_000);
    expect(backoffMs(-3)).toBe(0);
    expect(backoffMs("nonsense")).toBe(0);
  });

  it("schedules the next attempt from the given clock", () => {
    const now = new Date("2026-09-04T12:00:00.000Z");
    expect(nextRetryAt(failed(), 1, now)).toBe("2026-09-04T12:01:00.000Z");
    expect(nextRetryAt(failed(), 2, now)).toBe("2026-09-04T12:05:00.000Z");
  });
});

describe("the status that gets STORED", () => {
  it("🔴 a retryable failure is stored as `retrying`, not `failed`", () => {
    // Storing it as failed would show a permanent failure in the rule history
    // for something still in flight, and the user would go and "fix" a rule
    // that was about to work by itself.
    expect(statusFor(failed(), 1)).toBe(EXECUTION_STATUS.RETRYING);
  });

  it("a failure at the ceiling settles as `failed`", () => {
    expect(statusFor(failed(), MAX_ATTEMPTS)).toBe(EXECUTION_STATUS.FAILED);
  });

  it("a 4xx settles immediately as `failed`, never `retrying`", () => {
    expect(statusFor(failed(404), 1)).toBe(EXECUTION_STATUS.FAILED);
  });

  it("terminal outcomes are stored as themselves", () => {
    expect(statusFor({ status: EXECUTION_STATUS.SUCCESS }, 1)).toBe(EXECUTION_STATUS.SUCCESS);
    expect(statusFor({ status: EXECUTION_STATUS.REFUSED }, 1)).toBe(EXECUTION_STATUS.REFUSED);
    expect(statusFor({ status: EXECUTION_STATUS.SKIPPED }, 1)).toBe(EXECUTION_STATUS.SKIPPED);
  });

  it("🔴 never stores a status the database would reject", () => {
    // 0043 constrained status to three values and the dispatcher produced a
    // fourth (`refused`), so every SSRF refusal violated the CHECK and was
    // silently dropped by the caller's catch — the audit trail lost exactly the
    // events an operator most needs. 0046 widened the CHECK; this keeps the two
    // vocabularies in step.
    for (const s of ["success", "failed", "skipped", "refused", "retrying", "banana", "", null]) {
      expect(ALLOWED_STATUSES).toContain(statusFor({ status: s }, 1));
    }
  });
});

describe("describeRetry — what the user reads", () => {
  it("names the wait", () => {
    expect(describeRetry(failed(), 1)).toMatch(/retrying in 1 minute/i);
    expect(describeRetry(failed(), 2)).toMatch(/retrying in 5 minutes/i);
  });

  it("explains a refusal without implying the destination is flaky", () => {
    const text = describeRetry({ status: EXECUTION_STATUS.REFUSED }, 1);
    expect(text).toMatch(/refused/i);
    expect(text).not.toMatch(/retrying in/i);
  });

  it("tells an operator when the fix is configuration, not patience", () => {
    expect(describeRetry({ status: EXECUTION_STATUS.SKIPPED }, 1)).toMatch(/configuration change/i);
  });
});
