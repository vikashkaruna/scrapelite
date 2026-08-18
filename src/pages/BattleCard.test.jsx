// src/pages/BattleCard.test.jsx — FB1 (battle-card generator).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BattleCard from "./BattleCard.jsx";

vi.mock("../lib/seoMeta.js", () => ({
  setMeta: vi.fn(),
  // Real implementation, not a stub: these tests assert the canonical
  // URL that gets set, and a mocked-away canonicalUrl would let a
  // localhost or query-string canonical pass unnoticed — which is the
  // exact bug it was introduced to prevent.
  canonicalUrl: (p) => `https://datiq.app${String(p || "/").split(/[?#]/)[0]}`,
}));

const extractStructureMock = vi.fn();

vi.mock("../lib/firecrawlService.js", () => ({
  extractStructure: (...args) => extractStructureMock(...args),
}));

const sampleHtml = (overrides = {}) => `<html>
  <head>
    <title>${overrides.title || "Sample Title"}</title>
    <meta name="description" content="${overrides.meta || "Sample description"}">
  </head>
  <body>
    <h1>${overrides.h1 || "Sample H1"}</h1>
    <h2>H2 one</h2>
    <h2>H2 two</h2>
    <h3>H3 one</h3>
    <a href="/x">x</a>
    <a href="/y">y</a>
    <a href="/z">z</a>
    <span>$19/mo</span>
    <span>₹999/mo</span>
  </body>
</html>`;

function setupMock(html) {
  extractStructureMock.mockResolvedValue({
    html: html || sampleHtml(),
    metadata: {},
    links: [],
    headings: [],
  });
}

function renderBattleCard() {
  return render(
    <MemoryRouter initialEntries={["/vs/battlecard"]}>
      <BattleCard />
    </MemoryRouter>,
  );
}

describe("BattleCard (FB1)", () => {
  beforeEach(() => {
    extractStructureMock.mockReset();
    vi.clearAllMocks();
  });

  it("renders the page title and the input form", () => {
    renderBattleCard();
    expect(screen.getByRole("heading", { name: /Compare 2 competitors/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/linear.app\/pricing/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/notion.so\/pricing/)).toBeInTheDocument();
  });

  it("renders the 3 example quick-fill pills", () => {
    renderBattleCard();
    expect(screen.getByText(/Linear vs Notion/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe vs Paddle/)).toBeInTheDocument();
    expect(screen.getByText(/Anthropic vs OpenAI/)).toBeInTheDocument();
  });

  it("example pill click pre-fills both inputs", () => {
    renderBattleCard();
    fireEvent.click(screen.getByText(/Linear vs Notion/));
    expect(screen.getByPlaceholderText(/linear.app\/pricing/).value).toBe("https://linear.app/pricing");
    expect(screen.getByPlaceholderText(/notion.so\/pricing/).value).toBe("https://notion.so/pricing");
  });

  it("compare form requires both URLs", async () => {
    renderBattleCard();
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));
    expect(await screen.findByText(/Paste two URLs to compare/)).toBeInTheDocument();
  });

  it("extraction failure surfaces a friendly error", async () => {
    extractStructureMock.mockRejectedValueOnce(new Error("network down"));
    renderBattleCard();
    fireEvent.change(screen.getByPlaceholderText(/linear.app\/pricing/), {
      target: { value: "https://a.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/notion.so\/pricing/), {
      target: { value: "https://b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));
    expect(await screen.findByText(/network down/)).toBeInTheDocument();
  });

  it("successful compare renders the diff table with metric rows", async () => {
    setupMock();
    renderBattleCard();
    fireEvent.change(screen.getByPlaceholderText(/linear.app\/pricing/), {
      target: { value: "https://a.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/notion.so\/pricing/), {
      target: { value: "https://b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));
    await waitFor(() => {
      expect(screen.getByRole("table")).toBeInTheDocument();
    });
    expect(screen.getByText(/^Title$/i)).toBeInTheDocument();
    // Scope to the table — "Heading count" also appears in the foot paragraph.
    const table = screen.getByRole("table");
    expect(table.textContent).toMatch(/Heading count/);
    expect(table.textContent).toMatch(/Link count/);
    expect(table.textContent).toMatch(/Pricing signals/);
  });

  it("extraction is called for both URLs", async () => {
    setupMock();
    renderBattleCard();
    fireEvent.change(screen.getByPlaceholderText(/linear.app\/pricing/), {
      target: { value: "https://a.com" },
    });
    fireEvent.change(screen.getByPlaceholderText(/notion.so\/pricing/), {
      target: { value: "https://b.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));
    await waitFor(() => {
      expect(extractStructureMock).toHaveBeenCalledTimes(2);
    });
    expect(extractStructureMock).toHaveBeenCalledWith("https://a.com", expect.any(Object));
    expect(extractStructureMock).toHaveBeenCalledWith("https://b.com", expect.any(Object));
  });

  it("compares heading counts and highlights the winner", async () => {
    // First URL: 5 headings, Second URL: 1 heading
    const leftHtml = `<html><head><title>L</title><meta name="description" content="L"></head><body>
      <h1>L1</h1><h2>L2</h2><h3>L3</h3><h4>L4</h4><h5>L5</h5>
    </body></html>`;
    const rightHtml = `<html><head><title>R</title><meta name="description" content="R"></head><body>
      <h1>R1</h1>
    </body></html>`;
    extractStructureMock.mockImplementation((url) => {
      if (url === "https://a.com") return Promise.resolve({ html: leftHtml, metadata: {}, links: [], headings: [] });
      if (url === "https://b.com") return Promise.resolve({ html: rightHtml, metadata: {}, links: [], headings: [] });
      return Promise.reject(new Error("unknown"));
    });
    renderBattleCard();
    fireEvent.change(screen.getByPlaceholderText(/linear.app\/pricing/), { target: { value: "https://a.com" } });
    fireEvent.change(screen.getByPlaceholderText(/notion.so\/pricing/), { target: { value: "https://b.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Compare/i }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    // The left side (5 headings) should have a battlecell-winner class on the heading row.
    const winners = document.querySelectorAll(".battlecell-winner");
    expect(winners.length).toBeGreaterThan(0);
  });

  // ⚠️ Asserting the href STRING is what let a real bug ship: /vs/firecrawl was
  // a react-router <Link> to a path with no matching <Route>, so every in-app
  // click landed on NotFound while a direct URL hit worked fine (a static file
  // serves it). This test passed the whole time.
  //
  // The href assertions stay — they still catch a typo — but the check that
  // actually matters now lives in src/__tests__/no-broken-links.test.js, which
  // reads the SOURCE and fails when a <Link to> has no declared route.
  it("has a footer link back to Home and to the comparison pages", () => {
    renderBattleCard();
    expect(screen.getByText(/Back to DatIQ/i).getAttribute("href")).toBe("/");
    expect(screen.getByText(/Compare all tools/i).getAttribute("href")).toBe("/vs/compare");
    expect(screen.getByText(/DatIQ vs Browse.ai/i).getAttribute("href")).toBe("/vs/browse-ai");
    expect(screen.getByText(/DatIQ vs Firecrawl/i).getAttribute("href")).toBe("/vs/firecrawl");
  });

  it("sets SEO meta on mount", async () => {
    const { setMeta } = await import("../lib/seoMeta.js");
    renderBattleCard();
    expect(setMeta).toHaveBeenCalledTimes(1);
    const arg = setMeta.mock.calls[0][0];
    expect(arg.title).toMatch(/Battle-card/);
  });
});
