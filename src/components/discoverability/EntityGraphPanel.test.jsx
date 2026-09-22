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

function mockApi({ entities: customEntities = entities, relationships = [], conflicts = [] } = {}) {
  vi.spyOn(discoverability, "getGraph").mockResolvedValue({ entities: customEntities, relationships, conflicts });
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
    const labels = await screen.findAllByText(PREDICATES.offers.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.getByText(/Confidence: 90%/)).toBeTruthy();
    const approveRelBtn = screen.getByTitle(/Approve relationship/);
    fireEvent.click(approveRelBtn);
    await waitFor(() => expect(discoverability.approveRelationship).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ workspaceId: "ws-1" }),
    ));
  });

  it("approves an individual entity node", async () => {
    mockApi({ entities: [{ id: "e1", name: "Acme", entity_type: "brand", state: "proposed" }] });
    vi.spyOn(discoverability, "approveEntity").mockResolvedValue({ approved: true });
    render(<EntityGraphPanel workspaceId="ws-1" />);
    const names = await screen.findAllByText("Acme");
    expect(names.length).toBeGreaterThan(0);
    const approveEntityBtn = screen.getByTitle(/Approve entity/);
    fireEvent.click(approveEntityBtn);
    await waitFor(() => expect(discoverability.approveEntity).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ workspaceId: "ws-1" }),
    ));
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

describe("EntityGraphPanel — approving an edge between entities you proposed", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("🔴 sends the single-founder note when the approver proposed an ENDPOINT, not just the edge", async () => {
    const ents = [
      { id: "e1", name: "Acme", entity_type: "organization", state: "approved" },
      { id: "e2", name: "Widget", entity_type: "product", state: "proposed", proposed_by: "u-me" },
    ];
    const rels = [{ id: "r1", subject_id: "e1", predicate: "offers", object_id: "e2", state: "proposed", proposed_by: "u-teammate", source: "declared" }];
    mockApi({ entities: ents, relationships: rels });
    const approve = vi.spyOn(discoverability, "approveRelationship").mockResolvedValue({ approved: true });
    render(<EntityGraphPanel currentUser={{ id: "u-me" }} />);
    const btn = (await screen.findAllByRole("button", { name: "Approve" }))
      .find((b) => /relationship/i.test(b.getAttribute("title") || ""));
    fireEvent.click(btn);
    await waitFor(() => expect(approve).toHaveBeenCalled());
    expect(approve.mock.calls[0][1].note).toMatch(/\[Single-founder approval\]/);
  });
});

describe("EntityGraphPanel — 2026-09-22 approval error banners", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("🔴 surfaces a SELF_APPROVAL verdict as an inline banner with the remediation hint, not a toast-only error", async () => {
    mockApi({ entities: [{ id: "e1", name: "Acme", entity_type: "brand", state: "proposed" }] });
    // The 0077 server returns 403 + { code: "SELF_APPROVAL", error: ... } and
    // the client maps it to err.code = "SELF_APPROVAL".
    vi.spyOn(discoverability, "approveEntity").mockRejectedValue(
      Object.assign(new Error("You proposed this entity."), { status: 403, code: "SELF_APPROVAL" }),
    );
    render(<EntityGraphPanel />);
    fireEvent.click(await screen.findByTitle(/Approve entity/));
    // The inline banner must render with the structured code, not the generic toast.
    const banner = await screen.findByTestId("approval-error-ent:e1");
    expect(banner.textContent).toMatch(/SELF_APPROVAL/);
    expect(banner.textContent).toMatch(/teammate|single-founder/i);
  });

  it("🔴 maps a Postgres 23514 CHECK violation to CHECK_VIOLATION so the user sees a hint, not a raw constraint name", async () => {
    mockApi({ entities: [{ id: "e1", name: "Acme", entity_type: "brand", state: "proposed" }] });
    // Some transport paths surface the SQLSTATE rather than the route's verdict code.
    vi.spyOn(discoverability, "approveEntity").mockRejectedValue(
      Object.assign(new Error("audit_entities_no_self_approval"), { status: 409, code: "23514" }),
    );
    render(<EntityGraphPanel />);
    fireEvent.click(await screen.findByTitle(/Approve entity/));
    const banner = await screen.findByTestId("approval-error-ent:e1");
    expect(banner.textContent).toMatch(/CHECK_VIOLATION/);
  });
});

describe("EntityGraphPanel — 2026-09-22 inline edit", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("🔴 edits an entity IN PLACE — it must not re-propose a duplicate", async () => {
    // This test used to assert the opposite, and the opposite was the bug:
    // saving an edit called proposeEntity, which POSTs a SECOND row and leaves
    // the original, so every Save produced a duplicate. The id has to stay
    // stable regardless — relationships cascade on their endpoints, so
    // replacing the node would silently take its edges with it.
    mockApi({ entities: [{ id: "e1", name: "Acme", entity_type: "brand", state: "proposed", description: "Original" }] });
    const proposeEntity = vi.spyOn(discoverability, "proposeEntity").mockResolvedValue({ entity: {} });
    const updateEntity = vi.spyOn(discoverability, "updateEntity").mockResolvedValue({ entity: {} });
    render(<EntityGraphPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByTitle(/Edit entity/));
    const nameInput = (await screen.findAllByDisplayValue("Acme"))
      .find((el) => el.tagName === "INPUT");
    fireEvent.change(nameInput, { target: { value: "Acme Updated" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(updateEntity).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ name: "Acme Updated", entity_type: "brand" }),
      expect.objectContaining({ workspaceId: "ws-1" }),
    ));
    // The half that actually prevents the duplicate.
    expect(proposeEntity).not.toHaveBeenCalled();
  });

  it("🔴 deleting an entity warns that its relationships go too", async () => {
    // 0056 cascades both endpoints, so a delete takes every edge with it. A
    // confirm that does not say so hides the part the user would want back.
    mockApi({
      entities: [
        { id: "e1", name: "Acme", entity_type: "brand", state: "approved" },
        { id: "e2", name: "Cloud", entity_type: "product", state: "approved" },
      ],
      relationships: [
        { id: "r1", subject_id: "e1", object_id: "e2", predicate: "owns", state: "approved" },
      ],
    });
    const deleteEntity = vi.spyOn(discoverability, "deleteEntity")
      .mockResolvedValue({ deleted: true, deletedRelationships: 1 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EntityGraphPanel workspaceId="ws-1" />);

    const del = (await screen.findAllByRole("button", { name: /^Delete$/ }))[0];
    fireEvent.click(del);
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/1 relationship/));
    await waitFor(() => expect(deleteEntity).toHaveBeenCalledWith("e1", { workspaceId: "ws-1" }));
  });

  it("does not delete when the confirm is dismissed", async () => {
    mockApi({ entities: [{ id: "e1", name: "Acme", entity_type: "brand", state: "approved" }] });
    const deleteEntity = vi.spyOn(discoverability, "deleteEntity").mockResolvedValue({ deleted: true });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EntityGraphPanel workspaceId="ws-1" />);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Delete$/ }))[0]);
    expect(deleteEntity).not.toHaveBeenCalled();
  });
});
