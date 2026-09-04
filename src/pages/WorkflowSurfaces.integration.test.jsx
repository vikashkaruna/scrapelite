// src/pages/WorkflowSurfaces.integration.test.jsx
//
// Covers TS-9's S-02 and S-24 — the last two live-staging cases that were
// really render assertions rather than session assertions.
//
//   S-02  /templates renders the catalogue for a signed-in user.
//   S-24  /admin/monitoring lists the two new crons, so an operator can see
//         that watchlist-monitor and bulk-runner exist, are scheduled, and have
//         run history — the whole point of registering them.
//
// ── WHY THESE DO NOT NEED A LIVE ACCOUNT ────────────────────────────────────
//
// Neither asserts anything about authentication. S-02 asserts that a catalogue
// renders from the templates the app ships; S-24 asserts that the admin
// dashboard renders the jobs the registry declares. Both branches are decided
// by data the test can supply directly. What a live pass adds is confidence
// that the deployed build is the one under test — a different claim, covered by
// the smoke suite and the prerender gate.
//
// ── THE ASSERTION THAT MATTERS IN S-24 ──────────────────────────────────────
//
// This repository has an incident about four crons sitting unscheduled for
// months with no error anywhere, because `AUTOMATION_JOBS` and `netlify.toml`
// disagreed and nothing checked. `cron-registry-parity.test.js` closes that at
// the config layer. This closes the layer above it: that a job which IS
// registered actually reaches the operator's screen. A job nobody can see is
// only marginally better than a job nobody scheduled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AUTOMATION_JOBS } from "../lib/monitoringModel.js";

const SIGNED_IN = { id: "user-1", email: "u1@example.com" };

vi.mock("../components/AuthProvider.jsx", () => ({
  useAuth: () => ({ user: SIGNED_IN, openAuth: vi.fn(), closeAuth: vi.fn() }),
  default: ({ children }) => children,
}));
vi.mock("../components/PersonaProvider.jsx", () => ({
  usePersona: () => ({ personaId: "sales", userName: "Test", onboarded: true }),
  default: ({ children }) => children,
}));
vi.mock("../components/Toast.jsx", () => ({
  useToast: () => vi.fn(),
  ToastProvider: ({ children }) => children,
}));
vi.mock("../hooks/useSeo.js", () => ({ useSeo: vi.fn() }));

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe("S-02 · /templates — the catalogue renders for a signed-in user", () => {
  it("lists the shipped templates", async () => {
    const { SEED_TEMPLATES } = await import("../lib/templates/seedTemplates.js");
    const published = SEED_TEMPLATES.filter((t) => t.status === "published");

    vi.doMock("../lib/templates/templatesClient.js", () => ({
      listTemplates: vi.fn(async () => ({ ok: true, templates: published, degraded: false })),
      getTemplate: vi.fn(async () => ({ ok: true })),
      runTemplate: vi.fn(async () => ({ ok: true })),
      estimateTemplate: vi.fn(async () => ({ ok: true, estimate: { credits: 1, breakdown: [] } })),
      duplicateTemplate: vi.fn(async () => ({ ok: true })),
    }));

    const Templates = (await import("./Templates.jsx")).default;
    render(<MemoryRouter><Templates /></MemoryRouter>);

    await waitFor(() => {
      // Derived from the seeds rather than a literal: adding a template must
      // not fail a test about the catalogue rendering at all.
      expect(screen.getByText(published[0].title)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("does not render a signed-out gate for an authenticated user", async () => {
    vi.doMock("../lib/templates/templatesClient.js", () => ({
      listTemplates: vi.fn(async () => ({ ok: true, templates: [], degraded: false })),
      getTemplate: vi.fn(async () => ({ ok: true })),
      runTemplate: vi.fn(async () => ({ ok: true })),
      estimateTemplate: vi.fn(async () => ({ ok: true, estimate: { credits: 1, breakdown: [] } })),
      duplicateTemplate: vi.fn(async () => ({ ok: true })),
    }));
    const Templates = (await import("./Templates.jsx")).default;
    render(<MemoryRouter><Templates /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /create a free account/i })).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("S-24 · /admin/monitoring — an operator can see the new crons", () => {
  /** A snapshot shaped like the real endpoint's, built FROM the registry. */
  function snapshotFromRegistry() {
    return {
      ok: true,
      jobs: AUTOMATION_JOBS.map((j) => ({
        id: j.id,
        label: j.label,
        schedule: j.schedule,
        cron: j.cron,
        description: j.description,
        destructive: j.destructive,
        manualRunAllowed: j.manualRunAllowed,
        enabled: true,
        source: "default",
        status: "healthy",
        lastSuccessAt: new Date().toISOString(),
        nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
        runs: [],
      })),
      schedules: [],
      jobSummary: { total: AUTOMATION_JOBS.length, neverRun: 0, stopped: 0 },
      scheduleSummary: { total: 0 },
      supabaseConfigured: true,
    };
  }

  async function renderDashboard() {
    vi.doMock("../lib/monitoringService.js", () => ({
      getMonitoringSnapshot: vi.fn(async () => snapshotFromRegistry()),
      setJobEnabled: vi.fn(async () => ({ ok: true })),
      runJobNow: vi.fn(async () => ({ ok: true })),
      pauseSchedule: vi.fn(async () => ({ ok: true })),
      resumeSchedule: vi.fn(async () => ({ ok: true })),
      getHealthSnapshot: vi.fn(async () => ({ ok: true, components: [] })),
    }));
    const AdminMonitoring = (await import("./admin/AdminMonitoring.jsx")).default;
    render(<MemoryRouter><AdminMonitoring /></MemoryRouter>);
  }

  it("🔴 renders the watchlist monitor (PRD 4's engine)", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/competitor watchlist monitor/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("🔴 renders the bulk enrichment runner (PRD 3's engine)", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/bulk enrichment runner/i)).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it("renders EVERY registered job — a job nobody can see is barely better than one nobody scheduled", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(AUTOMATION_JOBS[0].label)).toBeInTheDocument();
    }, { timeout: 5000 });
    for (const job of AUTOMATION_JOBS) {
      expect(screen.getByText(job.label), `${job.id} must be visible to an operator`)
        .toBeInTheDocument();
    }
  });

  it("shows each new cron's cadence, so a wrong schedule is visible rather than assumed", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/competitor watchlist monitor/i)).toBeInTheDocument();
    }, { timeout: 5000 });
    // The PLATFORM jobs table renders the raw schedule string, which is the
    // right call for an ops screen: `@hourly` and `*/5 * * * *` are exact,
    // where a humanised label is an extra place to be wrong. (describeCron IS
    // used for USER schedules further down the same page — and writing this
    // test is what exposed it mislabelling every sub-daily cron as "Daily",
    // fixed separately in schedulerService.js.)
    const wl = AUTOMATION_JOBS.find((j) => j.id === "watchlist-monitor");
    const br = AUTOMATION_JOBS.find((j) => j.id === "bulk-runner");
    expect(wl.schedule).toBe("@hourly");
    expect(br.schedule).toBe("*/5 * * * *");
    expect(screen.getAllByText(wl.schedule).length).toBeGreaterThan(0);
    expect(screen.getAllByText(br.schedule).length).toBeGreaterThan(0);
  });
});
