// BusinessTruthPanel.test.jsx — create, propose, submit, and a SECOND person promotes.
// Fixtures mirror what /api/discoverability/business-truth actually returns.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BusinessTruthPanel, { PROPOSAL_FIELDS } from "./BusinessTruthPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { TRUTH_FIELDS } from "../../lib/discoverability/businessTruth.js";

const toast = vi.fn();
vi.mock("../Toast.jsx", () => ({ useToast: () => toast }));

const fact = (field, value) => ({ field, value, source: "declared" });
const version = (over = {}) => ({
  id: "v1", record_id: "rec-1", version_no: 1, state: "draft", origin: "manual",
  proposed_by: "someone-else", fields_json: { legal_name: fact("legal_name", "Acme Pvt Ltd") }, ...over,
});
const full = ({ versions = [version()], conflicts = [], canonical = null } = {}) => ({
  record: { id: "rec-1", canonical_domain: "acme.example", display_name: "Acme", versions, conflicts },
  canonical,
  canonical_state: canonical ? "approved" : "none_approved",
});

function mockApi({ records = [{ id: "rec-1", canonical_domain: "acme.example", display_name: "Acme" }], record = full(), diff = null } = {}) {
  vi.spyOn(discoverability, "listTruthRecords").mockResolvedValue({ records });
  vi.spyOn(discoverability, "getTruthRecord").mockResolvedValue(record);
  vi.spyOn(discoverability, "truthDiff").mockResolvedValue(diff);
}

describe("BusinessTruthPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("only proposes fields the route accepts", () => {
    for (const id of PROPOSAL_FIELDS) expect(TRUTH_FIELDS[id]).toBeTruthy();
  });

  it("🔴 loads the FULL record, so versions and the promote path actually render", async () => {
    mockApi({ record: full({ versions: [version({ state: "pending_review" })] }) });
    render(<BusinessTruthPanel currentUser={{ id: "reviewer-1" }} workspaceId="ws-1" />);
    expect(await screen.findByRole("button", { name: /Approve & Promote/ })).toBeTruthy();
    expect(discoverability.getTruthRecord).toHaveBeenCalledWith("rec-1", { workspaceId: "ws-1" });
  });

  it("shows canonical facts under their registry labels", async () => {
    mockApi({ record: full({ canonical: version({ state: "approved" }) }) });
    render(<BusinessTruthPanel />);
    expect(await screen.findByText("Acme Pvt Ltd")).toBeTruthy();
    expect(screen.getByText(TRUTH_FIELDS.legal_name.label)).toBeTruthy();
    expect(screen.getByText("canonical")).toBeTruthy();
  });

  it("says a record with nothing approved is un-reviewed, not empty", async () => {
    mockApi();
    render(<BusinessTruthPanel />);
    expect(await screen.findByText(/un-reviewed, not empty/)).toBeTruthy();
  });

  it("submits a draft for review", async () => {
    mockApi();
    vi.spyOn(discoverability, "submitTruthVersion").mockResolvedValue({ version: version({ state: "pending_review" }) });
    render(<BusinessTruthPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Submit for Review/ }));
    await waitFor(() => expect(discoverability.submitTruthVersion).toHaveBeenCalledWith("rec-1", "v1", { workspaceId: "ws-1" }));
  });

  it("permits solo operator self-approval using single Approve & Promote button with audit trail note", async () => {
    mockApi({ record: full({ versions: [version({ state: "pending_review", proposed_by: "me" })] }) });
    const promote = vi.spyOn(discoverability, "promoteTruthVersion").mockResolvedValue({ promoted: true });
    render(<BusinessTruthPanel currentUser={{ id: "me" }} />);
    const button = await screen.findByRole("button", { name: /Approve & Promote/ });
    expect(button.disabled).toBe(false);
    expect(screen.getByText(/Solo operator can self-approve/)).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(promote).toHaveBeenCalledWith(
      "rec-1", "v1",
      expect.stringContaining("[Single-founder approval]"),
      expect.anything(),
    ));
  });

  it("promotes a version somebody else proposed", async () => {
    mockApi({ record: full({ versions: [version({ state: "pending_review" })] }) });
    vi.spyOn(discoverability, "promoteTruthVersion").mockResolvedValue({ promoted: true });
    render(<BusinessTruthPanel currentUser={{ id: "reviewer" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve & Promote/ }));
    await waitFor(() => expect(discoverability.promoteTruthVersion).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Version promoted to canonical truth.", "check");
  });

  it("explains a server-side self-approval refusal", async () => {
    mockApi({ record: full({ versions: [version({ state: "pending_review" })] }) });
    vi.spyOn(discoverability, "promoteTruthVersion").mockRejectedValue(Object.assign(new Error("nope"), { code: "SELF_APPROVAL", status: 403 }));
    render(<BusinessTruthPanel currentUser={{ id: "reviewer" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve & Promote/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Self-approval refused/), "warning"));
  });

  it("proposes real field ids, seeded from canonical, omitting blanks, and reports rejected fields", async () => {
    mockApi({ record: full({ canonical: version({ state: "approved" }) }) });
    vi.spyOn(discoverability, "proposeTruthVersion").mockResolvedValue({ version: version(), rejected: [{ field: "primary_email", reason: "unusable_value" }] });
    const { container } = render(<BusinessTruthPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Propose Version/ }));
    expect(container.querySelector('input[name="legal_name"]').value).toBe("Acme Pvt Ltd");
    expect(container.querySelector('input[name="canonical_domain"]').value).toBe("acme.example");
    fireEvent.change(container.querySelector('input[name="primary_email"]'), { target: { value: "bad" } });
    fireEvent.submit(container.querySelector('input[name="legal_name"]').closest("form"));
    await waitFor(() => expect(discoverability.proposeTruthVersion).toHaveBeenCalled());
    const [recordId, payload] = discoverability.proposeTruthVersion.mock.calls[0];
    expect(recordId).toBe("rec-1");
    expect(payload.fields).toEqual({ legal_name: "Acme Pvt Ltd", canonical_domain: "acme.example", primary_email: "bad" });
    expect(payload.workspaceId).toBe("ws-1");
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Not stored: Primary email/), "warning"));
  });

  it("offers record creation when there are no records", async () => {
    mockApi({ records: [] });
    vi.spyOn(discoverability, "createTruthRecord").mockResolvedValue({ record: { id: "rec-new" } });
    const { container } = render(<BusinessTruthPanel workspaceId="ws-9" />);
    expect(await screen.findByText(/No Business Truth Records Yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New Record/ }));
    fireEvent.change(screen.getByPlaceholderText("acme.example"), { target: { value: " acme.example " } });
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(discoverability.createTruthRecord).toHaveBeenCalledWith({
      canonical_domain: "acme.example", workspace_id: "ws-9",
    }));
  });

  it("renders the diff the route returns, and the first-version reason", async () => {
    mockApi({ diff: { comparable: false, reason: "This is the first version of the record." } });
    const first = render(<BusinessTruthPanel />);
    expect(await screen.findByText("This is the first version of the record.")).toBeTruthy();
    first.unmount();

    mockApi({ diff: {
      comparable: true, from: { version_no: 1 }, to: { version_no: 2 },
      diff: { added: [], removed: [], changed: [{ field: "primary_phone", from: "+91 1", to: "+91 2" }] },
    } });
    render(<BusinessTruthPanel />);
    expect(await screen.findByText(TRUTH_FIELDS.primary_phone.label)).toBeTruthy();
    expect(screen.getByText(/\+91 1 → \+91 2/)).toBeTruthy();
  });

  it("describes conflicts from their stored columns and resolves them", async () => {
    mockApi({ record: full({ conflicts: [{
      id: "c1", code: "BT-02", field: "primary_phone", severity: "high",
      canonical_value: "+91 1", observed_value: "+91 9",
    }] }) });
    vi.spyOn(discoverability, "resolveTruthConflict").mockResolvedValue({ resolved: true });
    render(<BusinessTruthPanel workspaceId="ws-1" />);
    expect(await screen.findByText(/Record says “\+91 1”; the page says “\+91 9”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Page Corrected" }));
    await waitFor(() => expect(discoverability.resolveTruthConflict).toHaveBeenCalledWith("rec-1", "c1", "page_updated", { workspaceId: "ws-1" }));
  });

  it("copies facts from an existing version into the proposal form", async () => {
    mockApi({
      record: full({
        versions: [
          {
            id: "v-prev",
            version_no: 3,
            state: "superseded",
            origin: "manual",
            fields_json: { legal_name: "Acme Old Corp", canonical_domain: "acme.old" },
          },
        ],
      }),
    });
    render(<BusinessTruthPanel />);
    const copyBtn = await screen.findByRole("button", { name: /Copy to New/ });
    fireEvent.click(copyBtn);

    expect(await screen.findByText("Propose New Fact Version")).toBeTruthy();
    expect(screen.getByDisplayValue("Acme Old Corp")).toBeTruthy();
  });

  it("opens delete modal and deletes unapproved or superseded version", async () => {
    mockApi({
      record: full({
        versions: [
          {
            id: "v-draft",
            version_no: 2,
            state: "draft",
            origin: "manual",
            fields_json: { legal_name: "Draft Corp" },
          },
        ],
      }),
    });
    vi.spyOn(discoverability, "deleteTruthVersion").mockResolvedValue({ ok: true, deleted: true });
    render(<BusinessTruthPanel workspaceId="ws-1" />);

    const deleteBtn = await screen.findByTitle("Delete this unapproved or superseded version");
    fireEvent.click(deleteBtn);

    expect(await screen.findByText("Delete Version v2")).toBeTruthy();
    expect(screen.getByText(/Audit Notice:/)).toBeTruthy();

    const confirmBtn = screen.getByRole("button", { name: "Delete Version" });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(discoverability.deleteTruthVersion).toHaveBeenCalledWith("rec-1", "v-draft", { workspaceId: "ws-1" }));
  });
});
