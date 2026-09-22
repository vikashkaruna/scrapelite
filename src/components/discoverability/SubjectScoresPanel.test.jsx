// SubjectScoresPanel.test.jsx — stored scores, read as stored.
// Fixtures mirror /subject-score/* responses and 0064's columns.

import { MemoryRouter } from "react-router";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SubjectScoresPanel, { componentsFor } from "./SubjectScoresPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { SUBJECT_SCORES, THIN_COVERAGE, scoreSubject } from "../../lib/discoverability/subjectScoring.js";

// The panel's empty state renders a react-router <Link> (so navigating to the
// Entity Graph keeps the SPA — and the entitlement context — alive). A <Link>
// throws outside a Router, so every render goes through this wrapper.
const renderPanel = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);


const toast = vi.fn();
vi.mock("../Toast.jsx", () => ({ useToast: () => toast }));

const brand = { id: "sub-brand", subject_kind: "brand", label: "Acme", canonical_domain: "acme.example" };
const page = { id: "sub-page", subject_kind: "page", label: "https://acme.example/pricing" };

function storedScore(values, over = {}) {
  const result = scoreSubject("brand", values);
  return {
    id: "score-1", subject_id: "sub-brand", score: result.score, coverage: result.coverage,
    components: result.components, scored_at: "2026-09-10T10:00:00Z", ...over,
  };
}

function mockApi({ subjects = [brand], entities = [], scores = [] } = {}) {
  vi.spyOn(discoverability, "listSubjects").mockResolvedValue({ subjects });
  vi.spyOn(discoverability, "getGraph").mockResolvedValue({ entities });
  vi.spyOn(discoverability, "listSubjectScores").mockResolvedValue({ scores });
}

describe("componentsFor", () => {
  it("uses the stored components once scored, the registry before", () => {
    const stored = storedScore({});
    expect(componentsFor("brand", stored)).toBe(stored.components);
    const fromRegistry = componentsFor("brand", null);
    expect(fromRegistry.map((c) => c.id)).toEqual(Object.keys(SUBJECT_SCORES.brand.components));
    expect(fromRegistry.every((c) => c.value === null)).toBe(true);
    expect(componentsFor("page", null)).toEqual([]);
  });
});

describe("SubjectScoresPanel", () => {
  beforeEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

  it("shows the empty state when there is nothing scorable", async () => {
    mockApi({ subjects: [] });
    renderPanel(<SubjectScoresPanel />);
    expect(await screen.findByText("No Scorable Subjects Found")).toBeTruthy();
  });

  it("🔴 surfaces pending scorable entities in the empty state with a link to Entity Graph", async () => {
    // Two entities exist but neither is approved — the user needs to know they
    // can mint subjects as soon as they approve these.
    mockApi({
      subjects: [],
      entities: [
        { id: "e-brand", name: "Acme", entity_type: "brand", state: "proposed" },
        { id: "e-product", name: "Widget", entity_type: "product", state: "proposed" },
      ],
    });
    renderPanel(<SubjectScoresPanel />);
    const empty = await screen.findByTestId("subject-scores-empty");
    // The empty-state copy must mention both pending entities and link to the
    // Entity Graph tab, not just say "create one" when one already exists.
    expect(empty.textContent).toMatch(/2.*entities? (is|are) awaiting approval/i);
    expect(empty.textContent).toMatch(/Entity Graph/);

    // 🔴 The link must be a ROUTER link, not a hard <a href>. Both navigate, so
    // a hard anchor looks correct in a browser — it just reloads the document
    // on the way, discarding the entitlement context and any in-flight audit.
    // react-router renders <Link> as an <a>, so the tell is that it does NOT
    // trigger a real navigation: the click is intercepted and defaultPrevented.
    const link = empty.querySelector('a[href="/discoverability/entities"]');
    expect(link).toBeTruthy();
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("🔴 Create Subject button no longer spans the full form width", async () => {
    mockApi({
      subjects: [],
      entities: [
        { id: "e-brand", name: "Acme", entity_type: "brand", state: "approved" },
      ],
    });
    renderPanel(<SubjectScoresPanel />);
    // Open the form so the submit button renders.
    fireEvent.click(await screen.findByRole("button", { name: /New Scorable Subject/ }));
    const btn = await screen.findByRole("button", { name: /^Create Subject$/ });
    // The button's grandparent must be a flex-end wrapper so it stays aligned
    // to the right edge of the form, matching every other submit in the app.
    const wrapper = btn.parentElement;
    expect(wrapper?.style.display).toBe("flex");
    expect(wrapper?.style.justifyContent).toBe("flex-end");
  });

  it("lists only scorable kinds — a page subject has no single-number formula", async () => {
    mockApi({ subjects: [page, brand] });
    renderPanel(<SubjectScoresPanel />);
    expect(await screen.findByRole("button", { name: /Acme/ })).toBeTruthy();
    expect(screen.queryByText("https://acme.example/pricing")).toBeNull();
    expect(screen.getByText("Subjects (1)")).toBeTruthy();
  });

  it("🔴 reads `score` and percent `coverage` as stored — never ×100 again", async () => {
    const ids = Object.keys(SUBJECT_SCORES.brand.components);
    const values = Object.fromEntries(ids.map((id) => [id, 80]));
    const stored = storedScore(values);
    mockApi({ scores: [stored] });
    renderPanel(<SubjectScoresPanel />);
    const tile = await screen.findByTestId("subject-score");
    expect(tile.textContent).toContain(Number(stored.score).toFixed(1));
    expect(tile.textContent).toContain("Coverage: 100%");
    expect(tile.textContent).not.toContain("10000%");
  });

  it("🔴 renders unmeasured components as 'cannot measure yet', never 0", async () => {
    const ids = Object.keys(SUBJECT_SCORES.brand.components);
    const stored = storedScore({ [ids[0]]: 64 });
    mockApi({ scores: [stored] });
    renderPanel(<SubjectScoresPanel />);
    const measured = await screen.findByTestId(`component-${ids[0]}`);
    expect(measured.textContent).toContain("64");
    const unmeasured = screen.getByTestId(`component-${ids[1]}`);
    expect(unmeasured.textContent).toContain("cannot measure yet");
    expect(unmeasured.textContent).toContain(SUBJECT_SCORES.brand.components[ids[1]].label);
  });

  it("marks a thin score as provisional", async () => {
    const ids = Object.keys(SUBJECT_SCORES.brand.components);
    const stored = storedScore({ [ids[0]]: 90 });
    expect(stored.coverage).toBeLessThan(THIN_COVERAGE);
    mockApi({ scores: [stored] });
    renderPanel(<SubjectScoresPanel />);
    expect(await screen.findByText(/Thin coverage/)).toBeTruthy();
  });

  it("before any score, shows the registry's components and says it is not scored", async () => {
    mockApi();
    renderPanel(<SubjectScoresPanel />);
    const tile = await screen.findByTestId("subject-score");
    expect(tile.textContent).toContain("not scored yet");
    expect(screen.getAllByText("cannot measure yet")).toHaveLength(Object.keys(SUBJECT_SCORES.brand.components).length);
  });

  it("creates a subject only over an approved entity of a fitting type", async () => {
    mockApi({ subjects: [], entities: [
      { id: "e-org", name: "Acme Org", entity_type: "organization", state: "approved" },
      { id: "e-prod", name: "Widget", entity_type: "product", state: "approved" },
      { id: "e-draft", name: "Draft Co", entity_type: "brand", state: "proposed" },
    ] });
    vi.spyOn(discoverability, "createEntitySubject").mockResolvedValue({ subject: {} });
    const { container } = renderPanel(<SubjectScoresPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /New Scorable Subject/ }));
    const [kindSelect, entitySelect] = container.querySelectorAll("form select");
    const entityOptions = () => [...entitySelect.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(kindSelect.value).toBe("brand");
    expect(entityOptions()).toEqual(["e-org"]);
    // Proposed entity e-draft is present as disabled pending option
    expect(screen.getByText(/Draft Co \(brand\) — Pending Approval/)).toBeInTheDocument();
    fireEvent.change(kindSelect, { target: { value: "product" } });
    expect(entityOptions()).toEqual(["e-prod"]);
    fireEvent.change(entitySelect, { target: { value: "e-prod" } });
    fireEvent.submit(container.querySelector("form"));
    await waitFor(() => expect(discoverability.createEntitySubject).toHaveBeenCalledWith({
      subjectKind: "product", entityId: "e-prod", workspaceId: "ws-1",
    }));
  });

  it("scores the selected subject and warns when the result is thin", async () => {
    mockApi();
    vi.spyOn(discoverability, "scoreSubject").mockResolvedValue({ thin: true, result: {} });
    renderPanel(<SubjectScoresPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Calculate Score/ }));
    await waitFor(() => expect(discoverability.scoreSubject).toHaveBeenCalledWith({ subject_id: "sub-brand", workspace_id: "ws-1" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/provisional/), "warning"));
  });
});
