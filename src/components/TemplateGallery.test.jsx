// src/components/TemplateGallery.test.jsx — Q5 (template gallery) component tests.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TemplateGallery from "./TemplateGallery.jsx";
import { EXTRACTION_TEMPLATES, TEMPLATE_TAGS } from "../lib/extractionTemplates.js";

describe("Q5 — TemplateGallery: prebuilt extraction recipes", () => {
  it("renders a card for every template by default", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    expect(screen.getAllByRole("listitem").length).toBe(EXTRACTION_TEMPLATES.length);
  });

  it("renders a tab for every tag plus an 'All' tab", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(TEMPLATE_TAGS.length + 1);
    expect(tabs[0]).toHaveTextContent(/^All$/);
  });

  it("clicking a tab filters the cards to that tag", () => {
    render(<TemplateGallery onSelect={() => {}} />);
    const firstTag = TEMPLATE_TAGS[0];
    const tab = screen.getByRole("tab", { name: new RegExp(`^${firstTag}$`) });
    fireEvent.click(tab);
    const items = screen.getAllByRole("listitem");
    // At least one card matches the first tag
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
    // first template's exampleUrl hostname
    const first = EXTRACTION_TEMPLATES[0];
    const host = new URL(first.exampleUrl).hostname;
    expect(screen.getAllByText(host).length).toBeGreaterThan(0);
  });

  it("shows an empty-state message when no templates match", () => {
    render(<TemplateGallery onSelect={() => {}} tag="__no-such-tag__" />);
    expect(screen.getByText(/No templates for that tag yet\./i)).toBeInTheDocument();
  });
});
