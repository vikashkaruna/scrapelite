// LocalDirectoryPanel.test.jsx — stored shapes, verbatim coverage, valid resolutions.
// Fixtures mirror /local-directory/* responses and 0058's columns.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LocalDirectoryPanel, { matchState, IGNORE_REASONS } from "./LocalDirectoryPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { coverageClaim } from "../../lib/discoverability/directorySources.js";

const toast = vi.fn();
vi.mock("../Toast.jsx", () => ({ useToast: () => toast }));

const sources = [
  { id: "gbp", label: "Google Business Profile", tier: "authoritative", acquisition: "authorized_api" },
  { id: "justdial", label: "Justdial", tier: "aggregator", acquisition: "public_page" },
  { id: "mca", label: "MCA registry", tier: "registry", acquisition: "public_page" },
];

function mockApi({ records = [{ id: "tr-1" }], checks = [], full = null, listings = [] } = {}) {
  vi.spyOn(discoverability, "localDirectorySchema").mockResolvedValue({ sources });
  vi.spyOn(discoverability, "listTruthRecords").mockResolvedValue({ records });
  vi.spyOn(discoverability, "listDirectoryListings").mockResolvedValue({ listings });
  vi.spyOn(discoverability, "listLocalChecks").mockResolvedValue({ checks });
  vi.spyOn(discoverability, "getLocalCheck").mockResolvedValue(full);
}

const storedCheck = {
  check: { id: "chk-1", checked_count: 2, nap_score: 70 },
  matches: [
    { source_id: "gbp", match_score: 100, mismatched: [] },
    { source_id: "justdial", match_score: 55, mismatched: ["phone"] },
  ],
  findings: [
    { id: "f1", code: "LD-02", severity: "high", detail: "Justdial lists a different phone number.", fields: ["phone"], source_id: "justdial" },
    { id: "f2", code: "LD-04", severity: "medium", detail: "Already handled.", fields: [], resolved_at: "2026-09-01", resolution: "listing_updated" },
  ],
};

describe("matchState", () => {
  it("derives the state 0058 never stored", () => {
    expect(matchState({ match_score: 100, mismatched: [] })).toBe("match");
    expect(matchState({ match_score: 55, mismatched: ["phone"] })).toBe("mismatch");
    expect(matchState({ match_score: null, mismatched: [] })).toBe("unreadable");
    expect(matchState(null)).toBe("unchecked");
  });
});

describe("LocalDirectoryPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("requires a truth record before auditing listings", async () => {
    mockApi({ records: [] });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("Truth Record Required")).toBeTruthy();
  });

  it("renders coverageClaim() verbatim from the stored checked count", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText(coverageClaim({ checked: 2, region: "in" }))).toBeTruthy();
  });

  it("names unchecked sources as excluded rather than scoring them 0", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("Matches the record")).toBeTruthy();
    expect(screen.getByText("Mismatch")).toBeTruthy();
    expect(screen.getByText("Unchecked (excluded)")).toBeTruthy();
  });

  it("shows findings from their stored columns, and resolved ones as resolved", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("LD-02")).toBeTruthy();
    expect(screen.getByText("Justdial lists a different phone number.")).toBeTruthy();
    expect(screen.getByText("Fields: phone")).toBeTruthy();
    expect(screen.getByText("Resolved (listing updated)")).toBeTruthy();
    // Only the open finding offers controls.
    expect(screen.getAllByRole("button", { name: "Not a Conflict" })).toHaveLength(1);
  });

  it("🔴 resolves with a value the route accepts", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    vi.spyOn(discoverability, "resolveLocalFinding").mockResolvedValue({ finding: {} });
    render(<LocalDirectoryPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Not a Conflict" }));
    await waitFor(() => expect(discoverability.resolveLocalFinding).toHaveBeenCalledWith("f1", "not_a_conflict", { workspace_id: "ws-1" }));
  });

  it("🔴 reports the NAP score from napScore()'s object, not NaN", async () => {
    mockApi();
    vi.spyOn(discoverability, "runLocalCheck").mockResolvedValue({ score: { score: 87.6, coverage: 0.5, checkedCount: 2 } });
    render(<LocalDirectoryPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Run NAP Check/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Local NAP check complete (score 88/100).", "check"));
    expect(discoverability.runLocalCheck).toHaveBeenCalledWith({ truth_record_id: "tr-1", region: "in", workspace_id: "ws-1" });
  });

  it("says there is no score yet when nothing was comparable", async () => {
    mockApi();
    vi.spyOn(discoverability, "runLocalCheck").mockResolvedValue({ score: { score: null, coverage: 0, checkedCount: 0 } });
    render(<LocalDirectoryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Run NAP Check/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/no score yet/), "check"));
  });

  it("renders portal configuration links and action hints for directory sources", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    const portalLink = await screen.findByRole("link", { name: /Configure on Google Business Profile/ });
    expect(portalLink).toHaveAttribute("href", "https://business.google.com/");
    expect(screen.getByText(/Claim & manage official profile on Google Search & Maps/)).toBeTruthy();
  });

  it("declares a listing URL for a directory source", async () => {
    mockApi({ records: [{ id: "tr-1" }], checks: [{ id: "chk-1" }], full: storedCheck, listings: [] });
    vi.spyOn(discoverability, "upsertDirectoryListing").mockResolvedValue({ ok: true, listing: { id: "l-1" } });
    render(<LocalDirectoryPanel workspaceId="ws-1" />);
    const declareButtons = await screen.findAllByRole("button", { name: "Declare URL" });
    expect(declareButtons.length).toBeGreaterThan(0);
    const inputs = screen.getAllByPlaceholderText(/Enter listing URL/);
    fireEvent.change(inputs[0], { target: { value: "https://business.google.com/profile/acme" } });
    fireEvent.click(declareButtons[0]);
    await waitFor(() => expect(discoverability.upsertDirectoryListing).toHaveBeenCalledWith({
      truth_record_id: "tr-1",
      source_id: "gbp",
      listing_url: "https://business.google.com/profile/acme",
      acquisition: "declared_url",
      workspace_id: "ws-1",
    }));
  });

  it("displays readable finding titles, source attribution, why it matters, and action explanations", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("A listing shows a different phone number")).toBeTruthy();
    expect(screen.getByText(/Directory Source:/)).toHaveTextContent("Directory Source: Justdial");
    expect(screen.getAllByText(/Why this matters:/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Fixed external profile to match truth record/)).toBeTruthy();
    expect(screen.getByText(/Legitimate variance/)).toBeTruthy();
  });
});

describe("LocalDirectoryPanel — ignoring sources that do not apply", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("records an ignore with a reason for the selected truth record", async () => {
    mockApi();
    vi.spyOn(discoverability, "listDirectoryIgnores").mockResolvedValue({ ignores: [] });
    const ignore = vi.spyOn(discoverability, "ignoreDirectorySource").mockResolvedValue({ ignore: {} });
    render(<LocalDirectoryPanel workspaceId="ws-1" />);
    await screen.findByText("Justdial");
    const buttons = await screen.findAllByRole("button", { name: /Not applicable\? Ignore/ });
    fireEvent.click(buttons[1]);
    fireEvent.click(screen.getByRole("button", { name: "Ignore source" }));
    await waitFor(() => expect(ignore).toHaveBeenCalledWith({
      truth_record_id: "tr-1", source_id: "justdial", reason: IGNORE_REASONS[0], workspace_id: "ws-1",
    }));
  });

  it("hides ignored sources until asked, shows why, and restores them", async () => {
    mockApi();
    vi.spyOn(discoverability, "listDirectoryIgnores").mockResolvedValue({
      ignores: [{ source_id: "mca", reason: "Not relevant to our industry", created_at: "2026-09-15" }],
    });
    const restore = vi.spyOn(discoverability, "restoreDirectorySource").mockResolvedValue({ restored: true });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText(/2 Applicable · 1 ignored/)).toBeTruthy();
    expect(screen.queryByText("MCA registry")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show ignored (1)" }));
    expect(await screen.findByText("MCA registry")).toBeTruthy();
    expect(screen.getByText("Not relevant to our industry")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ truth_record_id: "tr-1", source_id: "mca" })));
  });

  it("filters directory cards by search query", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("Google Business Profile")).toBeInTheDocument();
    expect(screen.getAllByText("Justdial").length).toBeGreaterThan(0);

    const searchInput = screen.getByPlaceholderText(/Search directory sources/);
    fireEvent.change(searchInput, { target: { value: "Justdial" } });

    expect(screen.getAllByText("Justdial").length).toBeGreaterThan(0);
    expect(screen.queryByText("Google Business Profile")).toBeNull();
  });

  it("filters directory cards by status tab and displays collapsible details", async () => {
    mockApi({ checks: [{ id: "chk-1" }], full: storedCheck });
    render(<LocalDirectoryPanel />);
    expect(await screen.findByText("Google Business Profile")).toBeInTheDocument();

    // Filter by Mismatches
    const mismatchTab = screen.getByRole("button", { name: /Mismatches/ });
    fireEvent.click(mismatchTab);

    // Justdial has match_score: 55, mismatched: ["phone"] -> mismatch
    expect(screen.getAllByText("Justdial").length).toBeGreaterThan(0);
    // GBP has match_score: 100, mismatched: [] -> match, so filtered out
    expect(screen.queryByText("Google Business Profile")).toBeNull();

    // Findings collapsible details
    expect(screen.getAllByText("Finding details, field diffs & correction actions").length).toBeGreaterThan(0);
  });
});
