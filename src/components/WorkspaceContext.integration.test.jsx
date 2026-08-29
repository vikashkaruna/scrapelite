// WorkspaceContext.integration.test.jsx — the "which workspace am I working
// in" concept the entitlementModel.js member-pause branch needed a live
// caller for.
//
//   - No user → no fetch, empty workspace list, selection stays null.
//   - Signed in → fetches the list, exposes it, persists a selection to
//     localStorage, and restores it on remount.
//   - A stored selection naming a workspace the user no longer belongs to
//     (removed seat, or a stale value from a previous account on a shared
//     machine) is dropped rather than sent with every request forever.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext.jsx";
import * as authProvider from "./AuthProvider.jsx";
import * as workspacesService from "../lib/workspacesService.js";

vi.mock("../lib/workspacesService.js", () => ({
  fetchMyWorkspaces: vi.fn(),
}));

vi.mock("./AuthProvider.jsx", async () => {
  const actual = await vi.importActual("./AuthProvider.jsx");
  return { ...actual, useAuth: vi.fn() };
});

function Capture() {
  const ctx = useWorkspace();
  Capture.last = ctx;
  return (
    <div>
      <span data-testid="count">{ctx.workspaces.length}</span>
      <span data-testid="current">{ctx.currentWorkspaceId || "(personal)"}</span>
      {ctx.workspaces.map((w) => (
        <button key={w.id} onClick={() => ctx.setCurrentWorkspaceId(w.id)}>{w.name}</button>
      ))}
    </div>
  );
}

const WS_LIST = [
  { id: "ws-1", name: "Acme Research" },
  { id: "ws-2", name: "Side Project" },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("WorkspaceProvider — signed out", () => {
  it("never fetches and stays empty for a guest", async () => {
    authProvider.useAuth.mockReturnValue({ user: null });
    await act(async () => {
      render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    expect(workspacesService.fetchMyWorkspaces).not.toHaveBeenCalled();
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("current").textContent).toBe("(personal)");
  });
});

describe("WorkspaceProvider — signed in", () => {
  beforeEach(() => {
    authProvider.useAuth.mockReturnValue({ user: { id: "u1" } });
    workspacesService.fetchMyWorkspaces.mockResolvedValue({ workspaces: WS_LIST, degraded: false });
  });

  it("fetches and exposes the user's workspaces", async () => {
    await act(async () => {
      render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("selecting a workspace persists it and it survives a remount", async () => {
    let view;
    await act(async () => {
      view = render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    await act(async () => {
      screen.getByText("Acme Research").click();
    });
    expect(screen.getByTestId("current").textContent).toBe("ws-1");
    expect(localStorage.getItem("datiq.currentWorkspace")).toBe("ws-1");

    view.unmount();
    await act(async () => {
      render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    expect(screen.getByTestId("current").textContent).toBe("ws-1");
  });

  it("drops a stored selection for a workspace the user no longer belongs to", async () => {
    localStorage.setItem("datiq.currentWorkspace", "ws-stale");
    await act(async () => {
      render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    expect(screen.getByTestId("current").textContent).toBe("(personal)");
    expect(localStorage.getItem("datiq.currentWorkspace")).toBeNull();
  });

  it("a failed fetch leaves the switcher empty rather than throwing", async () => {
    workspacesService.fetchMyWorkspaces.mockRejectedValue(new Error("network down"));
    await act(async () => {
      render(<WorkspaceProvider><Capture /></WorkspaceProvider>);
    });
    expect(screen.getByTestId("count").textContent).toBe("0");
  });
});
