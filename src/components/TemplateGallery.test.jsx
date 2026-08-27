// src/components/TemplateGallery.test.jsx — Q5 (template gallery) + F06 (Recipe Packs).

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import TemplateGallery from "./TemplateGallery.jsx";
import {
  EXTRACTION_TEMPLATES,
  TEMPLATE_TAGS,
  RECIPE_PACKS,
} from "../lib/extractionTemplates.js";

describe("Q5 — TemplateGallery: prebuilt extraction recipes", () => {
  it("renders a card for every template when open", () => {
    render(<TemplateGallery onSelect={() => {}} defaultOpen />);
    expect(screen.getAllByRole("listitem").length).toBe(EXTRACTION_TEMPLATES.length);
  });

  it("renders a tab for every tag plus an 'All' tab", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    // Tab lists: one for tags, one for packs. The tag tablist is the
    // one with the 'All' tab + tag names. Filter for the one whose
    // tabs include TEMPLATE_TAGS[0].
    const tablists = screen.getAllByRole("tablist");
    const tagList = tablists.find((tl) =>
      TEMPLATE_TAGS.every((t) => within(tl).queryByText(new RegExp(`^${t}$`)) !== null),
    );
    expect(tagList).toBeTruthy();
    const tabs = within(tagList).getAllByRole("tab");
    expect(tabs.length).toBe(TEMPLATE_TAGS.length + 1);
    expect(tabs[0]).toHaveTextContent(/^All$/);
  });

  it("clicking a tag tab filters the cards to that tag", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tablists = screen.getAllByRole("tablist");
    const tagList = tablists.find((tl) =>
      TEMPLATE_TAGS.every((t) => within(tl).queryByText(new RegExp(`^${t}$`)) !== null),
    );
    const firstTag = TEMPLATE_TAGS[0];
    const tab = within(tagList).getByRole("tab", { name: new RegExp(`^${firstTag}$`) });
    fireEvent.click(tab);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.textContent.toLowerCase()).toContain(firstTag);
    }
  });

  it("clicking a card calls onSelect with the template", () => {
    const onSelect = vi.fn();
    render(<TemplateGallery onSelect={onSelect} defaultOpen />);
    const first = screen.getByText(EXTRACTION_TEMPLATES[0].title).closest("button");
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ key: EXTRACTION_TEMPLATES[0].key }),
    );
  });

  it("shows the example hostname in each card", () => {
    render(<TemplateGallery onSelect={() => {}} defaultOpen />);
    const first = EXTRACTION_TEMPLATES[0];
    const host = new URL(first.exampleUrl).hostname;
    expect(screen.getAllByText(host).length).toBeGreaterThan(0);
  });

  it("shows an empty-state message when no templates match the tag", () => {
    render(<TemplateGallery onSelect={() => {}} defaultOpen tag="__no-such-tag__" />);
    expect(screen.getByText(/No templates for that combination yet\./i)).toBeInTheDocument();
  });
});

describe("F06 — Recipe Packs in TemplateGallery", () => {
  it("renders a Pack tablist with All + each pack", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tablists = screen.getAllByRole("tablist");
    const packList = tablists.find((tl) =>
      RECIPE_PACKS.every((p) => within(tl).queryByText(p.label) !== null),
    );
    expect(packList).toBeTruthy();
    const tabs = within(packList).getAllByRole("tab");
    expect(tabs.length).toBe(RECIPE_PACKS.length + 1);
  });

  it("clicking a Pack tab narrows the cards to that pack's templates", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tablists = screen.getAllByRole("tablist");
    const packList = tablists.find((tl) =>
      RECIPE_PACKS.every((p) => within(tl).queryByText(p.label) !== null),
    );
    const salesTab = within(packList).getByRole("tab", { name: /Sales Pack/i });
    fireEvent.click(salesTab);
    // Sales Pack has 4 templates in our data
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(4);
  });

  it("clicking a Pack tab marks it active", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tablists = screen.getAllByRole("tablist");
    const packList = tablists.find((tl) =>
      RECIPE_PACKS.every((p) => within(tl).queryByText(p.label) !== null),
    );
    const ciTab = within(packList).getByRole("tab", { name: /CI Pack/i });
    fireEvent.click(ciTab);
    expect(ciTab.getAttribute("aria-selected")).toBe("true");
  });

  it("All tab restores the full library", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tablists = screen.getAllByRole("tablist");
    const packList = tablists.find((tl) =>
      RECIPE_PACKS.every((p) => within(tl).queryByText(p.label) !== null),
    );
    fireEvent.click(within(packList).getByRole("tab", { name: /CI Pack/i }));
    fireEvent.click(within(packList).getByRole("tab", { name: /All recipes/i }));
    expect(screen.getAllByRole("listitem").length).toBe(EXTRACTION_TEMPLATES.length);
  });
});


// ── Collapsed by default (homepage clutter) ─────────────────────────────────
// The grid is 12+ cards and sat permanently open beneath the hero, so the
// homepage asked a first-time visitor to read a catalogue before they had
// decided to do anything. The FILTERS stay visible: they are the cheap signal
// about what the product covers.
describe("TemplateGallery — collapsed by default", () => {
  it("hides the card grid until asked", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("still shows the filters while collapsed", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    expect(screen.getAllByRole("tablist").length).toBeGreaterThanOrEqual(2);
  });

  it("says how many recipes are behind the toggle", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: new RegExp(`Browse ${EXTRACTION_TEMPLATES.length} recipes`, "i") }))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("opens on the toggle", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Browse \d+ recipes/i }));
    expect(screen.getAllByRole("listitem").length).toBe(EXTRACTION_TEMPLATES.length);
    expect(screen.getByRole("button", { name: /Hide recipes/i })).toBeInTheDocument();
  });

  it("opens when a pack filter is chosen", () => {
    // Choosing a filter is an act of interest. Filtering a hidden grid would
    // be a control with no visible effect.
    render(<TemplateGallery onSelect={() => {}} />);
    const packTab = screen.getByRole("tab", { name: new RegExp(RECIPE_PACKS[0].label, "i") });
    fireEvent.click(packTab);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("opens when a tag filter is chosen", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${TEMPLATE_TAGS[0]}$`) }));
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});
