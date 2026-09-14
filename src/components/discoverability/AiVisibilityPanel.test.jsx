import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AiVisibilityPanel from "./AiVisibilityPanel.jsx";
import { computeWavi } from "../../lib/discoverability/aiVisibility.js";

const sample = (over = {}) => ({
  engine: "perplexity", live: true, liveAnswers: 3, promptCount: 3,
  wavi: computeWavi({ mentionRate: 66.7, citationRate: 33.3, recommendationRate: 50, prominence: 80, accuracy: 100 }),
  states: {
    total: 3, commercialTotal: 2,
    counts: { cited: 1, mentioned: 1, absent: 1 },
    mentionRate: 66.7, citationRate: 33.3, recommendationRate: 50,
  },
  shareOfVoice: {
    sovDeclared: 40, sovObserved: 25,
    declaredCompetitors: [{ host: "clay.com", appearances: 2 }],
    discoveredCompetitors: [],
  },
  runs: [],
  ...over,
});

describe("provenance leads", () => {
  it("says nothing was sampled when no engine is configured", () => {
    // 🔴 "We did not ask" and "you are invisible" must never read the same.
    render(<AiVisibilityPanel sample={null} />);
    expect(screen.getByText(/we did not ask/i)).toBeTruthy();
  });

  it("names the engine and says the answers were retrieved", () => {
    render(<AiVisibilityPanel sample={sample()} />);
    expect(screen.getByText(/Sampled live from/i)).toBeTruthy();
    expect(screen.getByText("perplexity")).toBeTruthy();
  });

  it("🔴 warns plainly when answers came from recall, not the web", () => {
    render(<AiVisibilityPanel sample={sample({ live: false })} />);
    expect(screen.getByText(/own recall, not the live web/i)).toBeTruthy();
    expect(screen.getByText(/indication, not a measurement/i)).toBeTruthy();
  });

  it("says how many answers were actually retrieved in a mixed run", () => {
    render(<AiVisibilityPanel sample={sample({ liveAnswers: 1, promptCount: 3 })} />);
    expect(screen.getByText(/1 of 3 answers were retrieved/i)).toBeTruthy();
  });
});

describe("WAVI", () => {
  it("shows coverage beside the score, not behind a tooltip", () => {
    render(<AiVisibilityPanel sample={sample()} />);
    expect(screen.getByText(/% of the index measured/)).toBeTruthy();
  });

  it("🔴 renders an unmeasured component as 'not measured', never 0", () => {
    const s = sample({
      wavi: computeWavi({ mentionRate: 80, citationRate: 80, recommendationRate: 80, prominence: 80, accuracy: null }),
    });
    render(<AiVisibilityPanel sample={s} />);
    expect(screen.getAllByText(/not measured/i).length).toBeGreaterThan(0);
  });

  it("says the weight redistributes when nothing could be scored", () => {
    render(<AiVisibilityPanel sample={sample({ wavi: computeWavi({}) })} />);
    expect(screen.getByText(/redistributes/i)).toBeTruthy();
  });
});

describe("the rates name their denominator", () => {
  it("says how many prompts were commercial", () => {
    // The denominator is the point: "what is X" was never a contest.
    render(<AiVisibilityPanel sample={sample()} />);
    expect(screen.getByText(/of 2 commercial prompts/i)).toBeTruthy();
  });

  it("🔴 says so when no commercial prompt was asked, rather than showing 0%", () => {
    const s = sample({
      states: { ...sample().states, commercialTotal: 0, recommendationRate: null },
    });
    render(<AiVisibilityPanel sample={s} />);
    expect(screen.getByText(/no commercial prompt was asked/i)).toBeTruthy();
  });
});

describe("share of voice", () => {
  it("reports the declared field, and names who is in it", () => {
    render(<AiVisibilityPanel sample={sample()} />);
    expect(screen.getByText(/against the competitors you named/i)).toBeTruthy();
    expect(screen.getByText(/clay\.com \(2\)/)).toBeTruthy();
  });

  it("🔴 keeps the observed figure apart, and labels it a direction", () => {
    const s = sample({
      shareOfVoice: {
        ...sample().shareOfVoice,
        discoveredCompetitors: [{ host: "random.com", appearances: 1 }],
      },
    });
    render(<AiVisibilityPanel sample={s} />);
    expect(screen.getByText(/inferred from citations/i)).toBeTruthy();
    expect(screen.getByText(/A direction, not a target/i)).toBeTruthy();
  });
});

describe("displacement", () => {
  it("names who answered a question we were absent from", () => {
    const s = sample({
      runs: [{
        prompt: "best scraping tools", state: "absent", commercial: true,
        competitors: [{ host: "clay.com", declared: true, confidence: 100, citations: 1 }],
      }],
    });
    render(<AiVisibilityPanel sample={s} />);
    expect(screen.getByText(/answered by somebody else/i)).toBeTruthy();
    expect(screen.getByText(/sourced clay\.com and did not name you/i)).toBeTruthy();
  });

  it("separates the questions nobody owns", () => {
    const s = sample({
      runs: [{ prompt: "an unclaimed question", state: "absent", commercial: true, competitors: [] }],
    });
    render(<AiVisibilityPanel sample={s} />);
    expect(screen.getAllByText(/nobody owns/i).length).toBeGreaterThan(0);
    expect(screen.getByText("an unclaimed question")).toBeTruthy();
    expect(screen.getByText(/cheapest ones to win/i)).toBeTruthy();
  });
});
