// visibilityBrief.test.js — the multi-company run behind the AI Visibility
// Brief, and the template-synthesis step that never existed before it.
//
// The regression these pin: every seed template shipped `prompt_bundle
// .summarize` and `.talking_points`, and NOTHING in the repo consumed either.
// executeRun read `scraped.ai_summary` — a field extractStructure does not
// return — so the AI branch was unreachable, the ledger never recorded an
// ai_call, and the declared summary/talking_points output blocks could never
// be filled. A "workflow" was one scrape and a JSON dump.
import { describe, it, expect, beforeEach, vi } from "vitest";

const extractMock = vi.fn();
const aiMock = vi.fn();

vi.mock("../firecrawlService.js", () => ({ extractStructure: (...a) => extractMock(...a) }));
vi.mock("../apiClient.js", () => ({
  getAuthToken: () => "",
  apiClient: { ai: (...a) => aiMock(...a) },
}));

const { executeRun, splitPoints } = await import("./templatesClient.js");
const { SEED_TEMPLATES } = await import("./seedTemplates.js");

const BRIEF = SEED_TEMPLATES.find((t) => t.template_key === "ai_visibility_brief");
const ACCOUNT = SEED_TEMPLATES.find((t) => t.template_key === "account_brief");

const facts = (name) => ({
  positioning: { one_liner: `${name} does a thing`, target_customer: "mid-market" },
  evidence: [{ field: "positioning.one_liner", quote: `${name} does a thing`, source_url: `https://${name}.com` }],
});

const aiText = (text) => ({ content: [{ type: "text", text }] });

beforeEach(() => {
  extractMock.mockReset();
  aiMock.mockReset();
});

describe("template synthesis (the step that was never wired)", () => {
  it("runs prompt_bundle.summarize and .talking_points and charges for each", async () => {
    extractMock.mockResolvedValue({
      page_title: "Acme", custom_extraction: facts("acme"), page_text: "Acme sells widgets.",
      headings: [], links: [], enrichment_meta: { ok: true, provider: "gemini" },
    });
    aiMock
      .mockResolvedValueOnce(aiText("Acme sells widgets to mid-market buyers."))
      .mockResolvedValueOnce(aiText("1. Mention the pricing page\n2. Name a customer"));

    const r = await executeRun({ template: ACCOUNT, input: { domain: "acme.com" } });

    expect(aiMock).toHaveBeenCalledTimes(2);
    expect(r.summary).toMatch(/mid-market/);
    expect(r.output.talking_points).toEqual(["Mention the pricing page", "Name a customer"]);
    // Both synthesis calls billed, and the extraction is on the synthesis area
    // so it gets that area's model tier rather than the classification one.
    expect(r.events.filter((e) => e.unit === "ai_call")).toHaveLength(2);
    expect(aiMock.mock.calls[0][0].area).toBe("synthesis");
  });

  it("a failed synthesis is FREE and does not fail the run", async () => {
    extractMock.mockResolvedValue({
      page_title: "Acme", custom_extraction: facts("acme"), headings: [], links: [],
    });
    aiMock.mockRejectedValue(new Error("no credit"));

    const r = await executeRun({ template: ACCOUNT, input: { domain: "acme.com" } });

    expect(r.events.filter((e) => e.unit === "ai_call")).toHaveLength(0);
    expect(r.summary).toBeNull();
    // The facts still came back, so the run completed — but it is PARTIAL,
    // because the template promised a summary it could not deliver.
    expect(r.output.fields).toBeTruthy();
    expect(r.partial).toBe(true);
  });

  it("counts every related page as a source, not just the target", async () => {
    extractMock.mockResolvedValue({
      page_title: "Acme", custom_extraction: facts("acme"), headings: [], links: [],
      related_pages_scanned: ["https://acme.com/pricing", "https://acme.com/about"],
    });
    aiMock.mockResolvedValue(aiText("brief"));

    const r = await executeRun({ template: ACCOUNT, input: { domain: "acme.com" } });
    expect(r.sources.map((s) => s.url)).toEqual([
      "https://acme.com", "https://acme.com/pricing", "https://acme.com/about",
    ]);
    expect(r.events.find((e) => e.unit === "page").credits).toBe(3);
  });
});

describe("AI Visibility Brief — the multi-company run", () => {
  it("reads every company under the SAME schema and compares them", async () => {
    extractMock.mockImplementation(async (url) => ({
      page_title: url, custom_extraction: facts(url), page_text: `${url} copy`,
      headings: [], links: [],
    }));
    aiMock
      .mockResolvedValueOnce(aiText("You claim the same ground as rival-a."))
      .mockResolvedValueOnce(aiText("1. Rewrite the hero\n2. Publish a pricing page"))
      .mockResolvedValueOnce(aiText(JSON.stringify({
        axes: ["Category", "Entry price"],
        rows: [
          { company: "acme.com", values: { Category: "PLM", "Entry price": null } },
          { company: "rival-a.com", values: { Category: "PLM", "Entry price": "$29" } },
        ],
      })));

    const r = await executeRun({
      template: BRIEF,
      input: { domain: "acme.com", competitors: ["rival-a.com"], audience: "gtm" },
    });

    // Every company read with the mission capability — like-for-like is the
    // whole point; four differently shaped summaries are not a comparison.
    expect(extractMock).toHaveBeenCalledTimes(2);
    for (const call of extractMock.mock.calls) expect(call[1].enrichKey).toBe("mission");

    expect(r.summary).toMatch(/rival-a/);
    expect(r.talking_points).toEqual(["Rewrite the hero", "Publish a pricing page"]);
    expect(r.output.comparison.rows).toHaveLength(2);
    // A null cell survives as null: "they don't say" is a finding, and filling
    // it in would corrupt every comparison built on it.
    expect(r.output.comparison.rows[0].values["Entry price"]).toBeNull();
    expect(r.partial).toBe(false);
  });

  it("marks the run partial and names a competitor it could not read", async () => {
    extractMock.mockImplementation(async (url) => {
      if (url.includes("rival-b")) throw new Error("403");
      return { page_title: url, custom_extraction: facts(url), headings: [], links: [] };
    });
    aiMock.mockResolvedValue(aiText("brief"));

    const r = await executeRun({
      template: BRIEF,
      input: { domain: "acme.com", competitors: ["rival-b.com"] },
    });

    expect(r.output.unread).toEqual(["rival-b.com"]);
    expect(r.partial).toBe(true);
    expect(r.needsReview).toBe(true);
    // The prompt is TOLD what was not read, so the model cannot quietly
    // invent a row for a site nobody looked at.
    const prompt = aiMock.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/NOT READ/);
    expect(prompt).toMatch(/rival-b\.com/);
  });

  it("refuses rather than building a brief with no view of your own site", async () => {
    extractMock.mockResolvedValue({
      page_title: "Acme", custom_extraction: null, custom_extraction_reason: "ai_no_credit",
      headings: [], links: [],
    });
    await expect(executeRun({
      template: BRIEF, input: { domain: "acme.com", competitors: ["rival-a.com"] },
    })).rejects.toThrow(/ai_no_credit/);
  });

  it("drops an unparseable comparison instead of showing broken JSON", async () => {
    extractMock.mockImplementation(async (url) => ({
      page_title: url, custom_extraction: facts(url), headings: [], links: [],
    }));
    aiMock
      .mockResolvedValueOnce(aiText("summary"))
      .mockResolvedValueOnce(aiText("1. do a thing"))
      .mockResolvedValueOnce(aiText("Sorry, I can't build that table."));

    const r = await executeRun({ template: BRIEF, input: { domain: "acme.com" } });
    expect(r.output.comparison).toBeNull();
    // The rest of the brief is still worth reading.
    expect(r.summary).toBe("summary");
  });
});

describe("splitPoints", () => {
  it("handles numbered, bulleted and unmarked lists", () => {
    expect(splitPoints("1. one\n2. two")).toEqual(["one", "two"]);
    expect(splitPoints("- a\n* b\n• c")).toEqual(["a", "b", "c"]);
    // Never lose the text just because it did not match a bullet pattern.
    expect(splitPoints("just one line")).toEqual(["just one line"]);
    expect(splitPoints("")).toEqual([]);
  });
});
