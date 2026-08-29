// src/__tests__/harness/AppProviders.jsx
// Shared mount for component / integration tests. Wraps the real provider
// tree (ThemeProvider → ToastProvider → ErrorModalProvider → AuthProvider →
// GuestTrialProvider → PersonaProvider → BillingProvider → ExtractionProvider)
// around a MemoryRouter so the test can target a specific initial route.
//
// Usage:
//
//   import { renderWithProviders } from "@/__tests__/harness/AppProviders";
//   renderWithProviders(<Home />, { initialEntries: ["/"] });
//
// Every provider is the production one — no mocked behaviour, no
// shimmed context values. Tests that need to override a provider (e.g.
// replace AuthProvider with one that fakes a signed-in user) should
// compose the test around their own wrapper using the exported
// `AppProviders` component as a base.

import { MemoryRouter } from "react-router";
import { ThemeProvider } from "../../components/ThemeProvider.jsx";
import { ToastProvider } from "../../components/Toast.jsx";
import { ErrorModalProvider } from "../../components/ErrorModal.jsx";
import { AuthProvider } from "../../components/AuthProvider.jsx";
import { GuestTrialProvider } from "../../components/GuestTrialProvider.jsx";
import { PersonaProvider } from "../../components/PersonaProvider.jsx";
import { BillingProvider } from "../../components/BillingProvider.jsx";
import { ExtractionProvider } from "../../components/ExtractionProvider.jsx";
import { render } from "@testing-library/react";

/**
 * Mount `children` inside the real production provider tree plus a
 * MemoryRouter initialised to the given routes. Returns the standard
 * `@testing-library/react` render result so tests can destructure
 * `getByRole`, `getByText`, etc.
 *
 * @template T
 * @param {React.ReactElement} ui
 * @param {Object} [options]
 * @param {string[]} [options.initialEntries] — initial route stack
 * @param {string} [options.initialIndex] — pointer into the route stack
 * @returns {import("@testing-library/react").RenderResult<T>}
 */
export function renderWithProviders(ui, options = {}) {
  const { initialEntries = ["/"], initialIndex } = options;
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      initialIndex={initialIndex}
    >
      <ThemeProvider>
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <GuestTrialProvider>
                <PersonaProvider>
                  <BillingProvider>
                    <ExtractionProvider>{ui}</ExtractionProvider>
                  </BillingProvider>
                </PersonaProvider>
              </GuestTrialProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

/**
 * The provider tree as a stand-alone component, for tests that want to
 * compose their own outer wrapper (e.g. their own MemoryRouter config or
 * a different router implementation).
 */
export function AppProviders({ children, initialEntries = ["/"] }) {
  return (
    <MemoryRouter
      initialEntries={initialEntries}
    >
      <ThemeProvider>
        <ToastProvider>
          <ErrorModalProvider>
            <AuthProvider>
              <GuestTrialProvider>
                <PersonaProvider>
                  <BillingProvider>
                    <ExtractionProvider>{children}</ExtractionProvider>
                  </BillingProvider>
                </PersonaProvider>
              </GuestTrialProvider>
            </AuthProvider>
          </ErrorModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
