import { describe, it, expect } from "vitest";
import {
  buildConstruct, hasPlaceholders, CONSTRUCT_BUILDERS, AI_CRAWLERS,
  answerBlock, faqSchema, howToSchema, headingTree, organizationSchema,
  metaTags, robotsTxtBlock, entityCard,
} from "./constructTemplates.js";
import { ISSUES, ISSUE_CODES } from "./issueCatalog.js";

const jsonFrom = (body) => JSON.parse(body.replace(/<\/?script[^>]*>/g, "").trim());

describe("catalogue ↔ builder wiring", () => {
  it("every asset an issue promises can actually be built", () => {
    // A recommendation offering a download that does not exist is worse than
    // one offering nothing.
    for (const code of ISSUE_CODES) {
      const asset = ISSUES[code].asset;
      if (!asset) continue;
      expect(CONSTRUCT_BUILDERS[asset], `${code} → ${asset}`).toBeTypeOf("function");
      expect(buildConstruct(asset, {}), `${code} → ${asset}`).toBeTruthy();
    }
  });

  it("degrades to null for an unknown or absent asset type", () => {
    // A stored audit from a newer build must lose its attachment, not the
    // whole recommendation.
    expect(buildConstruct("invented_by_a_future_build", {})).toBeNull();
    expect(buildConstruct(null)).toBeNull();
    expect(buildConstruct(undefined)).toBeNull();
  });

  it("every construct carries a label and an explanatory note", () => {
    for (const type of Object.keys(CONSTRUCT_BUILDERS)) {
      const c = buildConstruct(type, {});
      expect(c.label, type).toBeTruthy();
      expect(c.note?.length, type).toBeGreaterThan(20);
      expect(c.body, type).toBeTruthy();
      expect(c.assetType).toBe(type);
    }
  });
});

describe("placeholders, not inventions", () => {
  it("marks everything it could not observe as an explicit TODO", () => {
    // A schema block containing a hallucinated founder name is worse than no
    // block, because it gets published without being read.
    const org = organizationSchema({});
    expect(hasPlaceholders(org)).toBe(true);
    const parsed = jsonFrom(org.body);
    expect(parsed.name).toMatch(/^TODO:/);
    expect(parsed.sameAs.every((s) => s.startsWith("TODO:"))).toBe(true);
  });

  it("emits no placeholders once the facts are known", () => {
    const org = organizationSchema({
      name: "Example Ltd", url: "https://example.com", logo: "https://example.com/l.png",
      description: "A company.", sameAs: ["https://x.com/example"],
    });
    expect(hasPlaceholders(org)).toBe(false);
    expect(jsonFrom(org.body).name).toBe("Example Ltd");
  });
});

describe("FAQ and HowTo are built from VISIBLE content only", () => {
  it("marks whether the markup came from real on-page content", () => {
    // This flag is what stops the generator manufacturing SH-07 — markup
    // describing text a reader cannot see — the very defect the engine reports.
    const real = faqSchema([{ question: "Q?", answer: "A." }]);
    const empty = faqSchema([]);
    expect(real.derivedFromVisibleContent).toBe(true);
    expect(empty.derivedFromVisibleContent).toBe(false);
    expect(hasPlaceholders(empty)).toBe(true);
  });

  it("reproduces the visible wording exactly", () => {
    const q = "How does GEO help AI citations?";
    const a = "It makes the facts about your brand machine-resolvable.";
    const parsed = jsonFrom(faqSchema([{ question: q, answer: a }]).body);
    expect(parsed.mainEntity[0].name).toBe(q);
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe(a);
  });

  it("numbers HowTo steps in visible order", () => {
    const parsed = jsonFrom(howToSchema({
      name: "Set up an audit",
      steps: [{ name: "Paste the URL" }, { name: "Pick a profile" }, { name: "Run" }],
    }).body);
    expect(parsed.step.map((s) => s.position)).toEqual([1, 2, 3]);
    expect(parsed.step[0].name).toBe("Paste the URL");
  });
});

describe("headingTree repair", () => {
  it("pulls a skipped level up to one below its parent", () => {
    const t = headingTree([{ level: 1, text: "A" }, { level: 2, text: "B" }, { level: 4, text: "C" }]);
    expect(t.body).toContain("### C");
    expect(t.corrections).toBe(1);
  });

  it("leaves a clean tree untouched", () => {
    const t = headingTree([{ level: 1, text: "A" }, { level: 2, text: "B" }, { level: 3, text: "C" }]);
    expect(t.corrections).toBe(0);
  });

  it("never rewrites the author's section wording — only the level", () => {
    const t = headingTree([{ level: 1, text: "A deliberately Odd Heading" }, { level: 3, text: "B" }]);
    expect(t.body).toContain("A deliberately Odd Heading");
  });

  it("flags an empty heading rather than silently dropping it", () => {
    const t = headingTree([{ level: 1, text: "A" }, { level: 2, text: "  " }]);
    expect(t.body).toMatch(/TODO: heading text/);
  });

  it("demotes a stray second H1 rather than leaving two", () => {
    const t = headingTree([{ level: 1, text: "A" }, { level: 1, text: "B" }]);
    // The second H1 is at most one deeper than its parent, so it becomes H2.
    expect(t.body.split("\n")[1]).toMatch(/^## B/);
  });

  it("says so when there is nothing to repair", () => {
    expect(headingTree([]).body).toMatch(/TODO:.*no headings/);
  });
});

describe("answerBlock", () => {
  it("reshapes the author's own words when a candidate passage exists", () => {
    const existing = "Generative engine optimization is the practice of structuring content so AI systems can cite it.";
    const b = answerBlock({ question: "What is GEO?", existingText: existing });
    expect(b.body).toContain("Generative engine optimization is the practice");
    expect(hasPlaceholders(b)).toBe(false);
  });

  it("trims an over-long candidate to the 60-word budget", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const words = answerBlock({ question: "Q?", existingText: long }).body
      .split("\n").filter((l) => l.startsWith("word")).join(" ").split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(60);
  });

  it("emits a scaffold, not invented prose, when there is no candidate", () => {
    const b = answerBlock({ question: "What is GEO?" });
    expect(hasPlaceholders(b)).toBe(true);
    expect(b.body).toContain("## What is GEO?");
  });
});

describe("robotsTxtBlock", () => {
  it("covers the crawlers that actually feed answer engines", () => {
    const b = robotsTxtBlock({});
    for (const ua of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      expect(b.body, ua).toContain(`User-agent: ${ua}`);
    }
    expect(AI_CRAWLERS.length).toBeGreaterThan(8);
  });

  it("narrows to just the blocked agents when we know which they are", () => {
    const b = robotsTxtBlock({ blocked: ["ClaudeBot"] });
    expect(b.body).toContain("User-agent: ClaudeBot");
    expect(b.body).not.toContain("User-agent: GPTBot");
    expect(b.agents).toEqual(["ClaudeBot"]);
  });

  it("frames access as an editorial choice rather than a score to maximise", () => {
    expect(robotsTxtBlock({}).body).toMatch(/legitimate\s+choice/i);
  });
});

describe("metaTags", () => {
  it("offers several angles including a question form for answer engines", () => {
    const m = metaTags({ title: "Generative engine optimization", brand: "DatIQ" });
    expect(m.options).toHaveLength(3);
    expect(m.body).toContain("question form");
    expect(m.options[0]).toContain("DatIQ");
  });
  it("leads with the phrase, not the brand", () => {
    expect(metaTags({ primaryPhrase: "GEO guide", brand: "DatIQ" }).options[0]).toMatch(/^GEO guide/);
  });
});

describe("entityCard", () => {
  it("produces a canonical fact page skeleton with the brand's own facts", () => {
    const c = entityCard({ brand: "DatIQ", description: "A URL intelligence platform.", offerings: ["Extraction", "Audits"] });
    expect(c.body).toContain("# DatIQ");
    expect(c.body).toContain("## What is DatIQ?");
    expect(c.body).toContain("Extraction, Audits");
  });
  it("tells the author to write flatly so an engine can quote it verbatim", () => {
    expect(entityCard({}).note).toMatch(/verbatim/);
  });
});
