// SubjectScoresPanel.test.jsx — stored scores, read as stored.
// Fixtures mirror /subject-score/* responses and 0064's columns.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SubjectScoresPanel, { componentsFor } from "./SubjectScoresPanel.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { SUBJECT_SCORES, THIN_COVERAGE, scoreSubject } from "../../lib/discoverability/subjectScoring.js";

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
    render(<SubjectScoresPanel />);
    expect(await screen.findByText("No Scorable Subjects Found")).toBeTruthy();
  });

  it("lists only scorable kinds — a page subject has no single-number formula", async () => {
    mockApi({ subjects: [page, brand] });
    render(<SubjectScoresPanel />);
    expect(await screen.findByRole("button", { name: /Acme/ })).toBeTruthy();
    expect(screen.queryByText("https://acme.example/pricing")).toBeNull();
    expect(screen.getByText("Subjects (1)")).toBeTruthy();
  });

  it("🔴 reads `score` and percent `coverage` as stored — never ×100 again", async () => {
    const ids = Object.keys(SUBJECT_SCORES.brand.components);
    const values = Object.fromEntries(ids.map((id) => [id, 80]));
    const stored = storedScore(values);
    mockApi({ scores: [stored] });
    render(<SubjectScoresPanel />);
    const tile = await screen.findByTestId("subject-score");
    expect(tile.textContent).toContain(Number(stored.score).toFixed(1));
    expect(tile.textContent).toContain("Coverage: 100%");
    expect(tile.textContent).not.toContain("10000%");
  });

  it("🔴 renders unmeasured components as 'cannot measure yet', never 0", async () => {
    const ids = Object.keys(SUBJECT_SCORES.brand.components);
    const stored = storedScore({ [ids[0]]: 64 });
    mockApi({ scores: [stored] });
    render(<SubjectScoresPanel />);
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
    render(<SubjectScoresPanel />);
    expect(await screen.findByText(/Thin coverage/)).toBeTruthy();
  });

  it("before any score, shows the registry's components and says it is not scored", async () => {
    mockApi();
    render(<SubjectScoresPanel />);
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
    const { container } = render(<SubjectScoresPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /New Scorable Subject/ }));
    const [kindSelect, entitySelect] = container.querySelectorAll("form select");
    const entityOptions = () => [...entitySelect.querySelectorAll("option")].map((o) => o.value).filter(Boolean);
    expect(kindSelect.value).toBe("brand");
    expect(entityOptions()).toEqual(["e-org"]);
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
    render(<SubjectScoresPanel workspaceId="ws-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Calculate Score/ }));
    await waitFor(() => expect(discoverability.scoreSubject).toHaveBeenCalledWith({ subject_id: "sub-brand", workspace_id: "ws-1" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/provisional/), "warning"));
  });
});
