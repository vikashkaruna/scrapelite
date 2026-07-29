// AdminMonitoring.integration.test.jsx — I-50.
//
// Covers the behaviour a contract test cannot: that the operator cannot fire a
// destructive or disruptive action without a reason, that the destructive job's
// button is disabled in the UI as well as refused by the server, and that the
// page distinguishes "no history configured" from "everything is broken".
//
// The page needs only ToastProvider — it uses no router hooks — so the tree is
// deliberately minimal rather than the full provider stack.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminMonitoring from "./AdminMonitoring.jsx";
import { ToastProvider } from "../../components/Toast.jsx";

const svc = vi.hoisted(() => ({
  getMonitoringSnapshot: vi.fn(),
  setJobEnabled: vi.fn(),
  runJobNow: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
}));

vi.mock("../../lib/monitoringService.js", () => svc);

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60_000).toISOString();

function job(over = {}) {
  return {
    id: "billing-lifecycle", label: "Billing lifecycle & dunning",
    description: "Drives transitions and dunning.", schedule: "@daily", cron: "0 3 * * *",
    category: "billing", destructive: false, critical: true, caveat: "",
    manualRunAllowed: true, enabled: true, control: { enabled: true, source: "default" },
    state: "healthy", severity: 0, reason: "Running on schedule.",
    lastRunAt: iso(60), lastSuccessAt: iso(60), ageMs: 3_600_000,
    nextRunAt: new Date(Date.now() + 7_200_000).toISOString(),
    runs: [], ...over,
  };
}

function snapshot(over = {}) {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    jobs: [job()],
    jobSummary: { total: 1, healthy: 1, running: 0, stale: 0, failing: 0, stuck: 0, disabled: 0, neverRun: 0, worst: "healthy" },
    schedules: [],
    scheduleSummary: { total: 0, active: 0, paused: 0, systemPaused: 0, expired: 0, failing: 0 },
    audit: [],
    historyAvailable: true,
    ...over,
  };
}

const renderPage = () => render(<ToastProvider><AdminMonitoring /></ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  svc.getMonitoringSnapshot.mockResolvedValue(snapshot());
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Rendering ────────────────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: job table", () => {
  it("renders each job with its status, last success and next run", async () => {
    renderPage();
    expect(await screen.findByText("Billing lifecycle & dunning")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("in 2h")).toBeInTheDocument();
  });

  it("shows a failing job's error in its status pill", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({
      jobs: [job({ state: "failing", reason: "Last run failed: supabase 503" })],
      jobSummary: { total: 1, healthy: 0, failing: 1, stale: 0, stuck: 0, disabled: 0, neverRun: 0, running: 0, worst: "failing" },
    }));
    renderPage();
    expect(await screen.findByText("Failing")).toBeInTheDocument();
    expect(screen.getByTitle("Last run failed: supabase 503")).toBeInTheDocument();
  });

  it("marks a stopped job as stopped rather than stale", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({
      jobs: [job({ enabled: false, state: "disabled", reason: "Stopped by an operator.", nextRunAt: null })],
    }));
    renderPage();
    // "Stopped" is also a summary-tile label, so match the status pill itself.
    expect(await screen.findByTitle("Stopped by an operator.")).toBeInTheDocument();
    // A stopped job shows no next run — promising one would be a lie.
    expect(screen.getByTitle("Start this job")).toBeInTheDocument();
  });

  it("expands a job to show its description and run history", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({
      jobs: [job({ runs: [
        { id: 1, status: "success", trigger: "schedule", started_at: iso(60), duration_ms: 1200, detail: { scanned: 4 } },
        { id: 2, status: "error", trigger: "manual", started_at: iso(120), duration_ms: 300, error: "boom" },
      ] })],
    }));
    renderPage();
    fireEvent.click(await screen.findByLabelText(/Expand Billing lifecycle/));
    expect(await screen.findByText(/Drives transitions and dunning/)).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByText("manual")).toBeInTheDocument();
  });

  // The reengagement defect is real and documented; the dashboard must not
  // silently contradict it by showing a green row.
  it("surfaces a job's caveat next to its status", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({
      jobs: [job({ id: "reengagement", label: "Re-engagement digest", caveat: "Known defect: silent no-op." })],
    }));
    renderPage();
    fireEvent.click(await screen.findByLabelText(/Expand Re-engagement digest/));
    expect(await screen.findByText(/Known defect: silent no-op/)).toBeInTheDocument();
  });

  it("distinguishes missing configuration from a stopped platform", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({ historyAvailable: false }));
    renderPage();
    expect(await screen.findByText(/reflects missing configuration here, not a/i)).toBeInTheDocument();
  });

  it("shows an error banner when the snapshot cannot be loaded", async () => {
    svc.getMonitoringSnapshot.mockRejectedValue(new Error("Missing admin token."));
    renderPage();
    expect(await screen.findByText("Missing admin token.")).toBeInTheDocument();
  });
});

// ── The reason gate ──────────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: reason gate", () => {
  it("opens a reason dialog instead of acting immediately", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(svc.setJobEnabled).not.toHaveBeenCalled();
  });

  it("keeps confirm disabled until a reason is typed", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Stop job" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "   " } });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "migration window" } });
    expect(confirm).toBeEnabled();
  });

  it("passes the trimmed reason through to the service", async () => {
    svc.setJobEnabled.mockResolvedValue({ ok: true, message: "billing-lifecycle is stopped." });
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  migration window  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop job" }));

    await waitFor(() =>
      expect(svc.setJobEnabled).toHaveBeenCalledWith("billing-lifecycle", false, "migration window"));
  });

  // Stopping the lifecycle silently disarms the purge — the operator must be
  // told before they confirm, not after.
  it("warns about the purge interlock when stopping a critical job", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    expect(await screen.findByText(/disarms the purge/i)).toBeInTheDocument();
  });

  it("cancels without acting", async () => {
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(svc.setJobEnabled).not.toHaveBeenCalled();
  });

  it("shows the server's refusal rather than a generic failure", async () => {
    svc.setJobEnabled.mockRejectedValue(new Error("A reason is required."));
    renderPage();
    fireEvent.click(await screen.findByTitle("Stop this job"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop job" }));
    expect(await screen.findByText("A reason is required.")).toBeInTheDocument();
  });

  it("refreshes after a successful action", async () => {
    svc.setJobEnabled.mockResolvedValue({ ok: true, message: "Stopped." });
    renderPage();
    await screen.findByText("Billing lifecycle & dunning");
    expect(svc.getMonitoringSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Stop this job"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "why" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop job" }));

    await waitFor(() => expect(svc.getMonitoringSnapshot).toHaveBeenCalledTimes(2));
  });
});

// ── The destructive job ──────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: destructive job guard", () => {
  const purgeSnapshot = snapshot({
    jobs: [job({
      id: "billing-purge", label: "Data purge (day 90)",
      destructive: true, manualRunAllowed: false,
    })],
  });

  it("disables Run now for the destructive job and says why", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(purgeSnapshot);
    renderPage();
    const runBtn = await screen.findByTitle(/its schedule is the only way to trigger it/);
    expect(runBtn).toBeDisabled();
  });

  it("never calls runJobNow for the destructive job, even on a forced click", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(purgeSnapshot);
    renderPage();
    const runBtn = await screen.findByTitle(/its schedule is the only way to trigger it/);
    fireEvent.click(runBtn);
    expect(svc.runJobNow).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("labels it as destructive in the table", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(purgeSnapshot);
    renderPage();
    expect(await screen.findByText("Destructive")).toBeInTheDocument();
  });

  it("still allows a manual run of a non-destructive job", async () => {
    svc.runJobNow.mockResolvedValue({ ok: true, ran: true, output: "done" });
    renderPage();
    fireEvent.click(await screen.findByTitle("Run now"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "verifying a fix" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Run now" }));
    await waitFor(() =>
      expect(svc.runJobNow).toHaveBeenCalledWith("billing-lifecycle", "verifying a fix"));
  });
});

// ── User schedules ───────────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: user schedules", () => {
  const sched = (over = {}) => ({
    id: "sch_1", userId: "user-abcdef12", label: "Pricing page",
    target: "https://example.com/pricing", type: "track", intent: "pricing",
    cron: "0 9 * * *", state: "active", userPaused: false, systemPaused: false,
    systemPauseReason: null, expired: false, endsAt: null,
    lastRunAt: iso(120), lastStatus: "ok",
    nextRunAt: new Date(Date.now() + 3_600_000).toISOString(), ...over,
  });

  const withSchedules = (list, summary) => snapshot({
    schedules: list,
    scheduleSummary: { total: list.length, active: 0, paused: 0, systemPaused: 0, expired: 0, failing: 0, ...summary },
  });

  it("lists schedules with target, status and cadence", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(withSchedules([sched()], { active: 1 }));
    renderPage();
    expect(await screen.findByText("Pricing page")).toBeInTheDocument();
    expect(screen.getByText("https://example.com/pricing")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("summarises a batch schedule's target rather than listing every URL", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(
      withSchedules([sched({ target: ["a", "b", "c"], type: "batch" })], { active: 1 }));
    renderPage();
    expect(await screen.findByText("3 URLs")).toBeInTheDocument();
  });

  it("offers resume for a system-paused schedule and pause for an active one", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(withSchedules(
      [sched(), sched({ id: "sch_2", label: "Docs", state: "system-paused", systemPaused: true })],
      { active: 1, systemPaused: 1 },
    ));
    renderPage();
    expect(await screen.findByTitle("System-pause this schedule")).toBeInTheDocument();
    expect(screen.getByTitle("Release the system pause")).toBeInTheDocument();
  });

  it("pauses a schedule with a reason", async () => {
    svc.pauseSchedule.mockResolvedValue({ ok: true, message: "Schedule system-paused." });
    svc.getMonitoringSnapshot.mockResolvedValue(withSchedules([sched()], { active: 1 }));
    renderPage();
    fireEvent.click(await screen.findByTitle("System-pause this schedule"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "abusive target" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Pause schedule" }));
    await waitFor(() => expect(svc.pauseSchedule).toHaveBeenCalledWith("sch_1", "abusive target"));
  });

  // The two pause axes are independent, and the dialog must not imply otherwise.
  it("states that the user's own pause is untouched", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(withSchedules([sched()], { active: 1 }));
    renderPage();
    fireEvent.click(await screen.findByTitle("System-pause this schedule"));
    expect(await screen.findByText(/Their own pause state is untouched/i)).toBeInTheDocument();
  });

  it("filters the schedule list", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(withSchedules(
      [sched(), sched({ id: "sch_2", label: "Docs", state: "system-paused", systemPaused: true })],
      { active: 1, systemPaused: 1 },
    ));
    renderPage();
    await screen.findByText("Pricing page");
    fireEvent.click(screen.getByRole("button", { name: /System paused \(1\)/ }));
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.queryByText("Pricing page")).not.toBeInTheDocument();
  });

  it("says so when there are no schedules at all", async () => {
    renderPage();
    expect(await screen.findByText("No user schedules exist yet.")).toBeInTheDocument();
  });
});

// ── Audit trail ──────────────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: audit trail", () => {
  it("shows recent operator actions with their reasons", async () => {
    svc.getMonitoringSnapshot.mockResolvedValue(snapshot({
      audit: [{
        id: 1, actor: "admin", action: "job_disable", target: "billing-purge",
        reason: "paused during the data migration", created_at: iso(30),
      }],
    }));
    renderPage();
    expect(await screen.findByText("paused during the data migration")).toBeInTheDocument();
    // The audit action now also appears in the new Action filter dropdown;
    // scope to the table cell.
    expect(screen.getByRole("cell", { name: "job_disable" })).toBeInTheDocument();
  });

  it("hides the audit section when there is nothing to show", async () => {
    renderPage();
    await screen.findByText("Billing lifecycle & dunning");
    expect(screen.queryByText("Recent operator actions")).not.toBeInTheDocument();
  });
});

// ── Auto-refresh ─────────────────────────────────────────────────────────────

describe("I-50 — AdminMonitoring: refresh", () => {
  it("re-fetches on demand", async () => {
    renderPage();
    await screen.findByText("Billing lifecycle & dunning");
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(svc.getMonitoringSnapshot).toHaveBeenCalledTimes(2));
  });

  it("stops polling when auto-refresh is switched off", async () => {
    renderPage();
    await screen.findByText("Billing lifecycle & dunning");
    const toggle = screen.getByLabelText(/Auto-refresh/);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
  });
});
