// aiService.nofabrication.test.js — the contract that matters most in this file.
//
// ── THE DEFECT THESE PIN ─────────────────────────────────────────────────────
// Every AI call in aiService used to `catch` and return locally-generated
// fixture prose. In production, with all three provider accounts dead, that
// meant users were shown text like
//
//   "This page from producthunt.com centers on 'Top Products Launching Today',
//    organized across 16 headings that move from the main message into
//    supporting detail."
//
// …badged by provenanceService as `ai_generated`, when nothing had read the
// page at all. Generated content was worse: "Competitor Summary" emitted
// invented claims ("Likely gaps. Limited public detail on pricing depth") with
// no model involved.
//
// Degrading the experience is fine. Fabricating a claim about a customer's
// data is not. Mocks now run ONLY in mock mode.
import { describe, it, expect, beforeEach, vi } from "vitest";

const aiMock = vi.fn();
vi.mock("./apiClient.js", () => ({ apiClient: { ai: (...a) => aiMock(...a) } }));
// hasFirecrawl: true == LIVE mode. This is the switch that used to not exist.
vi.mock("./config.js", () => ({ hasAI: true, hasFirecrawl: true, AI_MODEL: "test" }));

const { summarize, summarizeDetailed, generateContent, generateContentDetailed, CONTENT_FORMATS } =
  await import("./aiService.js");

const PAGE = {
  url: "https://acme.com",
  page_title: "Acme — procurement software",
  headings: [{ tag: "H1", text: "Acme" }, { tag: "H2", text: "Pricing" }],
  links: [],
  page_text: "# Acme\n\nAcme sells procurement software to enterprise buyers.\n\n## Pricing\n\n| Pro | $29 |",
};

const err = (code, status = 502) => Object.assign(new Error("boom"), { code, status, hint: `hint:${code}` });
// Throw SYNCHRONOUSLY rather than returning a rejected promise. `apiClient.ai`
// is awaited inside an async function, so a sync throw propagates identically —
// but it leaves no floating rejected promise on the mock's recorded results for
// Vitest's unhandled-rejection guard to flag after the test has already passed.
const rejectWith = (code, status) => aiMock.mockImplementation(() => { throw err(code, status); });

// ⚠️ BLOCK BODY, NOT A CONCISE ARROW. `mockReset()` RETURNS the mock, and a
// value returned from beforeEach is treated as a TEARDOWN callback — so
// `beforeEach(() => aiMock.mockReset())` hands Vitest the mock itself as
// teardown, which then INVOKES it after the test, running whatever
// implementation the test installed. With a throwing implementation that
// surfaces as an unexplained "Error: boom" failing a test whose assertions
// all passed.
beforeEach(() => { aiMock.mockReset(); });

describe("live mode never fabricates", () => {
  it("returns an EMPTY summary — not fixture prose — when the AI fails", async () => {
    rejectWith("no_credit");
    const r = await summarizeDetailed(PAGE);
    expect(r.ok).toBe(false);
    expect(r.text).toBe("");
    // The failing string from the old fixture generator. Its absence is the test.
    expect(r.text).not.toMatch(/organized across|centers on/);
    expect(r.code).toBe("no_credit");
    expect(r.hint).toBe("hint:no_credit");
  });

  it("summarize() returns '' rather than inventing, so a careless caller renders nothing", async () => {
    rejectWith("bad_key");
    expect(await summarize(PAGE)).toBe("");
  });

  it("a 200 with no text is a FAILURE, not an excuse to fall back", async () => {
    aiMock.mockResolvedValue({ content: [{ type: "text", text: "" }] });
    const r = await summarizeDetailed(PAGE);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("empty");
  });

  it("generateContent THROWS instead of returning invented analysis", async () => {
    rejectWith("no_credit");
    const fmt = CONTENT_FORMATS.find((f) => f.key === "competitor-summary");
    await expect(generateContent(PAGE, fmt)).rejects.toThrow(/credit/i);
    const detailed = await generateContentDetailed(PAGE, fmt);
    expect(detailed.ok).toBe(false);
    // The old fixture's invented gap analysis.
    expect(detailed.text).not.toMatch(/Limited public detail/);
  });
});

describe("prompts carry the page BODY, not just its table of contents", () => {
  it("the summary prompt contains the page text", async () => {
    aiMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    await summarizeDetailed(PAGE);
    const prompt = aiMock.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("PAGE CONTENT:");
    expect(prompt).toContain("Acme sells procurement software");
    // Table structure survives into the prompt — this is what makes a pricing
    // page extractable rather than "Pro $29 Business $79" soup.
    expect(prompt).toContain("| Pro | $29 |");
    // Routed to the synthesis area so it gets the deep tier.
    expect(aiMock.mock.calls[0][0].area).toBe("synthesis");
  });

  it("says so IN THE PROMPT when only structure is available, and forbids specifics", async () => {
    aiMock.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    await summarizeDetailed({ ...PAGE, page_text: "" });
    const prompt = aiMock.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/ONLY the page's structure/);
    expect(prompt).toMatch(/Do not state specific facts/);
  });

  it("content generation is grounded in the body AND the schema-validated facts", async () => {
    aiMock.mockResolvedValue({ content: [{ type: "text", text: "brief" }] });
    const fmt = CONTENT_FORMATS.find((f) => f.key === "compare");
    await generateContentDetailed(
      { ...PAGE, custom_extraction: { plans: [{ name: "Pro", price: "$29" }] } },
      fmt,
    );
    const prompt = aiMock.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("PAGE CONTENT:");
    expect(prompt).toContain("VERIFIED EXTRACTED FACTS");
    expect(prompt).toContain('"name":"Pro"');
    expect(prompt).toMatch(/Not stated on this page/);
    // Enough budget that a brief is not truncated mid-sentence.
    expect(aiMock.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4096);
  });
});
