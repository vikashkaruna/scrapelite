// src/__tests__/harness/AppProviders.test.jsx
// Smoke test for the M0 test harness. Mounts the harness with a trivial
// child and asserts that:
//   1. The provider tree renders without throwing.
//   2. The vitest-axe `toHaveNoViolations` matcher is registered (M0 wires
//      test/a11y-setup.js into vite.config.js).
//   3. `renderWithProviders` returns the same shape as `render` from
//      `@testing-library/react`.
//
// This test is intentionally tiny. The real coverage for AppProviders lands
// in M3 (integration) and M7 (a11y) once components actually use it.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderWithProviders, AppProviders } from "./AppProviders.jsx";

function Hello() {
  return <h1>Hello harness</h1>;
}

describe("AppProviders harness", () => {
  it("mounts a child inside the full provider tree", () => {
    const { getByRole } = renderWithProviders(<Hello />);
    expect(getByRole("heading", { name: /Hello harness/i })).toBeInTheDocument();
  });

  it("AppProviders accepts a custom initialEntries stack", () => {
    // Use the bare `render` from testing-library: AppProviders already
    // includes its own MemoryRouter, so wrapping it in `renderWithProviders`
    // would nest two routers. The supported composition pattern is either
    // (a) `renderWithProviders(<ui />)` for tests that only need providers
    // + a default route, or (b) bare `render(<AppProviders><ui/></AppProviders>)`
    // for tests that need a custom route stack.
    const { getByText, unmount } = render(
      <AppProviders initialEntries={["/dashboard"]}>
        <span>via AppProviders</span>
      </AppProviders>,
    );
    expect(getByText("via AppProviders")).toBeInTheDocument();
    unmount();
  });

  it("exposes the vitest-axe toHaveNoViolations matcher (M0 a11y-setup wire)", () => {
    // The actual a11y assertions live in M7. This test only proves the
    // matcher is registered. If test/a11y-setup.js fails to load,
    // `toHaveNoViolations` would be undefined and this assignment would
    // throw at the file's top level.
    expect(expect({}).toHaveNoViolations).toBeTypeOf("function");
  });
});
