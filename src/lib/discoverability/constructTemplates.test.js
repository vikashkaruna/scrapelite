import { describe, it, expect } from "vitest";
import {
  buildConstruct, hasPlaceholders, CONSTRUCT_BUILDERS, AI_CRAWLERS,
  answerBlock, faqSchema, howToSchema, headingTree, organizationSchema,
  metaTags, robotsTxtBlock, entityCard, META_TITLE_MAX, META_DESCRIPTION_MAX,
  internalLinkPlan, isVagueAnchor, anchorFromHref, VAGUE_ANCHORS,
  contentBrief, technicalBrief,
} from "./constructTemplates.js";
import { ISSUES, ISSUE_CODES } from "./issueCatalog.js";

// Read what is INSIDE the script element rather than stripping its tags.
const jsonFrom = (body) => JSON.parse((body.match(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/i)?.[1] ?? body).trim());

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

  // ── W5: description variants ────────────────────────────────────────────
  // Titles have carried three angles since the scoring engine shipped; the
  // description carried one. A chooser with three titles and a single fixed
  // description is not a set of options, it is one option wearing three hats.

  it("offers a description for every title angle", () => {
    const m = metaTags({ title: "GEO guide", brand: "DatIQ" });
    expect(m.descriptions).toHaveLength(m.options.length);
    expect(m.body.match(/name="description"/g)).toHaveLength(3);
  });

  it("leads with the author's own description when the page has one", () => {
    const theirs = "A practical guide to generative engine optimization for technical teams.";
    expect(metaTags({ title: "GEO guide", description: theirs }).descriptions[0]).toBe(theirs);
  });

  it("does NOT re-angle the author's sentence into the other variants", () => {
    // Re-angling is writing, not transforming. A machine rewrite of copy that
    // ships verbatim is the invention this module exists to refuse.
    const theirs = "A practical guide to generative engine optimization for technical teams.";
    const m = metaTags({ title: "GEO guide", description: theirs });
    expect(m.descriptions[1]).toContain("TODO:");
    expect(m.descriptions[2]).toContain("TODO:");
    expect(m.descriptions[1]).not.toContain(theirs);
  });

  it("says so when an observed title will be truncated", () => {
    const long = "x".repeat(META_TITLE_MAX + 12);
    expect(metaTags({ title: long, primaryPhrase: long }).body).toMatch(/will truncate/);
  });

  it("never measures a placeholder, only something observed", () => {
    // Measuring a TODO reports the length of our own prompt text, which would
    // tell an author their description fits when they have not written one.
    const m = metaTags({});
    expect(m.body).not.toMatch(/\d+ chars/);
  });

  it("keeps a short observed description unflagged", () => {
    const ok = "A short, entirely reasonable description.";
    expect(metaTags({ title: "T", description: ok }).body)
      .toContain(`${ok.length} chars`);
    expect(metaTags({ title: "T", description: ok }).body).not.toMatch(/will truncate/);
  });

  it("still produces a pasteable block with no facts at all", () => {
    const m = metaTags({});
    expect(m.body).toContain("<title>");
    expect(hasPlaceholders(m)).toBe(true);
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


// ── W5.2 · internal linking ─────────────────────────────────────────────────

describe("isVagueAnchor", () => {
  it("catches the standard offenders regardless of case and punctuation", () => {
    for (const t of ["click here", "Click Here", "  READ MORE  ", "Learn more!", "here."]) {
      expect(isVagueAnchor(t), t).toBe(true);
    }
  });

  it("leaves descriptive anchors alone", () => {
    for (const t of ["answer engine optimization", "2026 pricing", "our security posture"]) {
      expect(isVagueAnchor(t), t).toBe(false);
    }
  });

  it("does not treat empty text as vague", () => {
    // Empty is a DIFFERENT defect with a different fix — an image link needs
    // alt text, not a reworded anchor. Collapsing them would misreport it.
    expect(isVagueAnchor("")).toBe(false);
    expect(isVagueAnchor(null)).toBe(false);
  });
});

describe("anchorFromHref", () => {
  it("reads the destination's own slug", () => {
    expect(anchorFromHref("/guides/answer-engines")).toBe("answer engines");
    expect(anchorFromHref("https://x.com/pricing/team-plan.html")).toBe("team plan");
  });

  it("returns nothing when the slug describes nothing", () => {
    // An id or a hash is not a description, and dressing one up as anchor text
    // would be worse than the "click here" it replaced.
    expect(anchorFromHref("/")).toBe("");
    expect(anchorFromHref("/posts/48122")).toBe("");
    expect(anchorFromHref("/p/9f3a2b7c1d4e")).toBe("");
    expect(anchorFromHref("not a url at all")).toBe("");
  });

  it("decodes a percent-encoded slug, so it works outside English", () => {
    // Found by the test above: `new URL()` silently percent-encodes rather than
    // rejecting, so without decoding every accented slug became mojibake.
    expect(anchorFromHref("/guias/optimizaci%C3%B3n")).toBe("optimizaci\u00f3n");
    expect(anchorFromHref("/a/team%20page")).toBe("team page");
  });
});

describe("internalLinkPlan", () => {
  const links = {
    internal: [
      { href: "/pricing/team-plan", text: "click here", host: "x.com" },
      { href: "/guides/answer-engines", text: "Read more", host: "x.com" },
      { href: "/security", text: "our security posture", host: "x.com" },
      { href: "/careers", text: "", host: "x.com" },
    ],
    external: [{ href: "https://y.com", text: "y", host: "y.com" }],
  };

  it("lists every vague anchor with a suggestion from the target's slug", () => {
    const c = internalLinkPlan({ links, url: "https://x.com/a" });
    expect(c.vagueCount).toBe(2);
    expect(c.body).toContain("team plan");
    expect(c.body).toContain("answer engines");
  });

  it("leaves the descriptive anchor out of the rewrite table", () => {
    expect(internalLinkPlan({ links }).body).not.toContain("our security posture");
  });

  it("reports an empty anchor separately, as its own defect", () => {
    const c = internalLinkPlan({ links });
    expect(c.emptyCount).toBe(1);
    expect(c.body).toMatch(/no text at all/);
    expect(c.body).toContain("/careers");
  });

  it("🔴 never proposes a url to link to", () => {
    // The audit reads ONE page and cannot enumerate the site, so any suggested
    // target would be a guess pasted into live markup. Every url in the output
    // must be one the page already links to.
    const c = internalLinkPlan({ links, url: "https://x.com/a" });
    const urls = c.body.match(/\/[a-z-]+(?:\/[a-z-]+)*/g) || [];
    const known = ["/pricing/team-plan", "/guides/answer-engines", "/security", "/careers"];
    for (const u of urls) {
      if (u.length < 4) continue;
      expect(known.some((k) => k.startsWith(u) || u.startsWith(k)), u).toBe(true);
    }
  });

  it("says so plainly when a page has no internal links", () => {
    const c = internalLinkPlan({ links: { internal: [], external: [] }, url: "https://x.com/a" });
    expect(c.internalCount).toBe(0);
    expect(c.body).toContain("no internal links");
    expect(hasPlaceholders(c)).toBe(true);
  });

  it("reports a clean page as clean rather than inventing work", () => {
    const clean = { internal: [{ href: "/security", text: "our security posture" }], external: [] };
    const c = internalLinkPlan({ links: clean, url: "https://x.com/a" });
    expect(c.vagueCount).toBe(0);
    expect(c.body).toContain("No anchor-text problems found");
    expect(hasPlaceholders(c)).toBe(false);
  });
});


// ── W5.3 · content briefs ───────────────────────────────────────────────────

describe("contentBrief", () => {
  it("briefs the kind it was asked for", () => {
    expect(contentBrief({ kind: "comparison" }).kind).toBe("comparison");
    expect(contentBrief({ kind: "industry" }).label).toMatch(/Industry/);
  });

  it("falls back to a real brief for an unknown kind, never nothing", () => {
    // A stored audit from a newer build must lose precision, not its asset.
    expect(contentBrief({ kind: "invented" }).kind).toBe("category");
    expect(contentBrief({}).body).toBeTruthy();
  });

  it("names the operator's OWN declared competitors in a comparison", () => {
    const c = contentBrief({ kind: "comparison", brand: "DatIQ", competitorUrls: ["https://www.clay.com/x"] });
    expect(c.body).toContain("DatIQ vs clay.com");
    expect(c.body).not.toContain("TODO: the competitor");
  });

  it("🔴 leaves the rival as a TODO when none was declared", () => {
    // Inventing "Acme vs Initech" would put two companies into a brief on no
    // evidence whatsoever.
    const c = contentBrief({ kind: "comparison", brand: "DatIQ" });
    expect(c.body).toContain("TODO:");
    expect(hasPlaceholders(c)).toBe(true);
  });

  it("tells a comparison writer to name where the rival wins", () => {
    expect(contentBrief({ kind: "comparison" }).body).toMatch(/alternative genuinely wins/i);
  });
});

// ── W5.4 · technical remediation ────────────────────────────────────────────

describe("technicalBrief", () => {
  const issues = [
    { code: "TA-03", title: "Page is noindex", fix: "Remove the noindex.", isBlocker: true },
    { code: "AC-01", title: "No answer block", fix: "Add one.", blockedBy: "TA-03" },
    { code: "TA-09", title: "Slow LCP", fix: "Compress the hero image." },
  ];

  it("puts blockers first and says what they unblock", () => {
    const c = technicalBrief({ issues, blockers: ["NOINDEX"], url: "https://x.com/a" });
    expect(c.blockerCount).toBe(1);
    expect(c.body.indexOf("TA-03")).toBeLessThan(c.body.indexOf("TA-09"));
    expect(c.body).toMatch(/Unblocks 1 further fix/);
  });

  it("says which fix is waiting, and on what", () => {
    expect(technicalBrief({ issues }).body).toMatch(/Waits on TA-03/);
  });

  it("says plainly when nothing blocks anything", () => {
    const c = technicalBrief({ issues: [{ code: "TA-09", title: "Slow LCP", fix: "Compress." }] });
    expect(c.blockerCount).toBe(0);
    expect(c.body).toContain("No blockers");
  });

  it("handles a page with no technical findings at all", () => {
    const c = technicalBrief({ issues: [], url: "https://x.com/a" });
    expect(c.findingCount).toBe(0);
    expect(c.body).toContain("No technical findings");
  });

  it("survives being called with nothing", () => {
    expect(technicalBrief().body).toBeTruthy();
  });
});
