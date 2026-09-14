// EntityGraphPanel.test.jsx — the form offers the registry, and corroboration
// is only claimed when the server recorded it. Fixtures mirror /entity-graph.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EntityGraphPanel from "./EntityGraphPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { ENTITY_TYPE_IDS, PREDICATE_IDS, PREDICATES } from "../../lib/discoverability/entityGraph.js";

const toast = vi.fn();
vi.mock("../Toast.jsx", () => ({ useToast: () => toast }));

const entities = [
  { id: "e1", name: "Acme", entity_type: "organization", state: "approved" },
  { id: "e2", name: "Widget", entity_type: "product", state: "proposed" },
];

function mockApi({ relationships = [], conflicts = [] } = {}) {
  vi.spyOn(discoverability, "getGraph").mockResolvedValue({ entities, relationships, conflicts });
  vi.spyOn(discoverability, "graphConflicts").mockResolvedValue({ conflicts });
}

async function openRelationshipForm(container) {
  fireEvent.click(await screen.findByRole("button", { name: /Add Relationship/ }));
  const [subject, predicate, object] = container.querySelectorAll("form select");
  fireEvent.change(subject, { target: { value: "e1" } });
  fireEvent.change(predicate, { target: { value: "offers" } });
  fireEvent.change(object, { target: { value: "e2" } });
  return container.querySelector("form");
}

describe("EntityGraphPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("🔴 offers exactly the registry's entity types and predicates", async () => {
    mockApi();
    const { container } = render(<EntityGraphPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Entity/ }));
    expect([...container.querySelectorAll("form select option")].map((o) => o.value)).toEqual([...ENTITY_TYPE_IDS]);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add Relationship/ }));
    const predicate = container.querySelectorAll("form select")[1];
    expect([...predicate.querySelectorAll("option")].map((o) => o.value)).toEqual([...PREDICATE_IDS]);
  });

  it("proposes an entity as declared, scoped to the workspace", async () => {
    mockApi();
    vi.spyOn(discoverability, "proposeEntity").mockResolvedValue({ entity: {} });
    const { container } = render(<EntityGraphPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Add Entity/ }));
    fireEvent.change(container.querySelector('form input[type="text"]'), { target: { value: "Acme Labs" } });
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(discoverability.proposeEntity).toHaveBeenCalledWith(expect.objectContaining({
      name: "Acme Labs", entity_type: "brand", source: "declared", workspace_id: "ws-1",
    })));
  });

  it("reports a recorded sighting of an existing edge as corroboration", async () => {
    mockApi();
    vi.spyOn(discoverability, "proposeRelationship").mockRejectedValue(
      Object.assign(new Error("exists"), { status: 409, code: "RELATIONSHIP_EXISTS", corroborated: true }),
    );
    const { container } = render(<EntityGraphPanel />);
    fireEvent.submit(await openRelationshipForm(container));
    expect(await screen.findByText(/Relationship corroborated!/)).toBeTruthy();
  });

  it("🔴 does NOT claim corroboration the server could not record", async () => {
    mockApi();
    vi.spyOn(discoverability, "proposeRelationship").mockRejectedValue(
      Object.assign(new Error("exists"), { status: 409, code: "RELATIONSHIP_EXISTS", corroborated: false }),
    );
    const { container } = render(<EntityGraphPanel />);
    fireEvent.submit(await openRelationshipForm(container));
    expect(await screen.findByText(/could not be recorded/)).toBeTruthy();
    expect(screen.queryByText(/Relationship corroborated!/)).toBeNull();
  });

  it("renders relationships with predicate labels and approves them", async () => {
    mockApi({ relationships: [{ id: "r1", subject_id: "e1", predicate: "offers", object_id: "e2", source: "declared", state: "proposed", confidence: 0.9 }] });
    vi.spyOn(discoverability, "approveRelationship").mockResolvedValue({ approved: true });
    render(<EntityGraphPanel workspaceId="ws-1" />);
    expect(await screen.findByText(PREDICATES.offers.label)).toBeTruthy();
    expect(screen.getByText(/Confidence: 90%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(discoverability.approveRelationship).toHaveBeenCalledWith("r1", { workspaceId: "ws-1" }));
  });

  it("describes conflicts from their stored code and message, and resolves them", async () => {
    mockApi({ conflicts: [{ id: "c1", code: "EG-02", message: "Acme is part of itself." }] });
    vi.spyOn(discoverability, "resolveGraphConflict").mockResolvedValue({ resolved: true });
    render(<EntityGraphPanel workspaceId="ws-1" />);
    expect(await screen.findByText("EG-02: Acme is part of itself.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not a Conflict" }));
    await waitFor(() => expect(discoverability.resolveGraphConflict).toHaveBeenCalledWith("c1", "not_a_conflict", { workspaceId: "ws-1" }));
  });
});
