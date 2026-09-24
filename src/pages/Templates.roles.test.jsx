// Templates role filter — the eight roles (2026-09-24). A template can serve
// several roles, and a retired id in a link still lands somewhere sensible.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SEED_TEMPLATES } from "../lib/templates/seedTemplates.js";

vi.mock("../lib/templates/templatesClient.js", () => ({
  listTemplates: vi.fn(async () => ({
    templates: SEED_TEMPLATES.filter((t) => t.status === "published").map((t) => ({ ...t, version: 1 })),
  })),
}));
vi.mock("../lib/templates/templatesCache.js", () => ({ readTemplatesCache: () => null, writeTemplatesCache: () => {} }));
vi.mock("../components/PersonaProvider.jsx", () => ({ usePersona: () => ({ personaId: null }) }));
vi.mock("../components/AuthProvider.jsx", () => ({ useAuth: () => ({ user: null, openAuth: () => {} }) }));
vi.mock("../components/Toast.jsx", () => ({ useToast: () => () => {} }));

const { default: Templates } = await import("./Templates.jsx");

const renderAt = async (url) => {
  render(<MemoryRouter initialEntries={[url]}><Templates /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};
const cardTitles = () => [...document.querySelectorAll(".tpl-card h2")].map((h) => h.textContent);

beforeEach(() => localStorage.clear());

describe("Templates — role filter", () => {
  it("offers the current roles, never the legacy recruiter", async () => {
    await renderAt("/templates");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    for (const label of ["Sales", "RevOps", "Product & CI", "Product Marketing", "SEO & Content", "Brand & Growth", "Founder & VC", "Agency"]) {
      expect(tabs).toContain(label);
    }
    expect(tabs).not.toContain("Recruiter");
  });

  it("a template shows under every role it serves", async () => {
    await renderAt("/templates?filter=revops");
    expect(cardTitles()).toContain("Sales-ready Account Brief");
    await act(async () => { screen.getByRole("tab", { name: "Sales" }).click(); });
    expect(cardTitles()).toContain("Sales-ready Account Brief");
  });

  it("?filter=market-research lands on Founder & VC", async () => {
    await renderAt("/templates?filter=market-research");
    expect(screen.getByRole("tab", { name: "Founder & VC" })).toHaveAttribute("aria-selected", "true");
    expect(cardTitles()).toContain("Pre-Meeting Due Diligence Brief");
  });

  it("?filter=recruiter falls back to all roles", async () => {
    await renderAt("/templates?filter=recruiter");
    expect(screen.getByRole("tab", { name: "All roles" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("Templates — the hub (Phase C §18)", () => {
  it("shows all 20 templates, each saying whether it runs here or opens a module", async () => {
    await renderAt("/templates");
    expect(document.querySelectorAll(".tpl-card")).toHaveLength(20);
    const opens = [...document.querySelectorAll(".tpl-card-opens")].map((n) => n.textContent);
    expect(opens.length).toBe(10); // the audit, bulk enrichment and the 8 hub hand-offs
    expect(opens.join(" ")).toMatch(/Opens in Engagement \(beta\)/);
  });

  it("filters by module, and combines with the role filter", async () => {
    await renderAt("/templates?module=engage");
    expect(cardTitles().sort()).toEqual(["Account Research → Outreach Campaign", "Event / Webinar Follow-up"]);
    await act(async () => { screen.getByRole("tab", { name: "Sales" }).click(); });
    expect(cardTitles().sort()).toEqual(["Account Research → Outreach Campaign", "Event / Webinar Follow-up"]);
    await act(async () => { screen.getByRole("tab", { name: "SEO & Content" }).click(); });
    expect(cardTitles()).toEqual([]);
  });

  it("an old ?filter=workflows link lands on the Workflows module", async () => {
    await renderAt("/templates?filter=workflows");
    expect(screen.getByRole("tab", { name: /Workflows/ })).toHaveAttribute("aria-selected", "true");
    expect(cardTitles()).toContain("Bulk ICP Account Enrichment");
  });
});
