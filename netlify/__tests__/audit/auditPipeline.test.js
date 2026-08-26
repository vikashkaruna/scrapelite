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
});
