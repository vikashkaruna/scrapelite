// src/lib/workspacesService.test.js
//
// The client half of team workspaces. What matters here is that it never
// throws (every caller elsewhere gets a plain result object, not a
// try/catch obligation) and that it forwards the server's refusal reason and
// entitlement-denial fields (code/upgradeTo) verbatim rather than inventing
// its own wording — the server owns that copy, same rule as referralService.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchMyWorkspaces,
  fetchWorkspace,
  createWorkspace,
  inviteToWorkspace,
  acceptWorkspaceInvite,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
} from "./workspacesService.js";

vi.mock("./apiClient.js", () => ({
  apiClient: {
    listWorkspaces: vi.fn(),
    getWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    inviteToWorkspace: vi.fn(),
    acceptWorkspaceInvite: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    revokeWorkspaceInvite: vi.fn(),
  },
}));
const { apiClient } = await import("./apiClient.js");

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

function apiError({ message, status, reason, code, upgradeTo }) {
  const e = new Error(message);
  if (status !== undefined) e.status = status;
  if (reason !== undefined) e.reason = reason;
  if (code !== undefined) e.code = code;
  if (upgradeTo !== undefined) e.upgradeTo = upgradeTo;
  return e;
}

describe("fetchMyWorkspaces", () => {
  it("returns the workspace list and create-capability", async () => {
    apiClient.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: "ws-1", name: "Acme", role: "owner" }],
      canCreate: { allowed: false, remaining: 0 },
      degraded: false,
    });
    const r = await fetchMyWorkspaces();
    expect(r.workspaces).toHaveLength(1);
    expect(r.canCreate.allowed).toBe(false);
  });

  it("never throws — a network failure degrades to an empty, reported result", async () => {
    apiClient.listWorkspaces.mockRejectedValue(apiError({ message: "network down" }));
    const r = await fetchMyWorkspaces();
    expect(r.workspaces).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.error).toBe("network down");
  });
});

describe("fetchWorkspace", () => {
  it("returns empty, non-degraded state for a missing id rather than calling the API", async () => {
    const r = await fetchWorkspace(null);
    expect(r.myRole).toBeNull();
    expect(apiClient.getWorkspace).not.toHaveBeenCalled();
  });

  it("surfaces members and invites for a member", async () => {
    apiClient.getWorkspace.mockResolvedValue({
      myRole: "owner",
      members: [{ userId: "u1", role: "owner" }],
      invites: [{ email: "pending@x.com" }],
      degraded: false,
    });
    const r = await fetchWorkspace("ws-1");
    expect(r.myRole).toBe("owner");
    expect(r.members).toHaveLength(1);
    expect(r.invites).toHaveLength(1);
  });
});

describe("createWorkspace", () => {
  it("returns ok + the new id on success", async () => {
    apiClient.createWorkspace.mockResolvedValue({ workspaceId: "ws-9" });
    const r = await createWorkspace("Client A");
    expect(r.ok).toBe(true);
    expect(r.workspaceId).toBe("ws-9");
  });

  it("forwards a QUOTA_EXCEEDED entitlement denial's code and upgradeTo verbatim", async () => {
    apiClient.createWorkspace.mockRejectedValue(
      apiError({ message: "You've reached your plan's workspace limit (1).", status: 402, code: "QUOTA_EXCEEDED", upgradeTo: "agency" }),
    );
    const r = await createWorkspace("One too many");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("QUOTA_EXCEEDED");
    expect(r.upgradeTo).toBe("agency");
    expect(r.error).toContain("workspace limit");
  });
});

describe("inviteToWorkspace", () => {
  it("refuses a blank email locally, without calling the API", async () => {
    const r = await inviteToWorkspace("ws-1", "   ");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid");
    expect(apiClient.inviteToWorkspace).not.toHaveBeenCalled();
  });

  it("trims the email before sending it", async () => {
    apiClient.inviteToWorkspace.mockResolvedValue({});
    await inviteToWorkspace("ws-1", "  friend@x.com  ", "admin");
    expect(apiClient.inviteToWorkspace).toHaveBeenCalledWith("ws-1", "friend@x.com", "admin");
  });

  it("surfaces the server's refusal reason, e.g. already_invited", async () => {
    apiClient.inviteToWorkspace.mockRejectedValue(apiError({ message: "pending", reason: "already_invited" }));
    const r = await inviteToWorkspace("ws-1", "friend@x.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("already_invited");
  });
});

describe("acceptWorkspaceInvite", () => {
  it("refuses an empty token locally", async () => {
    const r = await acceptWorkspaceInvite("");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid");
    expect(apiClient.acceptWorkspaceInvite).not.toHaveBeenCalled();
  });

  it("returns the workspaceId on success", async () => {
    apiClient.acceptWorkspaceInvite.mockResolvedValue({ workspaceId: "ws-1" });
    const r = await acceptWorkspaceInvite("tok-123");
    expect(r.ok).toBe(true);
    expect(r.workspaceId).toBe("ws-1");
  });

  it("surfaces email_mismatch distinctly from a generic failure", async () => {
    apiClient.acceptWorkspaceInvite.mockRejectedValue(apiError({ message: "wrong email", reason: "email_mismatch" }));
    const r = await acceptWorkspaceInvite("tok-123");
    expect(r.reason).toBe("email_mismatch");
  });
});

describe("removeWorkspaceMember", () => {
  it("surfaces owner_cannot_leave", async () => {
    apiClient.removeWorkspaceMember.mockRejectedValue(apiError({ message: "no", reason: "owner_cannot_leave" }));
    const r = await removeWorkspaceMember("ws-1", "owner-id");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("owner_cannot_leave");
  });
});

describe("revokeWorkspaceInvite", () => {
  it("reports ok on success", async () => {
    apiClient.revokeWorkspaceInvite.mockResolvedValue({});
    const r = await revokeWorkspaceInvite("ws-1", "inv-1");
    expect(r.ok).toBe(true);
  });
});
