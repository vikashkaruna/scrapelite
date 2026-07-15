// src/__tests__/harness/integration.smoke.integration.test.jsx
// M0 integration-layer smoke test. Confirms:
//   1. The integration filter (`*.integration.test.*`) is wired in
//      `npm run test:integration` and matches files in this directory.
//   2. The AppProviders harness mounts the production provider tree
//      end-to-end without throwing — i.e. every context provider the
//      app uses is importable in a vitest jsdom environment.
//   3. The vitest-axe `toHaveNoViolations` matcher is registered from
//      `test/a11y-setup.js` for integration tests.
//
// Real integration coverage lands in M3.

import { describe, expect, it } from "vitest";
import { renderWithProviders } from "./AppProviders.jsx";

function Marker() {
  return <span data-testid="integration-marker">mounted</span>;
}

describe("integration-layer smoke (M0)", () => {
  it("the AppProviders harness mounts under jsdom without throwing", () => {
    const { getByTestId } = renderWithProviders(<Marker />);
    expect(getByTestId("integration-marker")).toBeInTheDocument();
  });

  it("toHaveNoViolations is registered for the integration layer", () => {
    expect(expect({}).toHaveNoViolations).toBeTypeOf("function");
  });
});
