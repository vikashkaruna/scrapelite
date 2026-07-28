// billingNotices.test.js — the dunning schedule.
//
// The two properties under test are the ones that go badly wrong in production
// if they regress: no burst after an outage, and no repeat within a cycle.
import { describe, expect, it } from "vitest";
import { GRACE_DAYS, NOTICES, noticeCopy, pickDueNotice, windowKeyFor } from "./billingNotices.js";

const DAY = 24 * 60 * 60 * 1000;
const END = Date.parse("2026-08-14T00:00:00Z");

const paid = (over = {}) => ({
  user_id: "u1",
  plan_id: "pro",
  status: "active",
  source: "payment",
  period_end: new Date(END).toISOString(),
  ...over,
});

const at = (days, hours = 0) => new Date(END + days * DAY + hours * 3600_000);
const kindAt = (days, ent = paid()) => pickDueNotice(ent, at(days))?.kind ?? null;

describe("the series fires on the requested days", () => {
  it("warns a week ahead, two days ahead, and on the day itself", () => {
    // Requirement 6.
    expect(kindAt(-7)).toBe("renewal_t7");
    expect(kindAt(-2)).toBe("renewal_t2");
    expect(kindAt(0)).toBe("lapsed_d0");
  });

  it("warns about deletion a week ahead, two days ahead, and on the day", () => {
    // Requirement 13.
    expect(kindAt(83)).toBe("delete_d83");
    expect(kindAt(88)).toBe("delete_d88");
    expect(kindAt(90)).toBe("delete_d90");
  });

  it("marks the suspension and deactivation milestones", () => {
    expect(kindAt(7)).toBe("suspend_d7");
    expect(kindAt(21)).toBe("suspend_d21");
    expect(kindAt(30)).toBe("deactivate_d30");
  });

  it("sends nothing before the first notice is due", () => {
    expect(kindAt(-30)).toBeNull();
    expect(kindAt(-8)).toBeNull();
  });

  it("sends nothing on the quiet days between notices", () => {
    // -3 is past renewal_t7's grace window (-7 + 3) and before renewal_t2.
    expect(kindAt(-3)).toBeNull();
    expect(kindAt(14)).toBeNull();
    expect(kindAt(60)).toBeNull();
  });

  it("still fires the 7-day warning if the cron was a day or two late", () => {
    // Late is better than silent: the customer would otherwise get no warning
    // at all before their subscription lapsed.
    expect(kindAt(-5)).toBe("renewal_t7");
  });

  it("sends nothing after the series has finished", () => {
    expect(kindAt(120)).toBeNull();
  });
});

describe("no burst after a cron outage", () => {
  it("sends only the most recent notice, not every one that came due", () => {
    // The cron was down from day 83 to day 90. The customer must receive ONE
    // email, not three — a burst of billing mail reads as a malfunction at
    // exactly the moment you least want to look broken.
    const due = pickDueNotice(paid(), at(90));
    expect(due.kind).toBe("delete_d90");
  });

  it("still fires a notice a couple of days late", () => {
    expect(kindAt(2)).toBe("lapsed_d0");
    expect(kindAt(GRACE_DAYS)).toBe("lapsed_d0");
  });

  it("gives up rather than back-filling an ancient notice", () => {
    expect(kindAt(GRACE_DAYS + 1)).toBeNull();
  });
});

describe("who is dunned", () => {
  it("never duns a free or never-paid account", () => {
    expect(pickDueNotice({ plan_id: "free", source: null, period_end: null }, at(0))).toBeNull();
    expect(pickDueNotice({ plan_id: "free", source: null, period_end: null }, at(90))).toBeNull();
  });

  it("never duns a row migrated from the legacy subscriptions table", () => {
    expect(pickDueNotice(paid({ source: "migration", period_end: null }), at(0))).toBeNull();
  });

  it("stops once the account is purged", () => {
    expect(pickDueNotice(paid({ status: "purged" }), at(90))).toBeNull();
  });

  it("suppresses the whole series while an admin comp is open", () => {
    // Someone is deliberately covering this account; telling the customer it
    // has lapsed would be wrong.
    const comped = paid({ comp_until: new Date(END + 40 * DAY).toISOString() });
    expect(pickDueNotice(comped, at(7))).toBeNull();
    expect(pickDueNotice(comped, at(30))).toBeNull();
  });

  it("resumes the series once the comp expires", () => {
    const comped = paid({ comp_until: new Date(END + 5 * DAY).toISOString() });
    expect(pickDueNotice(comped, at(7))?.kind).toBe("suspend_d7");
  });

  it("tolerates a malformed period_end", () => {
    expect(pickDueNotice(paid({ period_end: "nonsense" }), at(0))).toBeNull();
  });
});

describe("idempotency key", () => {
  it("is anchored on the CYCLE, not on today", () => {
    // This is the reengagement.js bug: `d7:${today}` matches a fresh window
    // every day, so a permanently-inactive user is emailed daily forever.
    const morning = pickDueNotice(paid(), at(7, 1));
    const evening = pickDueNotice(paid(), at(7, 20));
    expect(morning.windowKey).toBe(evening.windowKey);
    expect(morning.windowKey).toBe("suspend_d7:2026-08-14");
  });

  it("changes when the subscription cycle changes", () => {
    const cycle2 = paid({ period_end: "2026-09-14T00:00:00Z" });
    expect(windowKeyFor("suspend_d7", cycle2.period_end)).toBe("suspend_d7:2026-09-14");
    expect(windowKeyFor("suspend_d7", paid().period_end)).not.toBe(
      windowKeyFor("suspend_d7", cycle2.period_end),
    );
  });
});

describe("copy", () => {
  it("has subject and body for every notice in the series", () => {
    for (const n of NOTICES) {
      const c = noticeCopy(n.kind, { planName: "Pro", endsOn: "14 Aug 2026", purgeOn: "12 Nov 2026" });
      expect(c.subject).toBeTruthy();
      expect(c.heading).toBeTruthy();
      expect(c.body).toBeTruthy();
      expect(c.cta).toBeTruthy();
    }
  });

  it("reassures the user that their data is safe while suspended", () => {
    const c = noticeCopy("lapsed_d0", { planName: "Pro" });
    expect(`${c.body}`).toMatch(/export/i);
    expect(`${c.body}`).toMatch(/saved|data/i);
  });

  it("names the deletion date in every deletion warning", () => {
    for (const kind of ["delete_d83", "delete_d88"]) {
      expect(noticeCopy(kind, { purgeOn: "12 Nov 2026" }).body).toMatch(/12 Nov 2026/);
    }
  });

  it("tells the user their invoices survive the purge", () => {
    expect(noticeCopy("delete_d83", { purgeOn: "12 Nov 2026" }).body).toMatch(/invoice/i);
  });
});
