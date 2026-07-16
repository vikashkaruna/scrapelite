// src/__tests__/system/system.smoke.test.jsx
// M0 system-layer smoke test. Confirms:
//   1. The system filter (`src/__tests__/system`) is wired in
//      `npm run test:system` and matches files in this directory.
//   2. The full AppProviders tree is importable in a system-test context
//      (system tests typically exercise cross-cutting behaviour — the
//      full provider stack must be available).
//
// Real system coverage lands in M5.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { AppProviders } from "../harness/AppProviders.jsx";

function SystemMarker() {
  return <span data-testid="system-marker">system-mounted</span>;
}

describe("system-layer smoke (M0)", () => {
  it("the AppProviders tree mounts under jsdom in a system-test context", () => {
    const { getByTestId } = render(
      <AppProviders initialEntries={["/system-smoke"]}>
        <SystemMarker />
      </AppProviders>,
    );
    expect(getByTestId("system-marker")).toBeInTheDocument();
  });
});
