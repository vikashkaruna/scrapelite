import { describe, expect, it } from "vitest";
import { DISCOVERABILITY_WORKSPACES } from "./DiscoverabilityWorkspace.jsx";

describe("Discoverability workspace route contract", () => {
  it("exposes the six dedicated Stage 1 workspace routes in plan order", () => {
    // Order matches the audit → revenue loop: truth → trust → entities → local
    // → scores → sxo. Updated when the closed-loop ribbon was recalibrated to
    // move schema & trust into its own step and entity graph before scores.
    expect(DISCOVERABILITY_WORKSPACES.map(({ path }) => path)).toEqual([
      "/discoverability/truth",
      "/discoverability/trust",
      "/discoverability/entities",
      "/discoverability/local",
      "/discoverability/scores",
      "/discoverability/sxo",
    ]);
  });

  it("keeps every route label and component explicit", () => {
    for (const workspace of DISCOVERABILITY_WORKSPACES) {
      expect(workspace.label).toBeTruthy();
      expect(workspace.icon).toBeTruthy();
      expect(workspace.component).toBeTypeOf("function");
    }
  });
});
