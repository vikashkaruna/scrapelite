import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyPostAuth, onboardingUrl, safeNext, isOnboardingExempt,
  setPostAuthIntent, peekPostAuthIntent, clearPostAuthIntent,
  isNudgeDismissed, dismissNudge, NUDGE_MAX_DISMISSALS,
} from "./postAuthIntent.js";

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });

describe("classifyPostAuth — task first, persona second", () => {
  it("front-door pages are plain sign-ups", () => {
    for (const p of ["/", "/pricing", "/about", "/blog"]) {
      expect(classifyPostAuth(p, { pendingTask: false }).kind).toBe("plain");
    }
  });
  it("app surfaces are mid-task sign-ins", () => {
    for (const p of ["/preview", "/discoverability?url=x", "/batch?run=1", "/schedules", "/p/abc"]) {
      expect(classifyPostAuth(p, { pendingTask: false }).kind).toBe("task");
    }
  });
  it("a prefix match needs a path boundary", () => {
    expect(classifyPostAuth("/batchy", { pendingTask: false }).kind).toBe("plain");
  });
  it("a pending audit/schedule/invite/referral makes it a task wherever they are", () => {
    expect(classifyPostAuth("/", { pendingTask: true }).kind).toBe("task");
  });
  it("a use-case page is a plain sign-up that pre-selects its role", () => {
    expect(classifyPostAuth("/use-cases/revops", { pendingTask: false })).toMatchObject({ kind: "plain", role: "revops" });
    expect(classifyPostAuth("/use-cases/seo-audit", { pendingTask: false }).role).toBe("seo");
    expect(classifyPostAuth("/use-cases", { pendingTask: false }).role).toBeNull();
  });
  it("an off-site return path falls back to /", () => {
    expect(classifyPostAuth("//evil.example", { pendingTask: false }).returnTo).toBe("/");
  });
});

describe("onboardingUrl / safeNext", () => {
  it("carries next, role and mode, and drops a / or self-referencing next", () => {
    expect(onboardingUrl({ next: "/preview", role: "sales" })).toBe("/onboarding?next=%2Fpreview&role=sales");
    expect(onboardingUrl({ next: "/" })).toBe("/onboarding");
    expect(onboardingUrl({ next: "/onboarding?x=1", mode: "switch" })).toBe("/onboarding?mode=switch");
  });
  it("only accepts same-origin paths", () => {
    expect(safeNext("/a")).toBe("/a");
    expect(safeNext("//a")).toBeNull();
    expect(safeNext("https://a")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe("isOnboardingExempt", () => {
  it("never interrupts admin, payment, share, reset or onboarding itself", () => {
    for (const p of ["/onboarding", "/admin/users", "/payment/success", "/p/abc", "/reset-password"]) {
      expect(isOnboardingExempt(p)).toBe(true);
    }
    expect(isOnboardingExempt("/preview")).toBe(false);
  });
});

describe("intent stash", () => {
  it("round-trips and clears", () => {
    setPostAuthIntent("/preview");
    expect(peekPostAuthIntent().returnTo).toBe("/preview");
    clearPostAuthIntent();
    expect(peekPostAuthIntent()).toBeNull();
  });
  it("an abandoned stash expires", () => {
    setPostAuthIntent("/preview");
    expect(peekPostAuthIntent(Date.now() + 31 * 60 * 1000)).toBeNull();
  });
});

describe("nudge dismissal", () => {
  it("hides for the session, and for good after the maximum", () => {
    expect(isNudgeDismissed()).toBe(false);
    dismissNudge();
    expect(isNudgeDismissed()).toBe(true);
    sessionStorage.clear(); // new session
    expect(isNudgeDismissed()).toBe(false);
    for (let i = 1; i < NUDGE_MAX_DISMISSALS; i++) dismissNudge();
    sessionStorage.clear();
    expect(isNudgeDismissed()).toBe(true);
  });
});
