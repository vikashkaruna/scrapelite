// EvidencePanels.test.jsx — every score has to be traceable to something a
// person can look at. The rule these pin above all: an unmeasured value reads
// "not measured", never a number and never a failure.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  HeadingTreePanel, SchemaPanel, AnswerPanel, EntityPanel, TechnicalPanel, Panel,
} from "./EvidencePanels.jsx";
import { CWV_THRESHOLDS } from "../../lib/discoverability/signalScorers.js";

describe("HeadingTreePanel", () => {
  it("explains what a page with no headings means for retrieval", () => {
    render(<HeadingTreePanel outline={[]} />);
    expect(screen.getByText(/one undifferentiated chunk/)).toBeTruthy();
  });

  it("flags a skipped level and an empty heading in place", () => {
    const { container } = render(<HeadingTreePanel
      outline={[{ level: 1, text: "Pricing" }, { level: 3, text: "Starter" }, { level: 2, text: "" }]}
      stats={{ h1_count: 1, skipped_levels: 1, empty_headings: 1 }}
    />);
    expect(screen.getByText("skipped level")).toBeTruthy();
    expect(screen.getByText("(empty heading)")).toBeTruthy();
    expect(container.querySelectorAll(".dsc-heading-skipped")).toHaveLength(1);
    expect(container.textContent).toContain("3 headings · 1 H1");
    expect(container.textContent).toContain("1 skipped level");
  });
});

describe("SchemaPanel", () => {
  it("warns that an unparseable JSON-LD block is discarded whole", () => {
    render(<SchemaPanel schemaTypes={["Organization"]} structuredData={{ parse_errors: 2, block_count: 1 }} />);
    expect(screen.getByText(/2 JSON-LD blocks failed to parse/)).toBeTruthy();
    expect(screen.getByText("Organization")).toBeTruthy();
  });

  it("says plainly when there is no structured data", () => {
    render(<SchemaPanel />);
    expect(screen.getByText(/No structured data/)).toBeTruthy();
    expect(screen.getByText("0 blocks parsed")).toBeTruthy();
  });
});

describe("AnswerPanel", () => {
  it("shows the passage an engine would lift, with its length and depth", () => {
    const { container } = render(<AnswerPanel blocks={[{
      anchor_heading: "What is DatIQ?", word_count: 48, position_percent: 6,
      standalone_score: 91.6, excerpt: "DatIQ is a zero-code extraction platform.",
    }]} />);
    expect(screen.getByText("DatIQ is a zero-code extraction platform.")).toBeTruthy();
    expect(container.textContent).toContain("48 words · 6% down the page");
    expect(container.textContent).toContain("stands alone 92/100");
  });

  it("reports the absence of an answer rather than an empty box", () => {
    render(<AnswerPanel />);
    expect(screen.getByText(/No self-contained answer passage/)).toBeTruthy();
  });
});

describe("EntityPanel", () => {
  it("🔴 calls an unsampled citation footprint unknown — not zero", () => {
    render(<EntityPanel entity={{}} />);
    expect(screen.getByText(/this is unknown — not zero/)).toBeTruthy();
    expect(screen.getAllByText("not measured").length).toBeGreaterThan(0);
  });

  it("warns that a recall-only sample measures fame, not live citation", () => {
    render(<EntityPanel entity={{
      brand_name: "Acme",
      ai_citation_sample: { engine: "gemini", live: false, mentions: 1, citations: 0, prompt_count: 5, share_of_voice: 0.2 },
    }} />);
    expect(screen.getByText(/without live web retrieval/)).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
  });

  it("does not show the recall caveat for a live sample", () => {
    render(<EntityPanel entity={{
      ai_citation_sample: { engine: "perplexity", live: true, mentions: 2, citations: 1, prompt_count: 4 },
    }} />);
    expect(screen.queryByText(/without live web retrieval/)).toBeNull();
  });
});

describe("TechnicalPanel", () => {
  it("never renders an unmeasured fact as a pass or a fail", () => {
    render(<TechnicalPanel technical={{}} />);
    expect(screen.getAllByText("not measured").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/robots.txt could not be read/)).toBeTruthy();
    expect(screen.getByText(/no headless renderer configured/)).toBeTruthy();
  });

  it("bands Core Web Vitals against the shared thresholds", () => {
    const { container } = render(<TechnicalPanel technical={{
      indexable: false,
      core_web_vitals: {
        lcp_seconds: CWV_THRESHOLDS.lcp.good - 0.1,
        inp_ms: CWV_THRESHOLDS.inp.poor + 1,
        cls: null,
        source: "field",
      },
    }} />);
    expect(container.querySelector(".dsc-ok")).toBeTruthy();
    expect(container.querySelectorAll(".dsc-bad").length).toBeGreaterThanOrEqual(2); // not indexable + poor INP
    expect(screen.getByText(/real Chrome users/)).toBeTruthy();
  });

  it("distinguishes allowed, blocked and unknown crawler access", () => {
    const { container } = render(<TechnicalPanel technical={{
      ai_crawler_access: { GPTBot: true, ClaudeBot: false, PerplexityBot: null },
    }} />);
    expect(container.querySelector(".dsc-crawler-allowed")?.textContent).toContain("GPTBot");
    expect(container.querySelector(".dsc-crawler-blocked")?.textContent).toContain("ClaudeBot");
    expect(container.querySelector(".dsc-crawler-unknown")?.textContent).toContain("PerplexityBot");
  });

  it("reports JavaScript-only content when the rendered DOM carries much more", () => {
    render(<TechnicalPanel technical={{
      rendering: { raw_html_word_count: 100, rendered_dom_word_count: 400, content_loss_ratio: 0.75 },
    }} />);
    expect(screen.getByText(/75% only after JavaScript/)).toBeTruthy();
  });
});

describe("Panel", () => {
  it("wraps content under a titled section", () => {
    render(<Panel title="Headings" icon="list"><p>body</p></Panel>);
    expect(screen.getByRole("heading", { name: /Headings/ })).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
