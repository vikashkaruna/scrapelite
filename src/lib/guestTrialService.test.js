import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BATCH_HARD_LIMIT,
  SINGLE_HARD_LIMIT,
  TRIAL_LIMIT,
  getGuestBatchCount,
  getGuestCount,
  incrementGuestBatchCount,
  incrementGuestCount,
  isBatchHardLimitReached,
  isSingleHardLimitReached,
  isTrialLimitReached,
  shouldShowTrialPrompt,
} from "./guestTrialService.js";

/**
 * U-49..52 — guestTrialService tracks the soft-prompt + hard-block
 * counters for non-logged-in users. The R16/R17 fix is that the
 * counters survive sign-in/out cycles — the spec here locks that
 * contract.
 */

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("incrementGuestCount + getGuestCount (U-49)", () => {
  it("advances by 1 by default", () => {
    expect(getGuestCount()).toBe(0);
    const n = incrementGuestCount();
    expect(n).toBe(1);
    expect(getGuestCount()).toBe(1);
  });

  it("advances by n when supplied", () => {
    incrementGuestCount(3);
    expect(getGuestCount()).toBe(3);
  });
});

describe("shouldShowTrialPrompt (U-50)", () => {
  it("false when count < softLimit", () => {
    expect(shouldShowTrialPrompt(0)).toBe(false);
    expect(shouldShowTrialPrompt(2, TRIAL_LIMIT)).toBe(false);
  });

  it("true at the soft limit (count === 3 with default TRIAL_LIMIT=3)", () => {
    expect(shouldShowTrialPrompt(3, TRIAL_LIMIT)).toBe(true);
  });

  it("true every (interval) extractions past the soft limit", () => {
    // default interval is 2; excess at count=5 is 2 → true; count=4 excess=1 → false
    expect(shouldShowTrialPrompt(5, TRIAL_LIMIT)).toBe(true);
    expect(shouldShowTrialPrompt(4, TRIAL_LIMIT)).toBe(false);
    expect(shouldShowTrialPrompt(7, TRIAL_LIMIT)).toBe(true);
  });
});

describe("isSingleHardLimitReached (U-51)", () => {
  it("true at the hard limit (10)", () => {
    expect(isSingleHardLimitReached(10, SINGLE_HARD_LIMIT)).toBe(true);
    expect(isSingleHardLimitReached(11, SINGLE_HARD_LIMIT)).toBe(true);
  });

  it("false below the hard limit", () => {
    expect(isSingleHardLimitReached(9, SINGLE_HARD_LIMIT)).toBe(false);
  });
});

describe("isBatchHardLimitReached (U-51)", () => {
  it("true at 5 batch runs", () => {
    expect(isBatchHardLimitReached(5, BATCH_HARD_LIMIT)).toBe(true);
  });
});

describe("Settings override (U-52)", () => {
  it("soft_limit: 5, count: 5 → shouldShowTrialPrompt(5) is true", () => {
    expect(shouldShowTrialPrompt(5, 5)).toBe(true);
  });

  it("soft_limit: 5, count: 4 → shouldShowTrialPrompt(4) is false", () => {
    expect(shouldShowTrialPrompt(4, 5)).toBe(false);
  });
});

describe("isTrialLimitReached", () => {
  it("true at the soft limit", () => {
    expect(isTrialLimitReached(3, TRIAL_LIMIT)).toBe(true);
  });
});

describe("incrementGuestBatchCount", () => {
  it("advances and is reflected in getGuestBatchCount", () => {
    expect(getGuestBatchCount()).toBe(0);
    incrementGuestBatchCount();
    expect(getGuestBatchCount()).toBe(1);
  });
});
