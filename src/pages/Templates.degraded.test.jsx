import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SEED_TEMPLATES } from "../lib/templates/seedTemplates.js";

// When the template store is unavailable the API still serves the seeds with
// `degraded: true`. A template that RUNS here must be held back then; a
// hand-off must not, because it runs nothing here — it only opens another
// module with the fields filled in.
vi.mock("../components/AuthProvider.jsx", () => ({ useAuth: () => ({ user: null, authLoading: false }) }));
vi.mock("../components/PersonaProvider.jsx", () => ({ usePersona: () => ({ personaId: null }) }));
vi.mock("../components/Toast.jsx", () => ({ useToast: () => vi.fn() }));
vi.mock("../components/TemplateRunProvider.jsx", () => ({ useTemplateRun: () => null }));
vi.mock("../hooks/useSeo.js", () => ({ useSeo: vi.fn() }));
vi.mock("../lib/templates/templatesClient.js", () => ({
  listTemplates: vi.fn(async () => ({ templates: [], degraded: true })),
  getTemplate: vi.fn(async (key) => ({ template: { ...SEED_TEMPLATES.find((t) => t.template_key === key), version: 1 }, degraded: true })),
  estimateRun: vi.fn(async () => ({ estimate: { credits: 0, breakdown: [] } })),
  listRuns: vi.fn(async () => ({ runs: [] })),
  getRun: vi.fn(),
  startRun: vi.fn(),
  executeRun: vi.fn(),
  finishRun: vi.fn(),
  failRun: vi.fn(),
  resolveCompany: vi.fn(),
  splitPoints: (t) => [t],
}));

const Templates = (await import("./Templates.jsx")).default;
const at = (key) => render(
  <MemoryRouter initialEntries={[`/templates?key=${key}`]}><Templates /></MemoryRouter>,
);

describe("Templates — store unavailable (degraded)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a runnable template shows the preview-only notice and cannot run", async () => {
    at("account_brief");
    expect(await screen.findByText(/showing in preview only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run this template" })).toBeDisabled();
  });

  it("a hand-off template stays usable and shows no notice", async () => {
    at("competitor_change_monitor");
    const btn = await screen.findByRole("button", { name: "Set up the watchlist" });
    expect(btn).toBeEnabled();
    expect(screen.queryByText(/showing in preview only/i)).toBeNull();
  });
});
