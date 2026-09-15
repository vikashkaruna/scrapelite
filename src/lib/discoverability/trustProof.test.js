import { describe, it, expect } from "vitest";
import {
  INDEPENDENCE, SELF_PUBLISHED_MAX, TRUST_SIGNALS, TRUST_SIGNAL_IDS,
  TC_COMPONENTS, TC_COMPONENT_IDS, KIND_SIGNALS,
  makeObservation, scoreSignal, signalProvenance, trustScore, tcScore, trustGaps,
} from "./trustProof.js";

const obs = (signal, independence, count, url = null, verifiable = false) =>
  makeObservation({ signal, independence, count, sourceUrl: url, verifiable });

describe("TC weights are the PRD's, verbatim", () => {
  // The same guard scoringModel.test.js puts on the penalty model after D1: an
  // "align the numbers" pass fails the build with the reasoning attached,
  // rather than silently re-calibrating every brand score in the product.
  it.each([
    ["documented_proof", "D", 0.25],
    ["ratings_reviews", "R", 0.20],
    ["people_identity", "P", 0.20],
    ["media_mentions", "M", 0.15],
    ["credentials", "C", 0.10],
    ["external_presence", "X", 0.10],
  ])("%s (%s) weighs %f", (id, abbr, weight) => {
    expect(TC_COMPONENTS[id].weight).toBe(weight);
    expect(TC_COMPONENTS[id].abbr).toBe(abbr);
  });

  it("and they sum to 1", () => {
    const total = TC_COMPONENT_IDS.reduce((a, id) => a + TC_COMPONENTS[id].weight, 0);
    expect(Math.round(total * 100) / 100).toBe(1);
  });

  it("every component records that its NAME is derived and its WEIGHT is not", () => {
    // The PRD expands these initials nowhere in this repository. Recording the
    // derivation on the component is what lets a correction change the label
    // without touching the weight or the id.
    for (const id of TC_COMPONENT_IDS) {
      expect(TC_COMPONENTS[id].derivedFrom).toMatch(/weight verbatim/i);
    }
  });

  it("every component binds to a declared trust signal", () => {
    for (const id of TC_COMPONENT_IDS) {
      for (const sig of TC_COMPONENTS[id].signals) expect(TRUST_SIGNALS[sig]).toBeTruthy();
    }
  });
});

describe("🔴 evidence QUALITY, never evidence VOLUME", () => {
  it("one independent verified record outscores ANY quantity of self-published material", () => {
    // This is the property the whole model exists for. A counting model is
    // trivially gamed by the party being measured — and worse, it rewards the
    // behaviour, so the number rises while the thing it measures falls.
    const oneReal = scoreSignal([obs("ratings", "third_party", 1, "https://g2.com/acme", true)]);
    const manyFake = scoreSignal([obs("ratings", "self_published", 999)]);
    expect(oneReal).toBeGreaterThan(manyFake);
    expect(manyFake).toBeLessThanOrEqual(SELF_PUBLISHED_MAX);
  });

  it("...and the ceiling is DERIVED from the weight table, not a second cap", () => {
    // An earlier draft applied Math.min(best, 40) — a guard that could never
    // fire, because self_published's 0.25 weight already bounds the score at
    // 25. A redundant guard reading as load-bearing invites a test pinned to
    // the guard instead of the mechanism.
    expect(SELF_PUBLISHED_MAX).toBe(Math.round(100 * INDEPENDENCE.self_published.weight));
  });

  it("scores saturate, so the 50th record adds almost nothing over the 3rd", () => {
    const three = scoreSignal([obs("ratings", "third_party", 3, "https://g2.com/a", true)]);
    const fifty = scoreSignal([obs("ratings", "third_party", 50, "https://g2.com/a", true)]);
    expect(fifty - three).toBeLessThan(7);
  });

  it("an unverifiable independent claim scores below a verifiable one", () => {
    const verified = scoreSignal([obs("ratings", "third_party", 2, "https://g2.com/a", true)]);
    const unverified = scoreSignal([obs("ratings", "third_party", 2, "https://g2.com/a", false)]);
    expect(unverified).toBeLessThan(verified);
  });
});

describe("absent is never zero", () => {
  it("no observations produces null, not 0", () => {
    // "We looked at the review markup and there are none" and "we could not
    // read this page" produce the same number under a naive model and opposite
    // advice.
    expect(scoreSignal([])).toBeNull();
    expect(signalProvenance([])).toBeNull();
  });

  it("a subject with nothing observed scores null, not 0", () => {
    const r = trustScore("brand", {});
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });

  it("...so an unaudited subject never drags its parent score down", () => {
    const r = tcScore({});
    expect(r.score).toBeNull();
    expect(r.unmeasured).toHaveLength(TC_COMPONENT_IDS.length);
  });
});

describe("🔴 provenance is a claim about WHO holds the evidence", () => {
  it("an unknown signal is refused rather than invented", () => {
    expect(makeObservation({ signal: "made_up", independence: "third_party", count: 1 })).toBeNull();
  });

  it("an unknown independence is refused rather than guessed", () => {
    expect(makeObservation({ signal: "ratings", independence: "trust_me", count: 1 })).toBeNull();
  });

  it("a third-party claim with NO URL is demoted, not accepted at face value", () => {
    // An independent record nobody can check is not an independent record — it
    // is a claim about one. Demoting keeps the observation, which is honest;
    // accepting it would let any caller mint third-party standing for free.
    const o = makeObservation({ signal: "ratings", independence: "third_party", count: 3 });
    expect(o.independence).toBe("self_attributed");
  });

  it("...and it carries no evidence envelope, because there is no source", () => {
    const o = makeObservation({ signal: "ratings", independence: "third_party", count: 3 });
    expect(o.evidence).toBeNull();
  });

  it("a sourced observation carries a real evidence record", () => {
    const o = obs("ratings", "third_party", 4, "https://g2.com/acme", true);
    // ⚠️ The envelope is snake_case — it is the wire shape W1 stores, not a
    // JS object we invented here. An earlier draft of this test asserted
    // camelCase and failed; the model was right and the assertion was wrong.
    expect(o.evidence).toMatchObject({ source_url: "https://g2.com/acme", observed_value: 4 });
    expect(o.evidence.collected_at).toBeTruthy();
  });

  it("provenance is read from the observations, never inferred from the score", () => {
    expect(signalProvenance([obs("ratings", "self_published", 5)])).toBe("self_published");
    expect(signalProvenance([
      obs("ratings", "self_published", 5),
      obs("ratings", "third_party", 1, "https://g2.com/a", true),
    ])).toBe("third_party");
  });
});

describe("the three subject kinds ask different questions", () => {
  it("a service is NOT scored on absent product reviews", () => {
    // W11's own `describes` strings are the spec: TR is "credentials,
    // accreditations and proof of past work". Marking a service down for
    // having no product ratings reports a category error as a failing.
    expect(KIND_SIGNALS.service).not.toContain("named_customers");
    expect(KIND_SIGNALS.service).toContain("credentials");
  });

  it("a product IS scored on reviews and named customers", () => {
    expect(KIND_SIGNALS.product).toEqual(expect.arrayContaining(["ratings", "named_customers"]));
  });

  it("a brand reads the widest set — it is the 'is this real' question", () => {
    expect(KIND_SIGNALS.brand.length).toBeGreaterThan(KIND_SIGNALS.product.length);
    expect(KIND_SIGNALS.brand.length).toBeGreaterThan(KIND_SIGNALS.service.length);
  });

  it("every kind's signals exist in the registry", () => {
    for (const ids of Object.values(KIND_SIGNALS)) {
      for (const id of ids) expect(TRUST_SIGNAL_IDS).toContain(id);
    }
  });

  it("an unknown kind returns null rather than a default", () => {
    expect(trustScore("galaxy", {})).toBeNull();
  });
});

describe("coverage and redistribution", () => {
  it("a partially observed subject reports coverage below 100 and names what is missing", () => {
    const r = trustScore("product", {
      ratings: [obs("ratings", "third_party", 3, "https://g2.com/a", true)],
    });
    expect(r.coverage).toBeLessThan(100);
    expect(r.unmeasured).toEqual(expect.arrayContaining(["named_customers", "case_studies"]));
    expect(r.score).toBeGreaterThan(0);
  });

  it("every signal carries the binding it was measured from", () => {
    // So a reader can check the claim rather than take it on faith, and so a
    // signal that loses its source fails loudly instead of reading zero.
    const r = trustScore("product", {});
    for (const s of r.signals) expect(s.binding).toBeTruthy();
  });
});

describe("gaps distinguish absent from self-published-only", () => {
  it("reports an absent signal as absent, not as a failure", () => {
    // BT-01 vs BT-02: opposite remedies. Collapsing them tells a customer
    // their reviews are bad when they simply have none.
    const r = trustScore("product", {});
    const gaps = trustGaps(r);
    expect(gaps.every((g) => g.state === "absent")).toBe(true);
  });

  it("reports self-published-only separately, and says why it scores lower", () => {
    const r = trustScore("product", {
      ratings: [obs("ratings", "self_published", 12)],
    });
    const g = trustGaps(r).find((x) => x.signal === "ratings");
    expect(g.state).toBe("self_published_only");
    expect(g.why).toMatch(/independent record/i);
  });

  it("...and absent signals are listed before weaker-but-present ones", () => {
    const r = trustScore("product", { ratings: [obs("ratings", "self_published", 2)] });
    const gaps = trustGaps(r);
    expect(gaps[0].state).toBe("absent");
  });

  it("a fully independent signal produces no gap for it", () => {
    const r = trustScore("product", {
      ratings: [obs("ratings", "third_party", 9, "https://g2.com/a", true)],
    });
    expect(trustGaps(r).map((g) => g.signal)).not.toContain("ratings");
  });
});
