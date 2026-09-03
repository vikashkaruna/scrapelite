import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RecipeGallery from "./RecipeGallery.jsx";
import { RECIPES, RECIPE_READINESS, isRunnable } from "../lib/recipes/recipeCatalog.js";

const show = (props = {}) =>
  render(<MemoryRouter><RecipeGallery {...props} /></MemoryRouter>);

describe("RecipeGallery", () => {
  it("renders every recipe when no persona is given", () => {
    show();
    expect(screen.getAllByRole("listitem")).toHaveLength(RECIPES.length);
  });

  it("filters to the persona's recipes", () => {
    show({ personaId: "seo" });
    const shown = screen.getAllByRole("listitem").length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(RECIPES.length);
  });

  it("renders nothing rather than an empty shell for an unknown persona", () => {
    const { container } = show({ personaId: "not-a-persona" });
    expect(container.firstChild).toBeNull();
  });

  it("leads with the outcome, and states when → then", () => {
    show({ personaId: "sales" });
    const live = RECIPES.find((r) => r.key === "account-brief-to-crm");
    expect(screen.getByText(live.title)).toBeInTheDocument();
    expect(screen.getByText(live.outcome)).toBeInTheDocument();
    expect(screen.getByText(live.when)).toBeInTheDocument();
    expect(screen.getByText(live.then)).toBeInTheDocument();
  });

  // The whole point of the readiness tiers: a card whose button does nothing
  // is how a gallery teaches users it is decorative.
  it("gives runnable recipes a real link and roadmap ones NO control at all", () => {
    show();
    for (const r of RECIPES) {
      const card = screen.getByText(r.title).closest("li");
      const link = within(card).queryByRole("link");
      if (isRunnable(r)) {
        expect(link, `${r.key} should link`).toBeTruthy();
        expect(link).toHaveAttribute("href", r.cta.to);
      } else {
        expect(link, `${r.key} is roadmap and must not offer a control`).toBeNull();
        expect(within(card).queryByRole("button")).toBeNull();
      }
    }
  });

  it("says which phase a roadmap recipe waits on, rather than just 'soon'", () => {
    show();
    for (const r of RECIPES.filter((x) => x.readiness === RECIPE_READINESS.RULES)) {
      const card = screen.getByText(r.title).closest("li");
      // Assert on textContent, not a RegExp built from the phase: one phase is
      // "Bulk enrichment + signal routing", and `+` is a quantifier. The text
      // is also split across JSX nodes, so a string matcher would miss it too.
      expect(card.textContent).toContain(r.phase);
    }
  });

  it("honours a limit without dropping the runnable ones first", () => {
    show({ limit: 2 });
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    // Ordering puts runnable first, so a truncated gallery still shows things
    // the user can actually do.
    for (const c of cards) expect(within(c).queryByRole("link")).toBeTruthy();
  });

  it("uses a custom heading when given one", () => {
    show({ heading: "Wire it into your stack" });
    expect(screen.getByRole("heading", { name: "Wire it into your stack" })).toBeInTheDocument();
  });
});
