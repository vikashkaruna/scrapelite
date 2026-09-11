import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IssueMatrix, { IssueList, RootCauseSummary } from "./IssueMatrix.jsx";

const ISSUES = [
  {
    code: "TA-01", pillar: "technical_accessibility", severity: "critical",
    title: "AI crawlers are blocked by robots.txt", frameworks: ["seo", "geo"],
    observed: "robots.txt disallows GPTBot and PerplexityBot.",
    inference: "A page an engine cannot fetch cannot be cited, however well written.",
    rootCause: "technical_access", module: "technical_remediation", owner: "engineering",
  },
  {
    code: "SH-01", pillar: "structural_hierarchy", severity: "critical",
    title: "The page has no H1", frameworks: ["seo"],
    observed: "No H1 element is present.",
    inference: "Nothing states the page's subject in one line.",
    rootCause: "weak_page_structure", module: "recommendation_studio", owner: "content",
  },
  {
    code: "SH-04", pillar: "structural_hierarchy", severity: "medium",
    title: "The heading hierarchy skips levels", frameworks: ["seo"],
    observed: "H2 is followed by H4.",
    inference: "Skipped levels break the outline a parser builds.",
    rootCause: "weak_page_structure", module: "recommendation_studio", owner: "content",
  },
  {
    code: "EA-03", pillar: "entity_authority", severity: "high",
    title: "No sameAs links to official profiles", frameworks: ["geo"],
    observed: "No sameAs array is present.",
    inference: "Without them an engine cannot connect this site to the entity.",
    rootCause: "entity_ambiguity", module: "entity_graph", owner: "brand",
  },
];

describe("RootCauseSummary — the diagnosis above the list", () => {
  it("orders causes by the taxonomy, not by how many findings each has", () => {
    // weak_page_structure has the most findings here. Leading with it on a page
    // a crawler cannot fetch would tell the reader to restructure headings
    // nobody will ever see.
    render(<RootCauseSummary issues={ISSUES} />);
    const labels = [...document.querySelectorAll(".dsc-cause-label")].map((n) => n.textContent);
    expect(labels).toEqual(["Technical access", "Weak page structure", "Entity ambiguity"]);
  });

  it("counts the findings in each cause", () => {
    render(<RootCauseSummary issues={ISSUES} />);
    const counts = [...document.querySelectorAll(".dsc-cause-count")].map((n) => n.textContent);
    expect(counts).toEqual(["1", "2", "1"]);
  });

  it("renders nothing at all when no finding carries a cause", () => {
    // An empty "What is actually wrong" heading would read as a verdict.
    const { container } = render(<RootCauseSummary issues={[{ code: "X", severity: "low" }]} />);
    expect(container.firstChild).toBeNull();
  });

  it("reports the selected cause up, and toggles it off on a second click", async () => {
    const onSelect = vi.fn();
    render(<RootCauseSummary issues={ISSUES} onSelectCause={onSelect} activeCause={null} />);
    await userEvent.click(screen.getByRole("button", { name: /Technical access/ }));
    expect(onSelect).toHaveBeenCalledWith("technical_access");
  });

  it("clears the filter when the active cause is clicked again", async () => {
    const onSelect = vi.fn();
    render(<RootCauseSummary issues={ISSUES} onSelectCause={onSelect} activeCause="technical_access" />);
    await userEvent.click(screen.getByRole("button", { name: /Technical access/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("IssueList — observed and inferred are not the same claim", () => {
  it("labels both, so the reasoned half does not borrow the measured half's authority", () => {
    render(<IssueList issues={[ISSUES[0]]} />);
    expect(screen.getByText("Observed")).toBeInTheDocument();
    expect(screen.getByText("Why it matters")).toBeInTheDocument();
    expect(screen.getByText(/disallows GPTBot/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be cited/)).toBeInTheDocument();
  });

  it("falls back to the legacy evidence sentence for a pre-W4 audit", () => {
    // Rows written before migration 0050 have no `observed`; the sentence they
    // do have IS the observed fact, it was just never labelled as one.
    render(<IssueList issues={[{
      code: "AC-01", pillar: "answer_clarity", severity: "high", title: "No direct answer",
      frameworks: ["aeo"], evidence: "The opening paragraph never answers the H1.",
    }]} />);
    expect(screen.getByText(/never answers the H1/)).toBeInTheDocument();
    expect(screen.queryByText("Why it matters")).not.toBeInTheDocument();
  });

  it("names the module that answers a finding, and says when it is not built yet", () => {
    // Showing "Entity Graph Builder" as though it were clickable would be
    // selling a P2 module inside a P1 report.
    render(<IssueList issues={[ISSUES[3]]} />);
    expect(screen.getByText(/Entity Graph Builder/)).toBeInTheDocument();
    expect(screen.getByText(/\(coming\)/)).toBeInTheDocument();
  });

  it("does not mark an available module as coming", () => {
    render(<IssueList issues={[ISSUES[0]]} />);
    expect(screen.queryByText(/\(coming\)/)).not.toBeInTheDocument();
  });

  it("filters by root cause", () => {
    render(<IssueList issues={ISSUES} cause="weak_page_structure" />);
    expect(screen.getByText("SH-01")).toBeInTheDocument();
    expect(screen.getByText("SH-04")).toBeInTheDocument();
    expect(screen.queryByText("TA-01")).not.toBeInTheDocument();
  });

  it("shows the owner, which is what makes the queue assignable", () => {
    render(<IssueList issues={[ISSUES[0]]} />);
    expect(screen.getByText(/engineering/)).toBeInTheDocument();
  });
});

describe("IssueMatrix — unchanged behaviour still holds", () => {
  it("renders a dash rather than a zero in an empty cell", () => {
    render(<IssueMatrix issues={ISSUES} />);
    // Zero invites the eye; nothing here deserves attention.
    expect(document.querySelectorAll(".dsc-matrix-zero").length).toBeGreaterThan(0);
  });

  it("says so plainly when there is nothing to report", () => {
    render(<IssueMatrix issues={[]} />);
    expect(screen.getByText(/No issues found/)).toBeInTheDocument();
  });
});
