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
  it("renders a card for every template by default", () => {
    render(<TemplateGallery onSelect={() => {}} />);
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
    render(<TemplateGallery onSelect={onSelect} />);
    const first = screen.getByText(EXTRACTION_TEMPLATES[0].title).closest("button");
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ key: EXTRACTION_TEMPLATES[0].key }),
    );
  });

  it("shows the example hostname in each card", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const first = EXTRACTION_TEMPLATES[0];
    const host = new URL(first.exampleUrl).hostname;
    expect(screen.getAllByText(host).length).toBeGreaterThan(0);
  });

  it("shows an empty-state message when no templates match the tag", () => {
    render(<TemplateGallery onSelect={() => {}} tag="__no-such-tag__" />);
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
