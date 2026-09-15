import { describe, expect, it } from "vitest";
import { DISCOVERABILITY_WORKSPACES } from "./DiscoverabilityWorkspace.jsx";

describe("Discoverability workspace route contract", () => {
  it("exposes the six dedicated Stage 1 workspace routes in plan order", () => {
    expect(DISCOVERABILITY_WORKSPACES.map(({ path }) => path)).toEqual([
      "/discoverability/truth",
      "/discoverability/trust",
      "/discoverability/sxo",
      "/discoverability/scores",
      "/discoverability/entities",
      "/discoverability/local",
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
