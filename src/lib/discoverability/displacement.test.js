import { describe, it, expect } from "vitest";
import {
  displacements, openQuestions, describeDisplacement, displacementReport,
} from "./displacement.js";
import {
  CADENCES, cadenceToNextRun, isDue, diffMonitorRuns, shouldAlert,
} from "./promptMonitorModel.js";

const rival = (host, declared = true) => ({ host, declared, confidence: declared ? 100 : 45, citations: 1 });
const run = (over = {}) => ({ prompt: "best tools", state: "absent", competitors: [], commercial: true, ...over });

describe("displacements", () => {
  it("finds the prompts a rival took and we did not appear in", () => {
    const d = displacements([
      run({ prompt: "best tools", competitors: [rival("clay.com")] }),
      run({ prompt: "what is x", state: "cited" }),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0].prompt).toBe("best tools");
  });

  it("🔴 is not displacement when we were present", () => {
    // Being cited alongside a competitor is a contest we are in, not one we
    // lost. Reporting it as displacement would make a good answer look bad.
    for (const state of ["mentioned", "cited", "recommended", "cited_and_recommended"]) {
      expect(displacements([run({ state, competitors: [rival("clay.com")] })])).toHaveLength(0);
    }
  });

  it("is not displacement when nobody appeared at all", () => {
    // That is an open question, which has the opposite action.
    expect(displacements([run({ state: "absent", competitors: [] })])).toHaveLength(0);
  });

  it("puts declared rivals ahead of inferred ones", () => {
    const d = displacements([run({ competitors: [rival("random.com", false), rival("clay.com", true)] })]);
    expect(d[0].competitors[0].host).toBe("clay.com");
  });

  it("ignores failed runs and respects the limit", () => {
    expect(displacements([{ error: "boom", competitors: [rival("clay.com")] }])).toHaveLength(0);
    const many = Array.from({ length: 20 }, (_, i) =>
      run({ prompt: `p${i}`, competitors: [rival("clay.com")] }));
    expect(displacements(many, { limit: 3 })).toHaveLength(3);
  });
});

describe("openQuestions", () => {
  it("separates 'nobody owns this' from 'somebody else does'", () => {
    // The action is opposite: an open question is the cheapest thing on the
    // list to win; a displaced one means arguing with an incumbent.
    const open = openQuestions([
      run({ prompt: "unclaimed", state: "absent", competitors: [] }),
      run({ prompt: "taken", state: "absent", competitors: [rival("clay.com")] }),
    ]);
    expect(open.map((o) => o.prompt)).toEqual(["unclaimed"]);
  });
});

describe("describeDisplacement", () => {
  it("names the prompt and who was sourced", () => {
    const s = describeDisplacement({
      prompt: "best tools", commercial: true, competitors: [rival("clay.com")],
    });
    expect(s).toContain("best tools");
    expect(s).toContain("clay.com");
    expect(s).toMatch(/recommendation, not just recall/);
  });

  it("🔴 never speculates about WHY the engine chose them", () => {
    // We did not observe the model's reasoning and neither did anybody else.
    // "Clay is cited because they have better domain authority" is a
    // plausible-sounding invention about a third party, inside a report the
    // customer forwards onward.
    const s = describeDisplacement({ prompt: "p", competitors: [rival("clay.com")] });
    expect(s).not.toMatch(/because (?:they|their|it)/i);
    expect(s).not.toMatch(/authority|reputation|better content|stronger/i);
  });

  it("⚠️ flags when a named rival was inferred rather than declared", () => {
    const s = describeDisplacement({ prompt: "p", competitors: [rival("random.com", false)] });
    expect(s).toMatch(/inferred/i);
  });

  it("says nothing when there is nobody to name", () => {
    expect(describeDisplacement({ prompt: "p", competitors: [] })).toBeNull();
    expect(describeDisplacement(null)).toBeNull();
  });
});

describe("displacementReport", () => {
  it("ranks who is taking the most questions from us", () => {
    const r = displacementReport([
      run({ prompt: "a", competitors: [rival("clay.com")] }),
      run({ prompt: "b", competitors: [rival("clay.com"), rival("apify.com")] }),
      run({ prompt: "c", state: "absent", competitors: [] }),
    ]);
    expect(r.displacedCount).toBe(2);
    expect(r.openCount).toBe(1);
    expect(r.byCompetitor[0]).toMatchObject({ host: "clay.com", prompts: 2 });
    expect(r.displaced[0].narrative).toBeTruthy();
  });
});

describe("cadence and due-ness", () => {
  it("offers the three cadences a monitor can hold", () => {
    expect(CADENCES).toEqual(["daily", "weekly", "monthly"]);
  });

  it("falls back to weekly for an unknown cadence rather than never running", () => {
    const now = Date.parse("2026-09-11T00:00:00Z");
    expect(cadenceToNextRun("nonsense", now)).toBe(cadenceToNextRun("weekly", now));
  });

  it("treats a never-run monitor as due", () => {
    expect(isDue({ status: "active", system_paused: false, next_run_at: null })).toBe(true);
  });

  it("🔴 honours BOTH pauses independently", () => {
    // A monitor an operator paused must not be resumable by the user, and one
    // the USER paused must stay paused when the platform resumes everything.
    expect(isDue({ status: "paused", system_paused: false })).toBe(false);
    expect(isDue({ status: "active", system_paused: true })).toBe(false);
  });

  it("stops at run_until", () => {
    const now = Date.parse("2026-09-11T00:00:00Z");
    expect(isDue({ status: "active", system_paused: false, run_until: "2026-09-01T00:00:00Z" }, now)).toBe(false);
  });
});

describe("diffMonitorRuns", () => {
  const r = (state, prompt = "p") => ({ prompt, state });

  it("reports a state change with its direction", () => {
    const d = diffMonitorRuns(
      { live: true, runs: [r("cited")], wavi_score: 60 },
      { live: true, runs: [r("absent")], wavi_score: 40 },
    );
    expect(d.comparable).toBe(true);
    expect(d.stateChanges[0]).toMatchObject({ from: "cited", to: "absent", worse: true });
    expect(d.waviChange).toBe(-20);
    expect(d.newlyAbsent).toEqual(["p"]);
  });

  it("🔴 REFUSES to compare a live run against a recalled one", () => {
    // A week sampled live and a week answered from a model's own weights are
    // measurements of different things; a delta across them is part visibility
    // and part which engine answered.
    const d = diffMonitorRuns(
      { live: false, runs: [r("cited")], wavi_score: 60 },
      { live: true, runs: [r("absent")], wavi_score: 40 },
    );
    expect(d.comparable).toBe(false);
    expect(d.waviChange).toBeNull();
    expect(d.reason).toMatch(/not comparable/);
  });

  it("says a first run has nothing to compare against", () => {
    const d = diffMonitorRuns(null, { live: true, runs: [r("cited")] });
    expect(d.comparable).toBe(false);
    expect(d.reason).toMatch(/first run/);
  });
});

describe("shouldAlert", () => {
  const monitor = (over = {}) => ({
    alert_email: "a@b.com", alert_on_state_change: true, alert_wavi_delta: 10, ...over,
  });

  it("🔴 alerts on a state change even when the score barely moved", () => {
    // Going from cited to absent is news at any score: what changed is whether
    // anyone can reach you through that question.
    const d = { comparable: true, stateChanges: [{ prompt: "p" }], waviChange: 0.4 };
    expect(shouldAlert(monitor(), d)).toBe(true);
  });

  it("alerts on a WAVI move past the threshold with no state change", () => {
    expect(shouldAlert(monitor(), { comparable: true, stateChanges: [], waviChange: -12 })).toBe(true);
    expect(shouldAlert(monitor(), { comparable: true, stateChanges: [], waviChange: -4 })).toBe(false);
  });

  it("stays silent when nothing moved — a monitor that always mails is unread by week four", () => {
    expect(shouldAlert(monitor(), { comparable: true, stateChanges: [], waviChange: 0 })).toBe(false);
  });

  it("🔴 never alerts on an incomparable pair", () => {
    expect(shouldAlert(monitor(), { comparable: false, stateChanges: [], waviChange: null })).toBe(false);
  });

  it("needs somewhere to send it", () => {
    expect(shouldAlert(monitor({ alert_email: null }), { comparable: true, stateChanges: [{}] })).toBe(false);
  });
});
