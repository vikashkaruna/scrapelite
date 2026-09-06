// src/lib/engagement/stateMachine.test.js
import { describe, it, expect } from "vitest";
import {
  PROSPECT_STATUSES,
  isValidTransition,
  calculateEngagementScore,
  transitionProspect,
  detectStaleProspects,
} from "./stateMachine.js";

describe("stateMachine — transition validity", () => {
  it("allows legal forward transitions", () => {
    expect(isValidTransition(PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.QUEUED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.QUEUED, PROSPECT_STATUSES.SENT)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.SENT, PROSPECT_STATUSES.DELIVERED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.DELIVERED, PROSPECT_STATUSES.OPENED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.OPENED, PROSPECT_STATUSES.CLICKED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.CLICKED, PROSPECT_STATUSES.REPLIED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.REPLIED, PROSPECT_STATUSES.CONVERTED)).toBe(true);
  });

  it("is idempotent on self-transitions", () => {
    expect(isValidTransition(PROSPECT_STATUSES.SENT, PROSPECT_STATUSES.SENT)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.OPENED, PROSPECT_STATUSES.OPENED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.NEW, PROSPECT_STATUSES.NEW)).toBe(true);
  });

  it("rejects illegal backward regressions", () => {
    expect(isValidTransition(PROSPECT_STATUSES.CONVERTED, PROSPECT_STATUSES.NEW)).toBe(false);
    expect(isValidTransition(PROSPECT_STATUSES.REPLIED, PROSPECT_STATUSES.NEW)).toBe(false);
    expect(isValidTransition(PROSPECT_STATUSES.DELIVERED, PROSPECT_STATUSES.QUEUED)).toBe(false);
  });

  it("prevents transitions out of OPTED_OUT without admin override", () => {
    expect(isValidTransition(PROSPECT_STATUSES.OPTED_OUT, PROSPECT_STATUSES.QUEUED)).toBe(false);
    expect(isValidTransition(PROSPECT_STATUSES.OPTED_OUT, PROSPECT_STATUSES.NEW)).toBe(false);
  });

  it("allows follow-up and re-engagement transitions", () => {
    expect(isValidTransition(PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.QUEUED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.FOLLOWUP_DUE, PROSPECT_STATUSES.CONVERTED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.UNRESPONSIVE, PROSPECT_STATUSES.QUEUED)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.UNRESPONSIVE, PROSPECT_STATUSES.OPTED_OUT)).toBe(true);
    expect(isValidTransition(PROSPECT_STATUSES.CONVERTED, PROSPECT_STATUSES.FOLLOWUP_DUE)).toBe(true);
  });
});

describe("stateMachine — transition execution & scoring", () => {
  it("computes engagement scores additively", () => {
    let score = 0;
    score = calculateEngagementScore(score, PROSPECT_STATUSES.SENT);
    expect(score).toBe(2);
    score = calculateEngagementScore(score, PROSPECT_STATUSES.DELIVERED);
    expect(score).toBe(7);
    score = calculateEngagementScore(score, PROSPECT_STATUSES.OPENED);
    expect(score).toBe(22);
    score = calculateEngagementScore(score, PROSPECT_STATUSES.CLICKED);
    expect(score).toBe(52);
    score = calculateEngagementScore(score, PROSPECT_STATUSES.REPLIED);
    expect(score).toBe(102);
    score = calculateEngagementScore(score, PROSPECT_STATUSES.CONVERTED);
    expect(score).toBe(202);
  });

  it("decreases score for UNRESPONSIVE but not below 0", () => {
    const reduced = calculateEngagementScore(10, PROSPECT_STATUSES.UNRESPONSIVE);
    expect(reduced).toBeLessThan(10);
    expect(reduced).toBeGreaterThanOrEqual(0);

    const zeroScore = calculateEngagementScore(0, PROSPECT_STATUSES.UNRESPONSIVE);
    expect(zeroScore).toBe(0);
  });

  it("transitions prospect, updates score and creates activity log", () => {
    const prospect = {
      id: "prs_test_1",
      campaign_id: "cmp_1",
      status: PROSPECT_STATUSES.NEW,
      engagement_score: 0,
    };

    const res = transitionProspect(prospect, PROSPECT_STATUSES.QUEUED, { channel: "email" });
    expect(res.ok).toBe(true);
    expect(res.prospect.status).toBe(PROSPECT_STATUSES.QUEUED);
    expect(res.activity.event_type).toBe("status_change_queued");
    expect(res.activity.from_status).toBe(PROSPECT_STATUSES.NEW);
    expect(res.activity.to_status).toBe(PROSPECT_STATUSES.QUEUED);
  });

  it("refuses illegal transition with structured error", () => {
    const prospect = {
      id: "prs_test_2",
      status: PROSPECT_STATUSES.REPLIED,
    };

    const res = transitionProspect(prospect, PROSPECT_STATUSES.NEW);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("illegal_state_transition");
  });

  it("strictly enforces opt-out compliance", () => {
    const optedOut = {
      id: "prs_test_3",
      status: PROSPECT_STATUSES.OPTED_OUT,
    };

    const res = transitionProspect(optedOut, PROSPECT_STATUSES.SENT);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("compliance_violation_opted_out");
  });
});

describe("stateMachine — stale prospect detection", () => {
  it("identifies prospects with stale delivered/opened status after N days", () => {
    const now = Date.now();
    const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000 - 1000).toISOString();
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    const prospects = [
      { id: "1", status: PROSPECT_STATUSES.DELIVERED, last_contacted_at: fourDaysAgo },
      { id: "2", status: PROSPECT_STATUSES.OPENED, last_contacted_at: fourDaysAgo },
      { id: "3", status: PROSPECT_STATUSES.DELIVERED, last_contacted_at: oneDayAgo }, // not stale
      { id: "4", status: PROSPECT_STATUSES.REPLIED, last_contacted_at: fourDaysAgo }, // already replied
      { id: "5", status: PROSPECT_STATUSES.CLICKED, last_contacted_at: fourDaysAgo }, // stale clicked
    ];

    const stale = detectStaleProspects(prospects, 4);
    expect(stale.map((p) => p.id)).toEqual(["1", "2", "5"]);
  });
});
