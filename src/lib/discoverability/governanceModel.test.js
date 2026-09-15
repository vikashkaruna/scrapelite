import { describe, expect, it } from "vitest";
import {
  APPROVAL_STAGES,
  DISCOVERABILITY_ACTIONS,
  DISCOVERABILITY_ROLE_IDS,
  canDiscoverabilityRole,
  defaultDiscoverabilityRole,
  requireDiscoverabilityRole,
} from "./governanceModel.js";

describe("Discoverability governance", () => {
  it("freezes the seven published scoped roles and seven approval stages", () => {
    expect(DISCOVERABILITY_ROLE_IDS).toEqual([
      "viewer", "analyst", "editor", "manager", "admin", "agency_admin", "client_viewer",
    ]);
    expect(APPROVAL_STAGES.map((x) => x.id)).toEqual([
      "open", "accepted", "assigned", "in_progress", "implemented",
      "validation_scheduled", "validated",
    ]);
  });

  it("keeps client viewers read-only and grants approvals at manager", () => {
    expect(canDiscoverabilityRole("client_viewer", "read")).toBe(true);
    expect(canDiscoverabilityRole("client_viewer", "run_analysis")).toBe(false);
    expect(canDiscoverabilityRole("editor", "propose_changes")).toBe(true);
    expect(canDiscoverabilityRole("editor", "approve_changes")).toBe(false);
    expect(canDiscoverabilityRole("manager", "approve_changes")).toBe(true);
    expect(canDiscoverabilityRole("manager", "dispatch_connectors")).toBe(false);
    for (const action of DISCOVERABILITY_ACTIONS) {
      expect(canDiscoverabilityRole("admin", action), action).toBe(true);
      expect(canDiscoverabilityRole("agency_admin", action), action).toBe(true);
    }
  });

  it("fails closed for stored inventions and bridges old roles conservatively", () => {
    expect(requireDiscoverabilityRole("invented", "read").code).toBe("INVALID_DISCOVERABILITY_ROLE");
    expect(requireDiscoverabilityRole("viewer", "invented").code).toBe("INVALID_DISCOVERABILITY_ACTION");
    expect(requireDiscoverabilityRole("viewer", "approve_changes").code).toBe("DISCOVERABILITY_ROLE_FORBIDDEN");
    expect(defaultDiscoverabilityRole("owner")).toBe("admin");
    expect(defaultDiscoverabilityRole("admin")).toBe("admin");
    expect(defaultDiscoverabilityRole("member")).toBe("viewer");
  });
});
