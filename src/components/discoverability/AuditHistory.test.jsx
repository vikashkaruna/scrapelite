// AuditHistory.test.jsx — "what have I audited?", across every target.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AuditHistory, { resultOf, scoreBand } from "./AuditHistory.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

const row = (id, over = {}) => ({
  id,
  target_url: `https://example.com/${id}`,
  status: "completed",
  audit_profile: "balanced",
  device_profile: "mobile",
  created_at: new Date().toISOString(),
  audit_results: [{ final_score: 82, critical_count: 0 }],
  ...over,
});

describe("pure helpers", () => {
  it("reads an embedded result whether PostgREST returned an object or an array", () => {
    expect(resultOf({ audit_results: [{ final_score: 1 }] })).toEqual({ final_score: 1 });
    expect(resultOf({ audit_results: { final_score: 2 } })).toEqual({ final_score: 2 });
    expect(resultOf({})).toBeNull();
  });

  it("bands scores, and gives an unmeasured score no band", () => {
    expect(scoreBand(80)).toBe("good");
    expect(scoreBand(60)).toBe("fair");
    expect(scoreBand(59.9)).toBe("poor");
    expect(scoreBand(NaN)).toBe("none");
  });
});

describe("AuditHistory", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists audits and opens the one clicked", async () => {
    vi.spyOn(discoverability, "listAudits").mockResolvedValue({ audits: [row("a1"), row("a2")] });
    const onOpen = vi.fn();
    render(<AuditHistory onOpen={onOpen} />);
    const first = await screen.findByTitle("Open the report for https://example.com/a1");
    fireEvent.click(first);
    expect(onOpen).toHaveBeenCalledWith("a1");
    expect(screen.getAllByText("82")).toHaveLength(2);
  });

  it("🔴 shows a failed audit, disabled, rather than hiding it", async () => {
    vi.spyOn(discoverability, "listAudits").mockResolvedValue({
      audits: [row("f1", { status: "failed", error: "Fetch timed out", audit_results: [] })],
    });
    render(<AuditHistory onOpen={vi.fn()} />);
    const failed = await screen.findByTitle("Fetch timed out");
    expect(failed.disabled).toBe(true);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("marks a running audit without inventing a score", async () => {
    vi.spyOn(discoverability, "listAudits").mockResolvedValue({
      audits: [row("r1", { status: "running", audit_results: [] })],
    });
    render(<AuditHistory />);
    expect(await screen.findByText("running")).toBeTruthy();
    expect(screen.getByText("…")).toBeTruthy();
  });

  it("offers a first-run message when there is nothing yet", async () => {
    vi.spyOn(discoverability, "listAudits").mockResolvedValue({ audits: [] });
    render(<AuditHistory />);
    expect(await screen.findByText("No audits yet")).toBeTruthy();
  });

  it("surfaces a load failure instead of an empty list", async () => {
    vi.spyOn(discoverability, "listAudits").mockRejectedValue(new Error("Service unavailable"));
    render(<AuditHistory />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Service unavailable")).toBeTruthy();
  });

  it("filters by URL and says when nothing matches", async () => {
    vi.spyOn(discoverability, "listAudits").mockResolvedValue({ audits: [row("pricing"), row("blog")] });
    render(<AuditHistory />);
    await screen.findByTitle("Open the report for https://example.com/pricing");
    const search = screen.getByLabelText("Filter audits by URL");
    fireEvent.change(search, { target: { value: "blog" } });
    expect(screen.queryByTitle("Open the report for https://example.com/pricing")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/No audits match/)).toBeTruthy();
  });

  it("pages with Load more when a full page came back", async () => {
    const page = Array.from({ length: 25 }, (_, i) => row(`p${i}`));
    const spy = vi.spyOn(discoverability, "listAudits")
      .mockResolvedValueOnce({ audits: page })
      .mockResolvedValueOnce({ audits: [row("last")] });
    render(<AuditHistory />);
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 })));
    expect(await screen.findByTitle("Open the report for https://example.com/last")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("scopes the listing to the active workspace", async () => {
    const spy = vi.spyOn(discoverability, "listAudits").mockResolvedValue({ audits: [] });
    render(<AuditHistory workspaceId="ws-1" />);
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "ws-1" })));
    expect(screen.getByText(/in this workspace/)).toBeTruthy();
  });
});
