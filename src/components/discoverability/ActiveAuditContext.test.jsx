import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ActiveAuditContext from "./ActiveAuditContext.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { readActiveAudit } from "../../lib/discoverability/tabCache.js";

const ROW = {
  id: "9a8b7c6d-1111-2222-3333-444444444444",
  target_url: "https://acme.com/services",
  audit_profile: "aeo",
  device_profile: "desktop",
  page_type: "service",
  created_at: "2026-09-14T08:00:00Z",
};

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("ActiveAuditContext", () => {
  it("shows the short id in brackets with domain, profile, device, page type and date from the database", async () => {
    vi.spyOn(discoverability, "getAudit").mockResolvedValue({ audit: ROW, result: null });
    render(<MemoryRouter><ActiveAuditContext auditId={ROW.id} /></MemoryRouter>);
    expect(screen.getByText("(9a8b7c6d)")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/acme\.com · Aeo · Desktop · Service · /)).toBeTruthy());
    expect(readActiveAudit({ userId: null, workspaceId: null }).id).toBe(ROW.id);
    expect(screen.getByRole("link", { name: /Return to Audit Report/ }).getAttribute("href"))
      .toBe(`/discoverability?audit=${ROW.id}`);
  });

  it("uses the audit the page already holds without refetching", async () => {
    const spy = vi.spyOn(discoverability, "getAudit").mockResolvedValue({ audit: ROW });
    render(
      <MemoryRouter>
        <ActiveAuditContext auditId={ROW.id} audit={{ auditId: ROW.id, audit: ROW }} showReturnLink={false} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/acme\.com · Aeo/)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Return to Audit Report/ })).toBeNull();
  });

  it("degrades to the id alone when the audit cannot be read", async () => {
    vi.spyOn(discoverability, "getAudit").mockRejectedValue(new Error("offline"));
    render(<MemoryRouter><ActiveAuditContext auditId={ROW.id} /></MemoryRouter>);
    expect(screen.getByText("(9a8b7c6d)")).toBeTruthy();
    await waitFor(() => expect(discoverability.getAudit).toHaveBeenCalled());
  });
});
