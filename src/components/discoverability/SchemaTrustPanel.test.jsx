// SchemaTrustPanel.test.jsx — the form offers what the route accepts, and
// "not measured" is never 0. Fixtures mirror /schema-trust/* responses.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SchemaTrustPanel from "./SchemaTrustPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { TRUST_SIGNALS, TRUST_SIGNAL_IDS } from "../../lib/discoverability/trustProof.js";

const toast = vi.fn();
vi.mock("../Toast.jsx", () => ({ useToast: () => toast }));

function mockApi({ entities = [], observations = [], trust = null } = {}) {
  vi.spyOn(discoverability, "listSchemaEntities").mockResolvedValue({ entities });
  vi.spyOn(discoverability, "listTrustObservations").mockResolvedValue({ observations, trust });
}

describe("SchemaTrustPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("🔴 offers exactly the trust signals the route validates against", async () => {
    mockApi();
    const { container } = render(<SchemaTrustPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Record Trust Observation/ }));
    const options = [...container.querySelectorAll("form select option")].map((o) => o.value);
    expect(options).toEqual([...TRUST_SIGNAL_IDS]);
  });

  it("submits a server-valid observation and never sends `independence`", async () => {
    mockApi();
    vi.spyOn(discoverability, "saveTrustObservation").mockResolvedValue({ observation: {} });
    const { container } = render(<SchemaTrustPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Record Trust Observation/ }));
    fireEvent.change(container.querySelector("form select"), { target: { value: "credentials" } });
    fireEvent.change(screen.getByPlaceholderText("https://thirdparty.com/profile"), { target: { value: " https://registry.example/acme " } });
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(discoverability.saveTrustObservation).toHaveBeenCalled());
    const payload = discoverability.saveTrustObservation.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      signal: "credentials", source_url: "https://registry.example/acme", observed_count: 1, workspace_id: "ws-1",
    }));
    expect(payload).not.toHaveProperty("independence");
    expect(payload.excerpt).toBeUndefined();
  });

  it("renders an unmeasured trust score as 'not measured' with its coverage", async () => {
    mockApi({ trust: { score: null, coverage: 0, unmeasured: ["ratings", "identity"], signals: [] } });
    render(<SchemaTrustPanel />);
    const tile = await screen.findByTestId("trust-score");
    expect(tile.textContent).toContain("not measured");
    expect(tile.textContent).toContain("Coverage: 0%");
    expect(screen.getByText(new RegExp(TRUST_SIGNALS.ratings.label))).toBeTruthy();
  });

  it("renders a measured score beside its coverage", async () => {
    mockApi({ trust: { score: 72.5, coverage: 57.1, unmeasured: [], signals: [] } });
    render(<SchemaTrustPanel />);
    const tile = await screen.findByTestId("trust-score");
    expect(tile.textContent).toContain("72.5");
    expect(tile.textContent).toContain("Coverage: 57%");
  });

  it("lists observations with their signal label, derived independence and stored excerpt", async () => {
    mockApi({ observations: [{
      id: "o1", signal: "ratings", independence: "third_party", observed_count: 12,
      source_url: "https://reviews.example/acme", evidence_json: { excerpt: "4.8 from 212 reviews" },
    }] });
    render(<SchemaTrustPanel />);
    expect(await screen.findByText(`${TRUST_SIGNALS.ratings.label} · 12`)).toBeTruthy();
    expect(screen.getByText("Independent")).toBeTruthy();
    expect(screen.getByText(/4.8 from 212 reviews/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("rel")).toContain("noopener");
  });

  it("shows schema validity and the properties that are missing", async () => {
    mockApi({ entities: [{ id: "s1", schema_type: "Organization", validity: "incomplete", missing_properties: ["logo", "sameAs"] }] });
    render(<SchemaTrustPanel />);
    expect(await screen.findByText("Organization")).toBeTruthy();
    expect(screen.getByText("incomplete")).toBeTruthy();
    expect(screen.getByText("Missing: logo, sameAs")).toBeTruthy();
  });

  it("surfaces a save failure", async () => {
    mockApi();
    vi.spyOn(discoverability, "saveTrustObservation").mockRejectedValue(new Error("Unknown trust signal"));
    const { container } = render(<SchemaTrustPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Record Trust Observation/ }));
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Unknown trust signal", "error"));
  });
});
