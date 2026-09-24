import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SignalRules from "./SignalRules.jsx";
import * as rulesApi from "../lib/rules/rulesClient.js";

vi.mock("../components/AuthProvider.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "me@datiq.app" }, authLoading: false }),
}));
const toast = vi.fn();
vi.mock("../components/Toast.jsx", () => ({ useToast: () => toast }));
vi.mock("../lib/integrationsClient.js", () => ({
  getIntegrationStatus: vi.fn().mockResolvedValue({ connected: false }),
}));
vi.mock("../lib/watchlist/watchlistClient.js", () => ({
  listWatchlists: vi.fn().mockResolvedValue({ watchlists: [{ id: "wl_1", name: "Rivals" }, { id: "wl_2", name: "Adjacent" }] }),
}));
vi.mock("../lib/bulk/bulkClient.js", () => ({ listLists: vi.fn().mockResolvedValue({ lists: [] }) }));
vi.mock("../lib/rules/rulesClient.js", () => ({
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  testRule: vi.fn(),
  testDestination: vi.fn(),
  unlinkSource: vi.fn(),
  rulesForSource: vi.fn(),
}));

const alertMe = {
  newRule: {
    name: "Alert me: Rivals",
    triggerSource: "watchlist",
    actionType: "email",
    condition: { field: "materiality", op: "equals", value: "critical" },
    sources: [{ type: "watchlist", id: "wl_1", name: "Rivals" }],
  },
};

function renderAt(state) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/rules", state }]}>
      <SignalRules />
    </MemoryRouter>
  );
}

describe("SignalRules — rule sources (0085)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rulesApi.listRules.mockResolvedValue({ rules: [] });
    rulesApi.createRule.mockResolvedValue({ rule: { id: "r1", name: "Alert me: Rivals" } });
  });

  it("'Alert me' opens the builder limited to that watchlist and saves the scope", async () => {
    renderAt(alertMe);
    const rivals = await screen.findByRole("checkbox", { name: /Rivals/ });
    expect(rivals).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Adjacent/ })).not.toBeChecked();
    expect(screen.getByTestId("rule-sentence")).toHaveTextContent("the watchlist Rivals");

    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    await waitFor(() => expect(rulesApi.createRule).toHaveBeenCalled());
    const body = rulesApi.createRule.mock.calls[0][0];
    expect(body.source_scope).toBe("selected");
    // Only ids go to the server; names are for display.
    expect(body.sources).toEqual([{ type: "watchlist", id: "wl_1" }]);
  });

  it("refuses 'only these' with nothing chosen instead of saving a rule that hears nothing", async () => {
    renderAt(alertMe);
    const rivals = await screen.findByRole("checkbox", { name: /Rivals/ });
    fireEvent.click(rivals);
    expect(screen.getByTestId("rule-sentence")).toHaveTextContent("no watchlist yet");

    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    expect(rulesApi.createRule).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/at least one source/i));
  });

  it("a rule listening to all sends scope 'all' and no sources", async () => {
    renderAt({ newRule: { ...alertMe.newRule, sources: [] } });
    await screen.findByTestId("rule-sentence");
    expect(screen.getByTestId("rule-sentence")).toHaveTextContent("any watchlist");
    fireEvent.click(screen.getByRole("button", { name: "Save Rule" }));
    await waitFor(() => expect(rulesApi.createRule).toHaveBeenCalled());
    expect(rulesApi.createRule.mock.calls[0][0]).toMatchObject({ source_scope: "all", sources: [] });
  });

  it("shows a paused rule's sources with Unlink, and says why it is paused", async () => {
    rulesApi.listRules.mockResolvedValue({
      rules: [
        { id: "r1", name: "Price alert", trigger_source: "watchlist", action_type: "email", action_config: { to: "me@datiq.app" }, source_scope: "selected", sources: [{ type: "watchlist", id: "wl_1", name: "Rivals" }] },
        { id: "r2", name: "Orphan", trigger_source: "watchlist", action_type: "email", action_config: {}, source_scope: "selected", sources: [], status: "paused", paused_reason: "no_sources" },
      ],
    });
    rulesApi.unlinkSource.mockResolvedValue({ ok: true });
    renderAt(undefined);
    const unlink = await screen.findByRole("button", { name: "Unlink Rivals from Price alert" });
    expect(screen.getByText(/Paused — no sources left/)).toBeInTheDocument();
    fireEvent.click(unlink);
    await waitFor(() => expect(rulesApi.unlinkSource).toHaveBeenCalledWith("r1", "watchlist", "wl_1"));
  });
});
