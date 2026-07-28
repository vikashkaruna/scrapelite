// AdminHealth.integration.test.jsx — I-51.
//
// The single behaviour these tests exist to protect: an unconfigured component
// renders as its own visually distinct state, is excluded from the headline,
// and is excluded from uptime. Every other assertion here is secondary.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminHealth from "./AdminHealth.jsx";
import { ToastProvider } from "../../components/Toast.jsx";

const svc = vi.hoisted(() => ({
  getMonitoringSnapshot: vi.fn(),
  setJobEnabled: vi.fn(),
  runJobNow: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  getHealthSnapshot: vi.fn(),
}));

vi.mock("../../lib/monitoringService.js", () => svc);

function component(over = {}) {
  return {
    id: "supabase-db", label: "Supabase database", group: "database", critical: true,
    description: "PostgREST round-trip against a real table.",
    status: "ok", latencyMs: 90, latencyGrade: "fast", detail: {}, note: "",
    checkedAt: new Date().toISOString(), ...over,
  };
}

function snapshot(over = {}) {
  const components = over.components || [component()];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    overall: "ok",
    summary: { total: components.length, ok: components.length, degraded: 0, down: 0, unknown: 0, overall: "ok" },
    components,
    uptime: {},
    uptimeWindowHours: 24,
    historyAvailable: true,
    samplesInWindow: 10,
    recorded: false,
    groups: [
      { id: "platform", label: "Hosting & edge", icon: "server" },
      { id: "database", label: "Data & identity", icon: "database" },
      { id: "services", label: "External services", icon: "network" },
    ],
    ...over,
  };
}

const renderPage = () => render(<ToastProvider><AdminHealth /></ToastProvider>);

/**
 * The component card for a given label.
 *
 * Every component's label appears twice on this page — once on its card and
 * once in the benchmarks table — so a bare findByText is ambiguous by design
 * rather than by accident.
 */
async function cardFor(label) {
  const matches = await screen.findAllByText(label);
  const card = matches.map((n) => n.closest(".ops-health-card")).find(Boolean);
  if (!card) throw new Error(`No health card found for "${label}"`);
  return card;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  svc.getHealthSnapshot.mockResolvedValue(snapshot());
});

// ── Headline ─────────────────────────────────────────────────────────────────

describe("I-51 — AdminHealth: headline", () => {
  it("shows an operational headline when everything is up", async () => {
    renderPage();
    expect(await screen.findByText(/All monitored systems are operational/)).toBeInTheDocument();
    expect(screen.getByText("Service Health")).toBeInTheDocument();
  });

  it("shows a down headline when a critical component is unreachable", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      overall: "down",
      components: [component({ status: "down", note: "ECONNREFUSED", latencyMs: null, latencyGrade: null })],
      summary: { total: 1, ok: 0, degraded: 0, down: 1, unknown: 0, overall: "down" },
    }));
    renderPage();
    expect(await screen.findByText(/A critical system is unreachable/)).toBeInTheDocument();
    expect(screen.getByText("ECONNREFUSED")).toBeInTheDocument();
  });

  it("shows a degraded headline when something is slow", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      overall: "degraded",
      components: [component({ status: "degraded", note: "Responding slowly (3000ms).", latencyMs: 3000, latencyGrade: "slow" })],
      summary: { total: 1, ok: 0, degraded: 1, down: 0, unknown: 0, overall: "degraded" },
    }));
    renderPage();
    expect(await screen.findByText(/Something is slow or partially unavailable/)).toBeInTheDocument();
  });

  it("counts each status in the headline strip", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      overall: "degraded",
      components: [component(), component({ id: "email-resend", label: "Email (Resend)", group: "services", critical: false, status: "unknown" })],
      summary: { total: 2, ok: 1, degraded: 0, down: 0, unknown: 1, overall: "ok" },
    }));
    renderPage();
    expect(await screen.findByText("1 operational")).toBeInTheDocument();
    expect(screen.getByText("1 not checked")).toBeInTheDocument();
  });
});

// ── The unknown state ────────────────────────────────────────────────────────

describe("I-51 — AdminHealth: 'not checked' is its own state", () => {
  const withUnknown = snapshot({
    components: [
      component(),
      component({
        id: "payments-razorpay", label: "Payments (Razorpay)", group: "services",
        critical: false, status: "unknown", latencyMs: null, latencyGrade: null,
        note: "Not configured — needs RAZORPAY_KEY_ID.",
      }),
    ],
    summary: { total: 2, ok: 1, degraded: 0, down: 0, unknown: 1, overall: "ok" },
  });

  it("labels it 'Not checked', never 'Down'", async () => {
    svc.getHealthSnapshot.mockResolvedValue(withUnknown);
    renderPage();
    const card = await cardFor("Payments (Razorpay)");
    expect(within(card).getByText("Not checked")).toBeInTheDocument();
    expect(within(card).queryByText("Down")).not.toBeInTheDocument();
  });

  it("gives it a visually distinct card rather than a quiet green one", async () => {
    svc.getHealthSnapshot.mockResolvedValue(withUnknown);
    renderPage();
    const card = await cardFor("Payments (Razorpay)");
    expect(card.className).toContain("ops-health-unchecked");
    expect(card.className).not.toContain("ops-health-ok");
  });

  it("names the missing configuration", async () => {
    svc.getHealthSnapshot.mockResolvedValue(withUnknown);
    renderPage();
    expect(await screen.findByText(/needs RAZORPAY_KEY_ID/)).toBeInTheDocument();
  });

  it("explains that it is not an outage", async () => {
    svc.getHealthSnapshot.mockResolvedValue(withUnknown);
    renderPage();
    expect(await screen.findByText(/deliberately not counted as an outage/i)).toBeInTheDocument();
  });

  it("does not drag the headline down", async () => {
    svc.getHealthSnapshot.mockResolvedValue(withUnknown);
    renderPage();
    // The headline copy, not the pill text — "Operational" also labels each
    // healthy component's status pill.
    expect(await screen.findByText(/All monitored systems are operational/)).toBeInTheDocument();
  });

  it("shows no explanation banner when everything was checked", async () => {
    renderPage();
    await screen.findByText(/All monitored systems are operational/);
    expect(screen.queryByText(/deliberately not counted as an outage/i)).not.toBeInTheDocument();
  });
});

// ── Components & grouping ────────────────────────────────────────────────────

describe("I-51 — AdminHealth: components", () => {
  it("groups components under their section", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      components: [
        component(),
        component({ id: "netlify-site", label: "Netlify site", group: "platform" }),
        component({ id: "email-resend", label: "Email (Resend)", group: "services", critical: false }),
      ],
      summary: { total: 3, ok: 3, degraded: 0, down: 0, unknown: 0, overall: "ok" },
    }));
    renderPage();
    expect(await screen.findByText("Hosting & edge")).toBeInTheDocument();
    expect(screen.getByText("Data & identity")).toBeInTheDocument();
    expect(screen.getByText("External services")).toBeInTheDocument();
  });

  it("omits a group with no components rather than rendering an empty box", async () => {
    renderPage();
    await screen.findByText("Data & identity");
    expect(screen.queryByText("Hosting & edge")).not.toBeInTheDocument();
  });

  it("marks critical components", async () => {
    renderPage();
    const card = await cardFor("Supabase database");
    expect(within(card).getByText("Critical")).toBeInTheDocument();
  });

  it("shows probe detail such as the deploy branch", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      components: [component({
        id: "netlify-site", label: "Netlify site", group: "platform",
        detail: { branch: "main", state: "ready" },
      })],
    }));
    renderPage();
    expect(await screen.findByText("branch")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows latency with its per-component budget in the tooltip", async () => {
    renderPage();
    const latency = await screen.findAllByText("90ms");
    expect(latency[0].getAttribute("title")).toMatch(/fast ≤ 150ms, slow ≥ 800ms/);
  });
});

// ── Uptime ───────────────────────────────────────────────────────────────────

describe("I-51 — AdminHealth: uptime", () => {
  it("shows uptime, average and peak latency from stored samples", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({
      uptime: { "supabase-db": { samples: 24, uptimePct: 99.5, avgLatencyMs: 120, maxLatencyMs: 480 } },
    }));
    renderPage();
    expect(await screen.findAllByText("99.5%")).toHaveLength(2); // card + benchmark row
    expect(screen.getAllByText("120ms").length).toBeGreaterThan(0);
    expect(screen.getByText("480ms")).toBeInTheDocument();
  });

  // "0%" would be a claim of total outage; "no data" is the truth.
  it("says 'no data' rather than 0% when there are no samples", async () => {
    renderPage();
    expect(await screen.findByText("no data")).toBeInTheDocument();
  });

  it("distinguishes history-off from no-samples-yet", async () => {
    svc.getHealthSnapshot.mockResolvedValue(snapshot({ historyAvailable: false }));
    renderPage();
    expect(await screen.findByText(/Uptime history is off/)).toBeInTheDocument();

    svc.getHealthSnapshot.mockResolvedValue(snapshot({ historyAvailable: true, samplesInWindow: 0 }));
    renderPage();
    expect(await screen.findByText(/No samples in this window yet/)).toBeInTheDocument();
  });

  it("changes the uptime window", async () => {
    renderPage();
    await screen.findByText(/All monitored systems are operational/);
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await waitFor(() =>
      expect(svc.getHealthSnapshot).toHaveBeenLastCalledWith({ windowHours: 168, record: false }));
  });
});

// ── Controls ─────────────────────────────────────────────────────────────────

describe("I-51 — AdminHealth: controls", () => {
  it("re-probes on demand without recording", async () => {
    renderPage();
    await screen.findByText(/All monitored systems are operational/);
    fireEvent.click(screen.getByRole("button", { name: /Probe now/ }));
    await waitFor(() => expect(svc.getHealthSnapshot).toHaveBeenCalledTimes(2));
    expect(svc.getHealthSnapshot).toHaveBeenLastCalledWith({ windowHours: 24, record: false });
  });

  it("probes and records when asked", async () => {
    renderPage();
    await screen.findByText(/All monitored systems are operational/);
    fireEvent.click(screen.getByRole("button", { name: /Probe & record/ }));
    await waitFor(() =>
      expect(svc.getHealthSnapshot).toHaveBeenLastCalledWith({ windowHours: 24, record: true }));
  });

  it("shows the server's error rather than a blank page", async () => {
    svc.getHealthSnapshot.mockRejectedValue(new Error("Invalid token signature."));
    renderPage();
    expect(await screen.findByText("Invalid token signature.")).toBeInTheDocument();
  });

  it("can stop auto-refreshing", async () => {
    renderPage();
    await screen.findByText(/All monitored systems are operational/);
    const toggle = screen.getByLabelText(/Auto-refresh/);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
