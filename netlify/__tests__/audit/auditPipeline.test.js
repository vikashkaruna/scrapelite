import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock the network boundary, not the logic ───────────────────────────────
// The scrape chain, robots fetch, PageSpeed and the AI chain are all mocked so
// this suite exercises the REAL parsing, analysis, scoring and recommendation
// code against known HTML. Mocking any of those would make the test prove only
// that the mocks agree with each other.
//
// ⚠️ publicUrl.js is mocked deliberately, and the reason is written down in
// CLAUDE.md: an earlier extract suite hit real DNS, and because the robots
// loader FAILS OPEN on a network error, an unreachable host did not merely slow
// the test — it INVERTED it, turning a refusal under test into an allow.

const scrapeChain = vi.fn();
const robotsText = vi.fn();
const publicFetch = vi.fn();
const aiChain = vi.fn();

vi.mock("../../functions/lib/scrapeProviders.js", () => ({
  runScrapeChain: (...a) => scrapeChain(...a),
  runMapChain: vi.fn(),
}));
vi.mock("../../functions/lib/publicUrl.js", () => ({
  fetchPublicUrl: (...a) => publicFetch(...a),
  isPublicHttpUrl: () => true,
  isPublicHttpUrlAsync: async () => true,
}));
vi.mock("../../functions/lib/aiProviders.js", () => ({
  runChain: (...a) => aiChain(...a),
  loadAiConfig: vi.fn(),
  keyPresence: vi.fn(),
}));

const { runAudit, inferPageType } = await import("../../functions/lib/audit/auditPipeline.js");
const { _resetRobotsTextCacheForTests } = await import("../../functions/lib/complianceEngine.js");
// Imported, not hard-coded. These assertions exist to prove the stamp is
// PRESENT and CURRENT — a literal "v1" turns every future version bump into a
// spurious test failure and teaches the next person to edit the assertion
// rather than ask whether the bump was correct.
const { SCORING_MODEL_VERSION, PENALTIES } =
  await import("../../../src/lib/discoverability/scoringModel.js");
const { analyseTechnical } = await import("../../functions/lib/audit/technicalAnalysis.js");
const { ROOT_CAUSES, MODULES, groupByRootCause } =
  await import("../../../src/lib/discoverability/gapTaxonomy.js");
const { ISSUES } = await import("../../../src/lib/discoverability/issueCatalog.js");

const GOOD_PAGE = `<!doctype html><html lang="en"><head>
<title>What is generative engine optimization? | Example</title>
<meta name="description" content="A practical guide to generative engine optimization.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://example.com/geo">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization",
"name":"Example","url":"https://example.com","logo":"https://example.com/logo.png",
"sameAs":["https://www.linkedin.com/company/example","https://x.com/example"]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article",
"headline":"What is generative engine optimization?","author":{"@type":"Person","name":"Jane Doe","jobTitle":"Analyst"},
"datePublished":"2026-07-01","dateModified":"2026-08-01"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList",
"itemListElement":[{"@type":"ListItem","position":1,"name":"Home"},{"@type":"ListItem","position":2,"name":"Guides"}]}</script>
</head><body>
<h1>What is generative engine optimization?</h1>
<p>Generative engine optimization is the practice of structuring and enriching content so that AI answer systems can retrieve it, summarise it accurately, and cite the original publisher when responding to a question.</p>
<h2>How does GEO differ from SEO?</h2>
<p>GEO targets citation inside a generated answer rather than a click from a results page, so it rewards extractable structure and clear entity identity over keyword placement alone.</p>
<h2>Does GEO replace technical SEO?</h2>
<p>No. Crawlability and rendering remain prerequisites, because an answer engine cannot cite a page its crawler was never able to fetch in the first place.</p>
<ul><li>Answer-first passages</li><li>Clean heading trees</li><li>Entity markup</li></ul>
<p>By Jane Doe. <a rel="author" href="/authors/jane-doe">About the author</a></p>
<time datetime="2026-08-01">1 August 2026</time>
<a href="https://research.example.org/paper">Source</a><a href="https://standards.example.net/spec">Spec</a>
<a href="https://www.linkedin.com/company/example">LinkedIn</a>
</body></html>`;

const BROKEN_PAGE = `<html><head><meta name="robots" content="noindex"></head>
<body><div>It depends. As mentioned above, they vary.</div><h2>Alpha</h2><h4>Beta</h4><h3></h3>
<script type="application/ld+json">{ not json </script></body></html>`;

function htmlResponse(body, status = 200, url = "https://example.com/geo") {
  return {
    ok: status >= 200 && status < 300, status, url,
    text: async () => body,
    headers: { get: () => "text/html; charset=utf-8" },
  };
}

beforeEach(() => {
  _resetRobotsTextCacheForTests();
  vi.clearAllMocks();
  // No robots.txt at all — permissive, and distinct from an unreadable one.
  publicFetch.mockImplementation(async (url) => {
    if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
    return htmlResponse(GOOD_PAGE, 200, url);
  });
  scrapeChain.mockResolvedValue({ ok: true, source: "firecrawl", html: GOOD_PAGE });
  aiChain.mockResolvedValue({ ok: false, error: "no key" });
});
afterEach(() => { delete process.env.FIRECRAWL_API_KEY; });

const baseOpts = {
  env: {}, now: Date.parse("2026-08-26T00:00:00Z"),
  skipWebVitals: true, skipCitations: true, skipAi: true,
};

describe("runAudit — a healthy page", () => {
  it("completes and scores every framework", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.status).toBe("completed");
    expect(r.unreachable).toBe(false);
    for (const f of ["finalScore", "seoScore", "aeoScore", "geoScore"]) {
      expect(r[f], f).toBeGreaterThan(0);
      expect(r[f], f).toBeLessThanOrEqual(100);
    }
  });

  it("scores a well-built page well", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.finalScore).toBeGreaterThan(60);
    expect(r.aeoScore).toBeGreaterThan(60);
  });

  it("reports the evidence behind every pillar", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    for (const p of ["answer_clarity", "entity_authority", "structural_hierarchy", "technical_accessibility"]) {
      expect(r.pillars[p], p).toBeDefined();
      expect(r.pillars[p].signals.length, p).toBe(5);
    }
    expect(r.evidence.heading_outline.length).toBeGreaterThan(0);
    expect(r.evidence.schema_types).toContain("Organization");
    expect(r.evidence.direct_answer_blocks.length).toBe(1);
  });

  it("finds the answer-first passage under the H1", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const block = r.evidence.direct_answer_blocks[0];
    expect(block.anchor_heading).toMatch(/generative engine optimization/i);
    expect(block.position_percent).toBeLessThan(30);
    expect(block.word_count).toBeGreaterThan(20);
  });

  it("classifies the page type and records it", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.target.page_type).toBe("article");
    expect(r.target.page_type_label).toBe("Article");
  });
});

describe("runAudit — a broken page", () => {
  beforeEach(() => {
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("User-agent: *\nDisallow: /\n", 200, url);
      return htmlResponse(BROKEN_PAGE, 200, url);
    });
    scrapeChain.mockResolvedValue({ ok: true, source: "direct", html: BROKEN_PAGE });
  });

  it("scores far lower than a healthy one", async () => {
    const bad = await runAudit("https://example.com/bad", baseOpts);
    expect(bad.finalScore).toBeLessThan(40);
  });

  it("raises the blocking findings and applies their penalties", async () => {
    const r = await runAudit("https://example.com/bad", baseOpts);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("TA-03");   // noindex
    expect(codes).toContain("TA-01");   // every AI crawler disallowed
    expect(codes).toContain("SH-01");   // no H1
    expect(codes).toContain("TA-13");   // JSON-LD does not parse
    const penalties = r.penalties.map((p) => p.code);
    expect(penalties).toContain("NOINDEX");
    expect(penalties).toContain("AI_CRAWLER_BLOCKED");
    expect(r.penaltyMultiplier).toBeLessThan(1);
  });

  it("shows the arithmetic rather than just the verdict", async () => {
    const r = await runAudit("https://example.com/bad", baseOpts);
    expect(r.scoreMath.prePenaltyTotal).toBeGreaterThan(r.scoreMath.finalScore);
    expect(r.scoreMath.penaltyMultiplier).toBe(r.penaltyMultiplier);
  });

  it("puts the cheapest blocking fix at the top of the queue", async () => {
    const r = await runAudit("https://example.com/bad", baseOpts);
    expect(["TA-03", "TA-01"]).toContain(r.recommendations[0].code);
    expect(r.recommendations[0].priority).toBe("high");
  });

  it("attaches a ready-made construct to the fixes that have one", async () => {
    const r = await runAudit("https://example.com/bad", baseOpts);
    const withAssets = r.recommendations.filter((x) => x.implementationAsset);
    expect(withAssets.length).toBeGreaterThan(0);
    for (const rec of withAssets) {
      expect(rec.implementationAsset.body).toBeTruthy();
      expect(rec.implementationAsset.assetType).toBe(rec.assetType);
    }
  });
});

describe("degradation — the whole reason the scorer distinguishes null from 0", () => {
  it("marks Core Web Vitals unmeasured when PageSpeed is skipped, and does not score it 0", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const cwv = r.pillars.technical_accessibility.signals.find((s) => s.code === "core_web_vitals");
    expect(cwv.score).toBeNull();
    expect(cwv.measured).toBe(false);
    expect(cwv.unknownReason).toBe("not_measured");
    // The pillar still has a score, built from the four signals that WERE read.
    expect(r.pillars.technical_accessibility.score).toBeGreaterThan(0);
  });

  it("reports honest coverage instead of overselling a thin audit", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.coverage).toBeLessThan(100);
    expect(r.coverage).toBeGreaterThan(60);
  });

  it("marks citation footprint unmeasured when no sampling engine is configured", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const cf = r.pillars.entity_authority.signals.find((s) => s.code === "citation_footprint");
    expect(cf.score).toBeNull();
    // An unsampled brand is UNKNOWN, never uncited — so no EA-08 accusation.
    expect(r.issues.map((i) => i.code)).not.toContain("EA-08");
  });

  it("reports render completeness unmeasured when no headless provider exists", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    // Without a headless provider the two fetches return identical HTML, so
    // comparing them is a tautology. Claiming a perfect 100 would invert the truth.
    expect(r.facts.technical.rendering.rendered_dom_word_count).toBeNull();
    const rc = r.pillars.technical_accessibility.signals.find((s) => s.code === "render_completeness");
    expect(rc.score).toBeNull();
  });

  it("survives an unreachable page and still returns the technical facts", async () => {
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      throw new Error("ECONNREFUSED");
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "all providers failed" });
    const r = await runAudit("https://gone.example.com/x", baseOpts);
    expect(r.status).toBe("completed");        // completed, reporting a dead page
    expect(r.unreachable).toBe(true);
    expect(r.issues.map((i) => i.code)).toContain("TA-04");
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.stageErrors[0].stage).toBe("audit.fetch");
  });

  it("survives the scrape chain throwing outright", async () => {
    scrapeChain.mockRejectedValue(new Error("provider exploded"));
    const r = await runAudit("https://example.com/geo", baseOpts);
    // The raw fetch still succeeded, so the audit completes on that HTML alone.
    expect(r.status).toBe("completed");
    expect(r.unreachable).toBe(false);
    expect(r.finalScore).toBeGreaterThan(0);
  });
});

// ── The bug a real run found, and mocks never would ────────────────────────
describe("a markdown fragment must never displace a real document", () => {
  // The scrape chain's later providers do not return the page's HTML. Jina AI
  // returns MARKDOWN, which scrapeProviders.js converts to a shell of headings
  // and links — no <head>, so no meta tags, no canonical, no JSON-LD.
  //
  // Parsing that as if it were the page made the engine confidently report "no
  // viewport meta tag" — and apply the mobile-parity penalty — to a page whose
  // very first meta tag is a viewport. A whole pillar of phantom findings,
  // delivered with total confidence, which is the worst failure an audit tool
  // can have because a user cannot tell it apart from a real one.
  const JINA_FRAGMENT = `<h1>Example Domain</h1> <p>This domain is for use in documentation.</p> <a href="https://iana.org/domains/example">Learn more</a>`;
  const REAL_DOC = `<!doctype html><html lang="en"><head>
    <title>Example Domain</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="https://example.com/">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Example","url":"https://example.com","logo":"https://example.com/l.png","sameAs":["https://x.com/example"]}</script>
    </head><body><h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents, and you may use it without asking for permission.</p>
    </body></html>`;

  beforeEach(() => {
    publicFetch.mockImplementation(async (url) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("", 404, url) : htmlResponse(REAL_DOC, 200, url));
    // The chain fell through to a markdown provider.
    scrapeChain.mockResolvedValue({ ok: true, source: "jina", html: JINA_FRAGMENT });
  });

  it("parses the raw document, not the fragment", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.facts.technical.viewport).toBe("width=device-width, initial-scale=1");
    expect(r.facts.technical.canonical_url).toBe("https://example.com/");
    expect(r.evidence.schema_types).toContain("Organization");
  });

  it("raises no phantom viewport finding and applies no mobile penalty", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("TA-12");
    expect(r.penalties.map((p) => p.code)).not.toContain("MOBILE_PARITY_MISSING");
  });

  it("does not read a lossy conversion as a hydration gap", async () => {
    // The fragment has far fewer words than the document. That is a CONVERSION
    // loss, not content hiding behind JavaScript, and reporting it as TA-07
    // would tell the author to server-render a page that already is.
    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("TA-07");
    expect(r.facts.technical.rendering.rendered_dom_word_count).toBeNull();
  });

  it("still prefers the rendered DOM when it IS a real document", async () => {
    // A real headless provider returns a full document with post-JS content.
    // That must still win — the fix must not throw away rendering.
    const RENDERED = REAL_DOC.replace("</body>",
      "<h2>Loaded after hydration</h2><p>Content that only exists once JavaScript has run on this page.</p></body>");
    scrapeChain.mockResolvedValue({ ok: true, source: "firecrawl", html: RENDERED });
    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.evidence.heading_outline.map((h) => h.text)).toContain("Loaded after hydration");
  });

  it("reports head signals as unmeasured when BOTH sides are fragments", async () => {
    // Neither source is a document, so the absence of a viewport is OUR blind
    // spot, not the page's defect. Unmeasured, not a finding — the same rule
    // the rest of the engine follows.
    publicFetch.mockImplementation(async (url) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("", 404, url) : htmlResponse(JINA_FRAGMENT, 200, url));
    scrapeChain.mockResolvedValue({ ok: true, source: "jina", html: JINA_FRAGMENT });

    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("TA-12");
    expect(r.issues.map((i) => i.code)).not.toContain("TA-06");
    const mobile = r.pillars.technical_accessibility.signals.find((s) => s.code === "mobile_parity");
    expect(mobile.score).toBeNull();
    expect(mobile.unknownReason).toBe("not_measured");
    // …and the thinner evidence shows up honestly as reduced coverage.
    expect(r.coverage).toBeLessThan(70);
  });
});

describe("a JavaScript shell is named as one", () => {
  // A single-page app serves a real, well-formed document containing a mount
  // point and a script tag. To a non-rendering crawler it has no headings, no
  // answer passage and no structure — a real and important finding.
  //
  // But without this the content analysers each report their own half of it:
  // "no H1", "no answer passage", "no headings". An author whose H1 is plainly
  // visible in their browser reads that and concludes the tool is broken. The
  // accurate sentence is that half their audience cannot see any of it.
  const SHELL = `<!doctype html><html lang="en"><head>
    <title>DatIQ</title><meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="https://example.com/">
    </head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`;

  beforeEach(() => {
    publicFetch.mockImplementation(async (url) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("", 404, url) : htmlResponse(SHELL, 200, url));
    scrapeChain.mockResolvedValue({ ok: true, source: "direct", html: SHELL });
  });

  it("raises TA-07 as the finding, even with no rendered comparison", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.issues.map((i) => i.code)).toContain("TA-07");
    expect(r.facts.technical.rendering.js_shell).toBe(true);
    expect(r.penalties.map((p) => p.code)).toContain("CONTENT_HYDRATION_ONLY");
  });

  it("ranks it above the content fixes it gates, and marks them blocked", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    const order = r.recommendations.map((x) => x.code);

    // NOT asserted: that TA-07 is globally #1. Adding Organization JSON-LD is
    // cheap, certain, and genuinely works on a shell page — schema lives in the
    // <head>, which a non-rendering crawler DOES read. It legitimately comes
    // first; a team can do it this afternoon while re-platforming takes a sprint.
    //
    // What IS asserted is the dependency: a content fix that only renders in
    // JavaScript cannot pay off until the page renders without it.
    for (const gated of ["AC-01", "SH-10"]) {
      if (!order.includes(gated)) continue;
      expect(order.indexOf("TA-07"), `${gated} must not precede TA-07`)
        .toBeLessThan(order.indexOf(gated));
      const rec = r.recommendations.find((x) => x.code === gated);
      expect(rec.blockedBy).toBe("TA-07");
    }
  });

  it("separates the lift available now from the lift waiting on the blocker", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    // Presenting only the total on a blocked page promises work that cannot
    // pay off yet.
    expect(r.estimatedUnblockedLift).toBeLessThan(r.estimatedTotalLift);
    expect(r.estimatedUnblockedLift).toBeGreaterThan(0);
  });

  it("explains that the content scores reflect the un-rendered view", async () => {
    const r = await runAudit("https://example.com/", baseOpts);
    const ta07 = r.issues.find((i) => i.code === "TA-07");
    expect(ta07.evidence).toMatch(/rendered by JavaScript/i);
    expect(ta07.evidence).toMatch(/content scores in this audit reflect that view/i);
  });

  it("does not mistake a genuinely short page for a shell", async () => {
    const SHORT = `<!doctype html><html lang="en"><head><title>Hi</title>
      <meta name="viewport" content="width=device-width"></head><body>
      <h1>A short page</h1>
      <p>This page is deliberately brief but it is entirely present in the served HTML, with no client-side rendering involved at any point whatsoever.</p>
      </body></html>`;
    publicFetch.mockImplementation(async (url) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("", 404, url) : htmlResponse(SHORT, 200, url));
    scrapeChain.mockResolvedValue({ ok: true, source: "direct", html: SHORT });

    const r = await runAudit("https://example.com/", baseOpts);
    expect(r.facts.technical.rendering.js_shell).toBe(false);
    expect(r.issues.map((i) => i.code)).not.toContain("TA-07");
    expect(r.penalties.map((p) => p.code)).not.toContain("CONTENT_HYDRATION_ONLY");
  });
});

describe("page-type rule packs", () => {
  it("does not tell a pricing page to add HowTo markup", async () => {
    const pricing = `<html lang="en"><head><title>Pricing | Example</title>
      <meta name="viewport" content="width=device-width"></head><body>
      <h1>Pricing</h1><p>Every plan includes the full extraction engine, unlimited exports and the audit module, billed monthly with no contract and no setup fee.</p>
      <ul><li>Free</li><li>Pro</li><li>Business</li></ul></body></html>`;
    publicFetch.mockImplementation(async (url) =>
      String(url).endsWith("/robots.txt") ? htmlResponse("", 404, url) : htmlResponse(pricing, 200, url));
    scrapeChain.mockResolvedValue({ ok: true, source: "direct", html: pricing });

    const r = await runAudit("https://example.com/pricing", baseOpts);
    expect(r.target.page_type).toBe("pricing");
    const codes = r.issues.map((i) => i.code);
    expect(codes).not.toContain("SH-08");   // no procedure to describe
    expect(codes).not.toContain("EA-04");   // a pricing page needs no byline
    // …and the HowTo signal is not-applicable rather than scored 25.
    const howto = r.pillars.structural_hierarchy.signals.find((s) => s.code === "howto_schema_alignment");
    expect(howto.score).toBeNull();
    expect(howto.applicable).toBe(false);
  });

  it("honours an explicit page-type hint over inference", async () => {
    const r = await runAudit("https://example.com/geo", { ...baseOpts, pageTypeHint: "docs" });
    expect(r.target.page_type).toBe("docs");
  });
});

describe("audit profiles are a lens, never different maths", () => {
  it("changes only which score leads the report", async () => {
    const balanced = await runAudit("https://example.com/geo", { ...baseOpts, auditProfile: "balanced" });
    const geo = await runAudit("https://example.com/geo", { ...baseOpts, auditProfile: "geo" });

    // Same page, same evidence — every framework number must be identical.
    expect(geo.finalScore).toBe(balanced.finalScore);
    expect(geo.seoScore).toBe(balanced.seoScore);
    expect(geo.geoScore).toBe(balanced.geoScore);
    // Only the headline differs.
    expect(balanced.headlineFramework).toBe("overall");
    expect(geo.headlineFramework).toBe("geo");
    expect(geo.headlineScore).toBe(geo.geoScore);
  });
});

describe("inferPageType", () => {
  it("prefers explicit schema over guesswork", () => {
    expect(inferPageType({ schemaTypes: ["FAQPage"] })).toBe("faq");
    expect(inferPageType({ schemaTypes: ["HowTo"] })).toBe("howto");
    expect(inferPageType({ schemaTypes: ["Product"] })).toBe("product");
  });
  it("falls back to the title and heading", () => {
    expect(inferPageType({ schemaTypes: [], headingStats: { h1Text: "Pricing plans" }, meta: {} })).toBe("pricing");
    expect(inferPageType({ schemaTypes: [], headingStats: { h1Text: "How to reset" }, meta: {} })).toBe("howto");
  });
  it("degrades to a generic page rather than guessing wildly", () => {
    expect(inferPageType({ schemaTypes: [], headingStats: {}, meta: {}, wordCount: 40 })).toBe("page");
  });

  // ── W2: the four templates the BRD names that had no pack ───────────────
  it("reads a LocalBusiness subtype as a location page", () => {
    // Matched by suffix rather than by enumerating the ~200 subtypes
    // schema.org defines, which is a list that would be stale on arrival.
    expect(inferPageType({ schemaTypes: ["Dentist"] })).toBe("location");
    expect(inferPageType({ schemaTypes: ["LocalBusiness"] })).toBe("location");
    expect(inferPageType({ schemaTypes: ["Place"] })).toBe("location");
  });

  it("reads Service schema as a service page", () => {
    expect(inferPageType({ schemaTypes: ["Service"] })).toBe("service");
  });

  it("reads the root path as a homepage", () => {
    expect(inferPageType({ url: "https://example.com/", schemaTypes: [], headingStats: {}, meta: {} }))
      .toBe("homepage");
    expect(inferPageType({ url: "https://example.com", schemaTypes: [], headingStats: {}, meta: {} }))
      .toBe("homepage");
  });

  it("does not treat a missing or unparseable URL as evidence of a homepage", () => {
    // The guard that keeps every other test in this file — none of which pass
    // a URL — from suddenly resolving to "homepage".
    expect(inferPageType({ schemaTypes: [], headingStats: {}, meta: {}, wordCount: 40 })).toBe("page");
    expect(inferPageType({ url: "not a url", schemaTypes: [], headingStats: {}, meta: {}, wordCount: 40 })).toBe("page");
  });

  it("still prefers what a page declares over where it sits", () => {
    expect(inferPageType({ url: "https://example.com/", schemaTypes: ["Product"] })).toBe("product");
  });

  it("reads a comparison as a comparison, even when it discusses price", () => {
    // ⚠️ A DELIBERATE BEHAVIOUR CHANGE. "Acme vs Rival pricing" used to be
    // filed as a pricing page, whose pack says nothing about AC-08 —
    // comparative content written as prose — which is that page's defining
    // failure mode.
    expect(inferPageType({ schemaTypes: [], headingStats: { h1Text: "Acme vs Rival pricing" }, meta: {} }))
      .toBe("comparison");
    expect(inferPageType({ schemaTypes: [], headingStats: { h1Text: "Best Acme alternatives" }, meta: {} }))
      .toBe("comparison");
  });

  it("lets a how-to beat a stray price word", () => {
    // Also a deliberate change: "how to" used to sit behind the pricing test,
    // so this page was asked for Offer markup it has no business carrying.
    expect(inferPageType({ schemaTypes: [], headingStats: { h1Text: "How to reduce hosting cost" }, meta: {} }))
      .toBe("howto");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W2 — GOAL-BASED INTAKE
// ═══════════════════════════════════════════════════════════════════════════
// The audit row could not say what kind of audit it was, what the customer was
// trying to achieve, or where they wanted to be found — and the profile was
// whatever the caller sent, with no record of whether anyone had chosen it.

describe("the intake travels with the result", () => {
  it("echoes what was asked for, normalised", async () => {
    const r = await runAudit("https://example.com/geo", {
      ...baseOpts,
      primaryGoal: "local_discovery",
      targetGeography: { country: "in", city: "Bengaluru", language: "en-in" },
      competitorUrls: ["competitor.com", "competitor.com"],
    });
    expect(r.intake.primary_goal).toBe("local_discovery");
    expect(r.intake.target_geography).toEqual({
      country: "IN", region: null, city: "Bengaluru", language: "en-IN",
    });
    // Deduplicated on the way in, so a competitor named twice is one competitor.
    expect(r.intake.competitor_urls).toEqual(["https://competitor.com/"]);
    expect(r.intake.audit_type).toBe("url");
  });

  it("records NULL for a goal nobody stated rather than inventing one", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.intake.primary_goal).toBeNull();
    expect(r.intake.target_geography).toBeNull();
    expect(r.intake.competitor_urls).toEqual([]);
  });

  it("refuses a goal that is not in the vocabulary", async () => {
    // The CHECK constraint would reject it at the write; dropping it here
    // means the row is honest either way.
    const r = await runAudit("https://example.com/geo", { ...baseOpts, primaryGoal: "world_domination" });
    expect(r.intake.primary_goal).toBeNull();
  });

  it("carries the intake even when the page could not be fetched", async () => {
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return { ok: false, status: 500, url, text: async () => "", headers: { get: () => "text/html" } };
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "no html" });
    const r = await runAudit("https://example.com/geo", { ...baseOpts, primaryGoal: "seo_health" });
    expect(r.unreachable).toBe(true);
    // An unreachable page is still a commissioned audit, and what it was
    // commissioned to do is the part the customer can still act on.
    expect(r.intake.primary_goal).toBe("seo_health");
  });
});

describe("the profile is settled, and the result says by whom", () => {
  it("honours an explicit choice over everything the page says", async () => {
    const r = await runAudit("https://example.com/geo", { ...baseOpts, auditProfile: "seo" });
    expect(r.target.audit_profile).toBe("seo");
    expect(r.target.audit_profile_source).toBe("explicit");
    expect(r.headlineFramework).toBe("seo");
  });

  it("derives the profile from a stated goal", async () => {
    const r = await runAudit("https://example.com/geo", { ...baseOpts, primaryGoal: "local_discovery" });
    expect(r.target.audit_profile).toBe("local");
    expect(r.target.audit_profile_source).toBe("goal");
    // A business-model profile is still only a lens: it selects the headline
    // and nothing else.
    expect(r.headlineFramework).toBe("geo");
  });

  it("reads the page when nobody said anything", async () => {
    // GOOD_PAGE declares Organization + Article and argues for no lens, so the
    // honest answer is the neutral one — labelled as a default, not a reading.
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.target.audit_profile).toBe("balanced");
    expect(r.target.audit_profile_source).toBe("default");
  });

  it("infers a lens from what the page declares about itself", async () => {
    const productPage = GOOD_PAGE.replace('"@type":"Article"', '"@type":"Product"');
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return htmlResponse(productPage, 200, url);
    });
    scrapeChain.mockResolvedValue({ ok: true, source: "firecrawl", html: productPage });
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.target.audit_profile).toBe("ecommerce");
    expect(r.target.audit_profile_source).toBe("inferred");
  });

  it("reports a default, not an inference, for a page it never saw", async () => {
    // The whole reason the profile is settled twice: inference from a page
    // that returned nothing would be a fabrication.
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return { ok: false, status: 500, url, text: async () => "", headers: { get: () => "text/html" } };
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "no html" });
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.target.audit_profile_source).toBe("default");
  });

  it("changes no score when the lens changes", async () => {
    // The constraint the whole profile system rests on, asserted against the
    // four business-model profiles specifically.
    const balanced = await runAudit("https://example.com/geo", { ...baseOpts, auditProfile: "balanced" });
    for (const profile of ["saas", "services", "local", "ecommerce"]) {
      const r = await runAudit("https://example.com/geo", { ...baseOpts, auditProfile: profile });
      expect(r.finalScore, profile).toBe(balanced.finalScore);
      expect(r.seoScore, profile).toBe(balanced.seoScore);
      expect(r.aeoScore, profile).toBe(balanced.aeoScore);
      expect(r.geoScore, profile).toBe(balanced.geoScore);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE — the BRD's "every signal and issue must retain evidence"
// ═══════════════════════════════════════════════════════════════════════════
// Before this, `audit_signals.raw_value` and `.evidence_json` were columns
// declared in migration 0030 that NOTHING EVER WROTE, and an issue's only
// provenance was a sentence in a text column. A score nobody could trace back
// to an observation, on every row in the table.

describe("evidence travels with every score", () => {
  it("gives every measured signal at least one evidence record", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const measured = Object.values(r.pillars)
      .flatMap((p) => p.signals)
      .filter((s) => s.measured);
    expect(measured.length).toBeGreaterThan(0);
    for (const s of measured) {
      expect(s.evidence, `signal ${s.code} has no evidence`).toBeTruthy();
      expect(s.evidence.length, `signal ${s.code} has no evidence`).toBeGreaterThan(0);
    }
  });

  it("stamps every record with the audit's own clock, not a per-record read", async () => {
    // Two observations from the same run must share a timestamp. Reading the
    // clock per record makes a diff between two audits show sub-second jitter
    // as though it were change.
    const r = await runAudit("https://example.com/geo", baseOpts);
    const stamps = new Set(
      Object.values(r.pillars).flatMap((p) => p.signals).flatMap((s) => s.evidence)
        .map((e) => e.collected_at),
    );
    expect([...stamps]).toEqual([new Date(baseOpts.now).toISOString()]);
  });

  it("names the audited URL as the source, so a finding can be traced back", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const records = Object.values(r.pillars).flatMap((p) => p.signals).flatMap((s) => s.evidence);
    expect(records.length).toBeGreaterThan(0);
    for (const e of records) expect(e.source_url).toBe("https://example.com/geo");
  });

  it("carries the raw reading beside the normalised score", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const h1 = r.pillars.structural_hierarchy.signals.find((s) => s.code === "single_h1");
    expect(h1.rawValue).toEqual({ h1_count: 1 });
    // The score is the model's opinion of the reading; the reading is the fact.
    expect(typeof h1.score).toBe("number");
  });

  it("labels a model judgement as inference, not as something it read", async () => {
    aiChain.mockResolvedValue({
      ok: true, provider: "gemini",
      text: JSON.stringify({ passage_independence: 88, intent_alignment: 90, notes: "Stands alone." }),
    });
    const r = await runAudit("https://example.com/geo", {
      ...baseOpts, skipAi: false,
      // aiEvaluationEnabled() gates on a key being present, so an empty env
      // silently skips the model stage and the test would pass for the wrong
      // reason — an absent record rather than a correctly-labelled one.
      env: { GEMINI_API_KEY: "test-key" },
    });
    const sig = r.pillars.answer_clarity.signals.find((s) => s.code === "passage_independence");
    // TWO records, not one. The deterministic pre-screen is kept beside the
    // model's judgement rather than being relabelled as one — it is the only
    // independent check on a model that disagrees with the page.
    const prescreen = sig.evidence.find((e) => e.method === "derived");
    const model = sig.evidence.find((e) => e.method === "model_inference");
    expect(prescreen).toBeTruthy();
    expect(prescreen.observed).toBe(false);
    expect(model).toBeTruthy();
    expect(model.observed).toBe(false);
    expect(model.structured.deterministic_prescreen).toBe(prescreen.observed_value);
    expect(model.structured.provider).toBe("gemini");
  });

  it("attaches an issue's evidence from the signal it sits on", async () => {
    const r = await runAudit("https://example.com/broken", {
      ...baseOpts,
      // A page with real defects, so there are issues to carry evidence.
    });
    expect(r.issues.length).toBeGreaterThan(0);
    const withSignal = r.issues.filter((i) => (i.evidenceRecords || []).length > 0);
    expect(withSignal.length).toBeGreaterThan(0);
    for (const i of withSignal) {
      for (const e of i.evidenceRecords) {
        expect(e.source_url).toBeTruthy();
        expect(e.collected_at).toBeTruthy();
        expect(typeof e.confidence).toBe("number");
      }
    }
  });

  it("stamps the scoring model version on the result", async () => {
    // Without it, a diff cannot tell whether two scores came out of the same
    // maths — and a delta across two models is a number nobody earned.
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.scoringModelVersion).toBe(SCORING_MODEL_VERSION);
  });

  it("records no threshold for a signal that is a curve", async () => {
    // Most signals have no published cut-off. Inventing one so the column looks
    // populated would put a number in front of a customer the scorer never used.
    const r = await runAudit("https://example.com/geo", baseOpts);
    const tree = r.pillars.structural_hierarchy.signals.find((s) => s.code === "heading_tree_integrity");
    expect(tree.thresholds).toBeNull();
  });
});

describe("an unreachable page still has the shape of a result", () => {
  it("gives its signals the same evidence fields a reachable page's have", async () => {
    // A consumer reading `signal.evidence.length` must get 0, not a TypeError.
    // The shape of a result must not depend on whether the fetch succeeded.
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return htmlResponse("", 503, url);
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "unreachable" });

    const r = await runAudit("https://example.com/down", baseOpts);
    expect(r.unreachable).toBe(true);
    const all = Object.values(r.pillars).flatMap((p) => p.signals);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(Array.isArray(s.evidence), `signal ${s.code}`).toBe(true);
      expect(s.confidence).toBeNull();
      expect(s.thresholds).toBeNull();
    }
  });

  it("still declares which maths produced its (empty) scores", async () => {
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return htmlResponse("", 503, url);
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "unreachable" });
    const r = await runAudit("https://example.com/down", baseOpts);
    expect(r.scoringModelVersion).toBe(SCORING_MODEL_VERSION);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W3 — THE TWO PENALTY CONDITIONS THE SHIPPED SET HAD NO EQUIVALENT FOR
// ═══════════════════════════════════════════════════════════════════════════

describe("ENTITY_SCHEMA_INVALID — declared, and unresolvable", () => {
  const withSchema = (block) => `<!doctype html><html lang="en"><head>
<title>Example</title><meta name="viewport" content="width=device-width">
<script type="application/ld+json">${JSON.stringify(block)}</script>
</head><body><h1>Example</h1><p>${"word ".repeat(200)}</p></body></html>`;

  const serve = (html) => {
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return htmlResponse(html, 200, url);
    });
    scrapeChain.mockResolvedValue({ ok: true, source: "firecrawl", html });
  };

  it("fires when an Organization block never says which organization", () => {
    serve(withSchema({ "@context": "https://schema.org", "@type": "Organization", url: "https://example.com" }));
    return runAudit("https://example.com/x", baseOpts).then((r) => {
      expect(r.issues.map((i) => i.code)).toContain("EA-11");
      expect(r.penalties.map((p) => p.code)).toContain("ENTITY_SCHEMA_INVALID");
      expect(r.penaltyMultiplier).toBeLessThan(1);
    });
  });

  it("does NOT fire when the block names itself", async () => {
    serve(withSchema({
      "@context": "https://schema.org", "@type": "Organization",
      name: "Example", url: "https://example.com", logo: "https://example.com/l.png",
      sameAs: ["https://x.com/example"],
    }));
    const r = await runAudit("https://example.com/x", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("EA-11");
    expect(r.penalties.map((p) => p.code)).not.toContain("ENTITY_SCHEMA_INVALID");
  });

  it("does NOT fire on a page with no entity markup at all", async () => {
    // Absence is EA-01's territory. Firing both would report one absence twice,
    // and would put a multiplicative blocker on the commonest page on the web.
    const html = `<!doctype html><html lang="en"><head><title>Bare</title>
<meta name="viewport" content="width=device-width"></head>
<body><h1>Bare</h1><p>${"word ".repeat(200)}</p></body></html>`;
    serve(html);
    const r = await runAudit("https://example.com/x", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("EA-11");
    expect(r.penalties.map((p) => p.code)).not.toContain("ENTITY_SCHEMA_INVALID");
  });

  it("accepts a language-tagged name rather than calling it broken", async () => {
    // schema.org permits {"@value": "..."}; reading only for a bare string
    // would report a correctly-internationalised page as unresolvable.
    serve(withSchema({
      "@context": "https://schema.org", "@type": "Organization",
      name: { "@value": "Beispiel", "@language": "de" }, url: "https://example.com",
    }));
    const r = await runAudit("https://example.com/x", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("EA-11");
  });

  it("does NOT fire on the sitelinks-searchbox WebSite pattern", async () => {
    // url + potentialAction and no name is both extremely common and correct.
    // A penalty that cries wolf teaches its reader to dismiss the real ones.
    serve(withSchema({
      "@context": "https://schema.org", "@type": "WebSite",
      url: "https://example.com",
      potentialAction: { "@type": "SearchAction", target: "https://example.com/s?q={q}" },
    }));
    const r = await runAudit("https://example.com/x", baseOpts);
    expect(r.issues.map((i) => i.code)).not.toContain("EA-11");
  });
});

describe("SEVERE_CWV_FAILURE — severe, not merely failing", () => {
  // Tested at the ANALYSER seam, not through runAudit. The pipeline fetches
  // Core Web Vitals from PageSpeed and `baseOpts` skips that entirely, so a
  // `webVitals` key on the audit options is silently ignored — a test written
  // that way passes or fails for reasons unrelated to the rule it claims to
  // check. `analyseTechnical` is where the readings actually enter the model.
  const parsed = {
    meta: { title: "Example", viewport: "width=device-width", canonical: "https://example.com/x" },
    jsonLd: [], jsonLdErrors: [], schemaTypes: [], headings: [], links: [],
    structures: {}, wordCount: 400,
  };
  const analyse = (webVitals) => analyseTechnical(parsed, {
    url: "https://example.com/x",
    fetch: { status: 200, finalUrl: "https://example.com/x" },
    webVitals,
  });

  it("does NOT fire on one metric just past its poor threshold", () => {
    // "bad" is not "severe". A blocker that treats them alike takes 10% off a
    // large share of the ordinary web.
    const r = analyse({ lcp: 4.5, inp: 150, cls: 0.05, source: "crux" });
    expect(r.penalties).not.toContain("SEVERE_CWV_FAILURE");
    expect(r.issues.map((i) => i.code)).not.toContain("TA-17");
    // The ordinary failing-metric issue is still raised — this rule adds a
    // second, harsher claim, it does not replace the first.
    expect(r.issues.map((i) => i.code)).toContain("TA-09");
  });

  it("fires when two metrics are past their poor thresholds", () => {
    const r = analyse({ lcp: 4.5, inp: 600, cls: 0.05, source: "crux" });
    expect(r.penalties).toContain("SEVERE_CWV_FAILURE");
    const issue = r.issues.find((i) => i.code === "TA-17");
    expect(issue.details.poor.sort()).toEqual(["inp", "lcp"]);
    expect(issue.evidence).toMatch(/Two or more metrics/);
  });

  it("fires on a single catastrophic metric, which thin CrUX data would hide", () => {
    // Low-traffic URLs frequently return only LCP. Without the 2x clause a
    // 12-second page escapes entirely.
    const r = analyse({ lcp: 12, source: "crux" });
    expect(r.penalties).toContain("SEVERE_CWV_FAILURE");
    expect(r.issues.find((i) => i.code === "TA-17").details.catastrophic).toEqual(["lcp"]);
  });

  it("holds the 2x line exactly, rather than firing just under it", () => {
    // poor for LCP is 4.0s, so 8.0 qualifies and 7.9 does not.
    expect(analyse({ lcp: 7.9, source: "crux" }).penalties).not.toContain("SEVERE_CWV_FAILURE");
    expect(analyse({ lcp: 8.0, source: "crux" }).penalties).toContain("SEVERE_CWV_FAILURE");
  });

  it("does not fire when Core Web Vitals were not measured at all", () => {
    // `unknown` is never `0`, and it is never a blocker either.
    const r = analyse(null);
    expect(r.penalties).not.toContain("SEVERE_CWV_FAILURE");
    expect(r.reasons.core_web_vitals).toBe("not_measured");
  });

  it("costs exactly 10% — the PRD's own weight", () => {
    expect(PENALTIES.SEVERE_CWV_FAILURE.factor).toBe(0.10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W4 — GAP ANALYSIS v2
// ═══════════════════════════════════════════════════════════════════════════
// The BRD specifies eleven fields on every issue and the record carried six.

describe("every finding carries a diagnosis, a referral and an owner", () => {
  it("gives each issue a root cause, module, owner and status", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.issues.length).toBeGreaterThan(0);
    for (const issue of r.issues) {
      expect(ROOT_CAUSES[issue.rootCause], issue.code).toBeTruthy();
      expect(MODULES[issue.module], issue.code).toBeTruthy();
      expect(issue.owner, issue.code).toBeTruthy();
      expect(issue.status, issue.code).toBe("open");
    }
  });

  it("states the observed fact and the inference as two different sentences", async () => {
    // One column launders the weaker claim into the stronger: "the page has two
    // H1 elements" is measured and defensible; "this dilutes the topical
    // signal" is reasoned and arguable.
    const r = await runAudit("https://example.com/geo", baseOpts);
    const issue = r.issues.find((i) => i.observed && i.inference);
    expect(issue).toBeTruthy();
    expect(issue.observed).not.toBe(issue.inference);
    // The inference is per-CODE and comes from the catalogue; the observation
    // is per-AUDIT. That asymmetry is the point.
    expect(issue.inference).toBe(ISSUES[issue.code].why);
  });

  it("keeps `evidence` as the sentence it has always been", async () => {
    // Every export prints it and every historical diff compares it. `observed`
    // sits beside it rather than replacing it.
    const r = await runAudit("https://example.com/geo", baseOpts);
    for (const issue of r.issues) {
      if (issue.evidence) expect(issue.observed).toBe(issue.evidence);
    }
  });

  it("carries the same fields on an unreachable page", async () => {
    // The SHAPE of a result must not depend on whether the fetch succeeded —
    // and this is the audit where the cause is least ambiguous of all.
    publicFetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/robots.txt")) return htmlResponse("", 404, url);
      return { ok: false, status: 500, url, text: async () => "", headers: { get: () => "text/html" } };
    });
    scrapeChain.mockResolvedValue({ ok: false, error: "no html" });
    const r = await runAudit("https://example.com/down", baseOpts);
    expect(r.unreachable).toBe(true);
    const [issue] = r.issues;
    expect(issue.rootCause).toBe("technical_access");
    expect(MODULES[issue.module]).toBeTruthy();
    expect(issue.status).toBe("open");
  });

  it("groups a real audit's findings into a diagnosis", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    const groups = groupByRootCause(r.issues, {
      severityRank: (i) => ["critical", "high", "medium", "low"].indexOf(i.severity),
    });
    expect(groups.length).toBeGreaterThan(0);
    // Fewer buckets than findings, or the grouping has bought nothing.
    expect(groups.length).toBeLessThanOrEqual(r.issues.length);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(r.issues.length);
  });
});


const CONTENT_GAP_CODES = ["AC-09", "AC-10", "AC-11", "AC-12"];

// ── W5.3 · content coverage ────────────────────────────────────────────────
// The pure gating logic is covered in contentCoverage.test.js. These prove the
// PIPELINE honours it, which is the join where the mistake would actually ship.

describe("content coverage — an unread sitemap raises nothing", () => {
  const xml = (body, status = 200, url = "https://example.com/sitemap.xml") => ({
    ok: status >= 200 && status < 300, status, url,
    headers: { get: () => "application/xml" },
    text: async () => body,
  });
  const declaresSitemap = "Sitemap: https://example.com/sitemap.xml\n";
  const cgCodes = (r) => (r.issues || []).map((i) => i.code).filter((c) => CONTENT_GAP_CODES.includes(c));

  it("🔴 raises no content gap when the sitemap 404s", async () => {
    // The costly mistake: reporting "you publish no comparison page" because
    // OUR fetch failed. An absence we could not verify is not a finding.
    publicFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return htmlResponse(declaresSitemap, 200, u);
      if (u.endsWith("/sitemap.xml")) return xml("", 404, u);
      return htmlResponse(GOOD_PAGE, 200, u);
    });
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.status).toBe("completed");
    expect(cgCodes(r)).toEqual([]);
  });

  it("raises no content gap when robots.txt declares no sitemap", async () => {
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(cgCodes(r)).toEqual([]);
  });

  it("raises no content gap when the sitemap fetch throws", async () => {
    publicFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return htmlResponse(declaresSitemap, 200, u);
      if (u.endsWith("/sitemap.xml")) throw new Error("network down");
      return htmlResponse(GOOD_PAGE, 200, u);
    });
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect(r.status).toBe("completed");
    expect(cgCodes(r)).toEqual([]);
  });
});

describe("content coverage — a sitemap we did read", () => {
  const xml = (body, status = 200, url = "https://example.com/sitemap.xml") => ({
    ok: status >= 200 && status < 300, status, url,
    headers: { get: () => "application/xml" },
    text: async () => body,
  });
  const declaresSitemap = "Sitemap: https://example.com/sitemap.xml\n";
  const urlset = (locs) =>
    `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

  const withSitemap = (locs) => {
    publicFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return htmlResponse(declaresSitemap, 200, u);
      if (u.endsWith("/sitemap.xml")) return xml(urlset(locs), 200, u);
      return htmlResponse(GOOD_PAGE, 200, u);
    });
  };

  it("names the kinds that matched nothing", async () => {
    withSitemap(["https://example.com/", "https://example.com/pricing"]);
    const r = await runAudit("https://example.com/geo", baseOpts);
    const codes = (r.issues || []).map((i) => i.code);
    expect(codes).toContain("AC-09");   // no comparison page matched
    expect(codes).toContain("AC-12");   // no category page matched
  });

  it("does not flag a kind the site clearly publishes", async () => {
    withSitemap([
      "https://example.com/vs/clay", "https://example.com/use-cases/sales",
      "https://example.com/industries/legal", "https://example.com/category/tools",
    ]);
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect((r.issues || []).map((i) => i.code).filter((c) => CONTENT_GAP_CODES.includes(c))).toEqual([]);
  });

  it("attaches a brief of the RIGHT kind to each gap", async () => {
    // Four issues share one asset type, so the per-recommendation facts
    // function is what keeps them from all briefing the same page.
    withSitemap(["https://example.com/", "https://example.com/pricing"]);
    const r = await runAudit("https://example.com/geo", baseOpts);
    const rec = (r.recommendations || []).find((x) => x.code === "AC-09");
    expect(rec).toBeTruthy();
    expect(rec.implementationAsset?.kind).toBe("comparison");
    expect(rec.implementationAsset?.body).toMatch(/Comparison page brief/);
  });

  it("states what we matched, not what the site has", async () => {
    withSitemap(["https://example.com/", "https://example.com/pricing"]);
    const r = await runAudit("https://example.com/geo", baseOpts);
    const issue = (r.issues || []).find((i) => i.code === "AC-09");
    expect(issue.observed).toMatch(/None of the 2 urls/);
    expect(issue.observed).not.toMatch(/your site has no/i);
  });
});


// ── W5.4 · technical sequencing ─────────────────────────────────────────────

describe("TA-18 fires only where the order actually matters", () => {
  it("stays quiet on a healthy page with no blockers", async () => {
    // Every technical finding already carries its own recommendation, so a
    // consolidated brief on any page with two findings would be queue noise.
    const r = await runAudit("https://example.com/geo", baseOpts);
    expect((r.issues || []).map((i) => i.code)).not.toContain("TA-18");
  });

  it("raises a brief when a live blocker gates other work", async () => {
    const noindex = GOOD_PAGE.replace("<head>", '<head><meta name="robots" content="noindex">');
    scrapeChain.mockResolvedValue({ ok: true, source: "firecrawl", html: noindex });
    publicFetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.endsWith("/robots.txt")) return htmlResponse("", 404, u);
      return htmlResponse(noindex, 200, u);
    });
    const r = await runAudit("https://example.com/geo", baseOpts);
    const rec = (r.recommendations || []).find((x) => x.code === "TA-18");
    expect(rec, "TA-18 should be raised on a noindex page").toBeTruthy();
    expect(rec.implementationAsset?.body).toMatch(/Do these first/);
    expect(rec.implementationAsset?.blockerCount).toBeGreaterThan(0);
  });
});
