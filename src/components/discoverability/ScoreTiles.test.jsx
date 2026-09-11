// ScoreTiles.test.jsx — pillar cards expand independently, and always have a name.
//
// Two defects are pinned here.
//
// 1. PILLAR CARDS WERE AN ACCORDION. `expandedPillar` was a single nullable
//    string, so opening one card closed whichever one you were already reading.
//    Comparing two pillars — the commonest reason to open one at all — meant
//    scrolling back and re-opening every time.
//
// 2. SIGNAL NAMES RENDERED BLANK on any audit reopened from history, because
//    rehydrate() dropped `label` (see netlify/__tests__/audit/rehydrate.test.js).
//    The component now falls back to the registry, so the same omission would
//    degrade to a code rather than to an empty column.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, useCallback } from "react";
import { PillarGrid, PillarCard } from "./ScoreTiles.jsx";
import { PILLAR_IDS, PILLARS, SIGNALS, signalsForPillar } from "../../lib/discoverability/signalRegistry.js";

function auditFixture({ dropLabels = false } = {}) {
  const pillars = {};
  for (const id of PILLAR_IDS) {
    pillars[id] = {
      score: 62.5,
      coverage: 100,
      weight: PILLARS[id].weight,
      signals: signalsForPillar(id).map((code, i) => ({
        code,
        label: dropLabels ? undefined : SIGNALS[code].label,
        weight: SIGNALS[code].weight,
        score: 40 + i * 5,
        measured: true,
        applicable: true,
        unknownReason: null,
      })),
    };
  }
  return { pillars };
}

/** Mirrors how Discoverability.jsx drives the grid. */
function Harness({ audit }) {
  const [open, setOpen] = useState(new Set());
  const toggle = useCallback((id) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  return <PillarGrid audit={audit} diff={null} expandedPillars={open} onTogglePillar={toggle} />;
}

const cardFor = (label) => screen.getByRole("button", { name: new RegExp(label, "i") });

describe("PillarGrid — independent expansion", () => {
  it("starts with every pillar collapsed", () => {
    render(<Harness audit={auditFixture()} />);
    for (const id of PILLAR_IDS) {
      expect(cardFor(PILLARS[id].label)).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("keeps a pillar open when a second one is opened", () => {
    // THE regression. Under the old single-id state, opening the second pillar
    // set aria-expanded="false" back on the first.
    render(<Harness audit={auditFixture()} />);
    const a = cardFor(PILLARS.answer_clarity.label);
    const b = cardFor(PILLARS.structural_hierarchy.label);

    fireEvent.click(a);
    expect(a).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-expanded", "true");
    expect(a, "opening a second pillar must not close the first").toHaveAttribute("aria-expanded", "true");
  });

  it("opens all four at once", () => {
    render(<Harness audit={auditFixture()} />);
    for (const id of PILLAR_IDS) fireEvent.click(cardFor(PILLARS[id].label));
    for (const id of PILLAR_IDS) {
      expect(cardFor(PILLARS[id].label)).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("closes only the pillar the reader closed", () => {
    render(<Harness audit={auditFixture()} />);
    const a = cardFor(PILLARS.answer_clarity.label);
    const b = cardFor(PILLARS.entity_authority.label);
    fireEvent.click(a);
    fireEvent.click(b);
    fireEvent.click(a);
    expect(a).toHaveAttribute("aria-expanded", "false");
    expect(b).toHaveAttribute("aria-expanded", "true");
  });
});

describe("PillarGrid — signal names", () => {
  it("names every signal in an expanded pillar", () => {
    render(<Harness audit={auditFixture()} />);
    fireEvent.click(cardFor(PILLARS.answer_clarity.label));
    for (const code of signalsForPillar("answer_clarity")) {
      expect(screen.getByText(SIGNALS[code].label)).toBeInTheDocument();
    }
  });

  it("falls back to the registry when a stored audit carries no label", () => {
    // A rehydrated audit that lost its labels must still name its signals.
    render(<Harness audit={auditFixture({ dropLabels: true })} />);
    fireEvent.click(cardFor(PILLARS.answer_clarity.label));
    for (const code of signalsForPillar("answer_clarity")) {
      expect(screen.getByText(SIGNALS[code].label)).toBeInTheDocument();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// W4 — THE EVIDENCE ENVELOPE FINALLY REACHES A SCREEN
// ═══════════════════════════════════════════════════════════════════════════
// W1 built the envelope and threaded it through the pipeline, the store and the
// API — and it reached no screen at all. A record that is stored and never
// shown answers "where exactly did you see that?" only for whoever can query
// the database, which is not the person asking.

describe("signal evidence is visible, and says what kind of claim it is", () => {
  const withEvidence = (evidence, confidence = 0.95) => ({
    pillarId: "structural_hierarchy",
    pillar: {
      score: 60, weight: 0.2, coverage: 100,
      signals: [{
        code: "single_h1", label: "Single H1", weight: 0.15,
        score: 40, measured: true, confidence, evidence,
      }],
    },
    expanded: true,
    onToggle: () => {},
  });

  it("shows the observation count and the confidence", () => {
    render(<PillarCard {...withEvidence([
      { method: "raw_html", observed: true, selector: "h1", section: "Page H1",
        excerpt: "Pricing that scales", collected_at: "2026-09-11T09:00:00.000Z" },
    ])} />);
    expect(screen.getByText(/1 observation/)).toBeInTheDocument();
    expect(screen.getByText(/95% confidence/)).toBeInTheDocument();
  });

  it("shows the selector — the literal answer to 'where on the page'", async () => {
    render(<PillarCard {...withEvidence([
      { method: "raw_html", observed: true, selector: "h1", section: "Page H1" },
    ])} />);
    await userEvent.click(screen.getByText(/1 observation/));
    expect(screen.getByText("h1")).toBeInTheDocument();
    expect(screen.getByText(/Page H1/)).toBeInTheDocument();
  });

  it("distinguishes a reading from a model judgement", async () => {
    // `observed` is a property of HOW the thing was learned, not a flag a call
    // site sets — so a judgement can never be dressed as a reading.
    render(<PillarCard {...withEvidence([
      { method: "raw_html", observed: true, selector: "h1" },
      { method: "model_inference", observed: false, section: "Model re-read" },
    ])} />);
    await userEvent.click(screen.getByText(/2 observations/));
    expect(screen.getByText("Observed")).toBeInTheDocument();
    expect(screen.getByText("Inferred")).toBeInTheDocument();
  });

  it("renders nothing when a signal carries no evidence", () => {
    // Every audit stored before migration 0048, and every unmeasured signal.
    // An empty "Evidence" disclosure would read as "we looked and found none".
    render(<PillarCard {...withEvidence([])} />);
    expect(screen.queryByText(/observation/)).not.toBeInTheDocument();
  });

  it("survives a signal whose evidence key is absent entirely", () => {
    const props = withEvidence([]);
    delete props.pillar.signals[0].evidence;
    expect(() => render(<PillarCard {...props} />)).not.toThrow();
  });
});
