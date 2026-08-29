// src/components/TopBar.integration.test.jsx
// I-23..25 + I-49 — TopBar integration.
//
//   - I-23: Logged out → single primary "Sign in" button; logged in → UserDropdown
//   - I-24: Explore dropdown opens, shows the (flat) item list with the
//           expected top-level entries
//   - I-25: Mobile viewport (<600px) → hamburger button visible
//   - I-49: "Switch persona" label (Q8, 2026-07-15) renders in the user
//           dropdown; clicking re-opens /onboarding

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { useEffect } from "react";
import TopBar from "./TopBar.jsx";
import { AuthProvider, useAuth } from "./AuthProvider.jsx";
import { PersonaProvider, usePersona } from "./PersonaProvider.jsx";
import { ThemeProvider } from "./ThemeProvider.jsx";
import { ToastProvider } from "./Toast.jsx";
import { ErrorModalProvider } from "./ErrorModal.jsx";
import { GuestTrialProvider } from "./GuestTrialProvider.jsx";
import { BillingProvider } from "./BillingProvider.jsx";
import { ExtractionProvider } from "./ExtractionProvider.jsx";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return {
    ...actual,
    getSession: authMocks.getSession,
    onAuthStateChange: authMocks.onAuthStateChange,
    signOut: authMocks.signOut,
  };
});

vi.mock("../lib/apiClient.js", () => ({
  setAuthToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getSession.mockResolvedValue(null);
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  authMocks.signOut.mockResolvedValue();
  window.history.replaceState(null, "", window.location.pathname);
});

function Providers({ children, initialPath = "/" }) {
  return (
    <MemoryRouter initialEntries={[initialPath]}>
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

function setAuthUser(email = "alice@example.com") {
  // Force the AuthProvider into a "logged in" state by replaying the
  // getSession response + the onAuthStateChange callback.
  authMocks.getSession.mockResolvedValue({
    user: { id: "u1", email, user_metadata: { full_name: "Alice" } },
    access_token: "token",
  });
}

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

describe("I-23 — TopBar: auth state", () => {
  it("logged out → single primary 'Sign in' button", async () => {
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const signIn = screen.getByRole("button", { name: /^sign in$/i });
    expect(signIn).toBeInTheDocument();
    // No separate "Sign up" button — both auth modes open the same dialog,
    // so a single primary CTA is enough.
    expect(screen.queryByRole("button", { name: /^sign up$/i })).not.toBeInTheDocument();
  });

  it("logged in → UserDropdown trigger (chevron + label)", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // UserDropdown trigger has aria-haspopup="true" and title="Your account".
    const userBtn = screen.getByTitle("Your account");
    expect(userBtn).toBeInTheDocument();
    expect(userBtn.getAttribute("aria-haspopup")).toBe("true");
  });
});

describe("I-24 — TopBar: Explore dropdown", () => {
  it("clicking Explore shows the dropdown with the expected top-level items", async () => {
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const exploreBtn = screen.getByRole("button", { name: /explore/i });
    act(() => fireEvent.click(exploreBtn));
    // Items in the flat list (subset — pin the most important to avoid coupling
    // to cosmetic reorders).
    expect(screen.getByText(/plans & pricing/i)).toBeInTheDocument();
    expect(screen.getByText(/use cases/i)).toBeInTheDocument();
    expect(screen.getByText(/contact us/i)).toBeInTheDocument();
    expect(screen.getByText(/about datiQ/i)).toBeInTheDocument();
  });

  it("Explore dropdown closes on outside click", async () => {
    render(
      <Providers>
        <TopBar />
        <div data-testid="outside">outside</div>
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => fireEvent.click(screen.getByRole("button", { name: /explore/i })));
    expect(screen.getByText(/plans & pricing/i)).toBeInTheDocument();
    act(() => fireEvent.mouseDown(screen.getByTestId("outside")));
    expect(screen.queryByText(/plans & pricing/i)).toBeNull();
  });

  it("navigating via an Explore item closes the dropdown", async () => {
    render(
      <Providers>
        <TopBar />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => fireEvent.click(screen.getByRole("button", { name: /explore/i })));
    act(() => fireEvent.click(screen.getByText(/about datiQ/i)));
    expect(screen.getByTestId("location").textContent).toBe("/about");
    expect(screen.queryByText(/plans & pricing/i)).toBeNull();
  });
});

describe("I-25 — TopBar: mobile hamburger", () => {
  it("viewport <600px → hamburger button is visible (has aria-label 'Open menu')", async () => {
    // jsdom doesn't apply CSS, so .hamburger-btn's display is still visible.
    // The presence of the button with the right aria-label is the contract.
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const hamburger = screen.getByRole("button", { name: /open menu/i });
    expect(hamburger).toBeInTheDocument();
    // Clicking opens the .mobile-nav (we just check the aria-expanded flips).
    act(() => fireEvent.click(hamburger));
    expect(hamburger.getAttribute("aria-expanded")).toBe("true");
  });

  // Regression guard for the React 19 upgrade (2026-08-23).
  //
  // The closed mobile nav is offscreen but still in the DOM, so `aria-hidden`
  // alone is not enough — Tab would walk into its buttons. `inert` is what
  // removes the subtree from the focus order.
  //
  // TopBar used to pass `inert={!isOpen ? "" : undefined}`, which worked only
  // because React 18 did not recognise `inert` and forwarded the empty string
  // as a bare attribute (HTML reads a present boolean attribute as true).
  // React 19 recognises `inert` as a boolean prop, so `""` coerces to false
  // and the attribute vanishes. Nothing failed — React only warns — so the
  // whole suite stayed green while the menu quietly became tabbable again.
  //
  // Asserting on the rendered attribute rather than the prop is the point:
  // it is the DOM, not the JSX, that decides whether focus can enter.
  it("closed mobile nav is inert, so Tab cannot reach its offscreen buttons", async () => {
    const { container } = render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const nav = container.querySelector("nav.mobile-nav");
    expect(nav).toBeTruthy();

    // Closed: the attribute must actually be present in the DOM.
    expect(nav.hasAttribute("inert")).toBe(true);

    // Open: it must be gone, or the menu the user just opened is unusable.
    const hamburger = screen.getByRole("button", { name: /open menu/i });
    act(() => fireEvent.click(hamburger));
    expect(nav.hasAttribute("inert")).toBe(false);
  });
});

describe("I-49 — TopBar: 'Switch persona' label (Q8)", () => {
  it("logged in UserDropdown shows 'Switch persona' label, not 'Switch Role'", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const userBtn = screen.getByTitle("Your account");
    act(() => fireEvent.click(userBtn));
    // The label is "Switch persona" (lowercase p) — Q8 2026-07-15.
    // Both the desktop dropdown and the mobile nav carry the label; the
    // desktop dropdown is the one we just opened, so we scope to it.
    const desktopMenu = document.querySelector(".user-dropdown-menu");
    expect(desktopMenu).not.toBeNull();
    expect(desktopMenu.textContent).toMatch(/switch persona/i);
    // And the OLD label is gone (case-insensitive).
    expect(desktopMenu.textContent).not.toMatch(/switch role/i);
  });

  it("clicking 'Switch persona' navigates to /onboarding (re-opens persona flow)", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </Providers>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    act(() => fireEvent.click(screen.getByTitle("Your account")));
    // Click the desktop dropdown's Switch persona button (not the mobile one).
    const desktopMenu = document.querySelector(".user-dropdown-menu");
    const personaBtn = Array.from(desktopMenu.querySelectorAll("button")).find(
      (b) => /switch persona/i.test(b.textContent),
    );
    act(() => fireEvent.click(personaBtn));
    expect(screen.getByTestId("location").textContent).toBe("/onboarding");
  });
});

describe("Workspace moved into the signed-in user menu (2026-08-28)", () => {
  it("is absent from the primary desktop nav links", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => { await Promise.resolve(); });
    const primaryNav = document.querySelector(".nav-links");
    expect(primaryNav.textContent).not.toMatch(/workspace/i);
  });

  it("appears in the user dropdown, listed above 'Schedules & monitors'", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => { await Promise.resolve(); });
    act(() => fireEvent.click(screen.getByTitle("Your account")));
    const desktopMenu = document.querySelector(".user-dropdown-menu");
    const items = Array.from(desktopMenu.querySelectorAll(".nav-dropdown-item")).map((b) => b.textContent);
    const workspaceIdx = items.findIndex((t) => /^workspace$/i.test(t.trim()));
    const schedulesIdx = items.findIndex((t) => /schedules.*monitors/i.test(t));
    expect(workspaceIdx).toBeGreaterThanOrEqual(0);
    expect(schedulesIdx).toBeGreaterThanOrEqual(0);
    expect(workspaceIdx).toBeLessThan(schedulesIdx);
  });

  it("clicking Workspace in the user dropdown navigates to /workspace", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </Providers>,
    );
    await act(async () => { await Promise.resolve(); });
    act(() => fireEvent.click(screen.getByTitle("Your account")));
    const desktopMenu = document.querySelector(".user-dropdown-menu");
    const workspaceBtn = Array.from(desktopMenu.querySelectorAll("button")).find(
      (b) => /^workspace$/i.test(b.textContent.trim()),
    );
    act(() => fireEvent.click(workspaceBtn));
    expect(screen.getByTestId("location").textContent).toBe("/workspace");
  });

  it("appears in the mobile nav's user section, above 'Schedules & monitors'", async () => {
    setAuthUser();
    render(
      <Providers>
        <TopBar />
      </Providers>,
    );
    await act(async () => { await Promise.resolve(); });
    const mobileItems = Array.from(document.querySelectorAll(".mobile-nav .mobile-nav-item")).map((b) => b.textContent);
    const workspaceIdx = mobileItems.findIndex((t) => /^workspace$/i.test(t.trim()));
    const schedulesIdx = mobileItems.findIndex((t) => /schedules.*monitors/i.test(t));
    expect(workspaceIdx).toBeGreaterThanOrEqual(0);
    expect(schedulesIdx).toBeGreaterThanOrEqual(0);
    expect(workspaceIdx).toBeLessThan(schedulesIdx);
  });
});
