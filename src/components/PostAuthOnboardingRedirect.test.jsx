import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

const state = vi.hoisted(() => ({
  auth: { user: null, arrivedViaAuthCallback: false },
  persona: { onboarded: false, synced: true },
}));
vi.mock("./AuthProvider.jsx", () => ({ useAuth: () => state.auth }));
vi.mock("./PersonaProvider.jsx", () => ({ usePersona: () => state.persona }));
vi.mock("../lib/analyticsService.js", () => ({ track: vi.fn() }));

import PostAuthOnboardingRedirect from "./PostAuthOnboardingRedirect.jsx";
import PersonaNudge from "./PersonaNudge.jsx";
import { setPostAuthIntent, peekPostAuthIntent } from "../lib/postAuthIntent.js";

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

function renderAt(at) {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <PostAuthOnboardingRedirect />
      <PersonaNudge />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

const USER = { id: "u1", user_metadata: {} };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  state.auth = { user: USER, arrivedViaAuthCallback: false };
  state.persona = { onboarded: false, synced: true };
});

const where = () => screen.getByTestId("where").textContent;

describe("PostAuthOnboardingRedirect", () => {
  it("front-door sign-up with no role → /onboarding", async () => {
    setPostAuthIntent("/pricing");
    renderAt("/pricing");
    await act(async () => {});
    expect(where()).toBe("/onboarding?next=%2Fpricing");
    expect(peekPostAuthIntent()).toBeNull();
  });

  it("use-case page sign-up pre-selects that role", async () => {
    setPostAuthIntent("/use-cases/revops");
    renderAt("/use-cases/revops");
    await act(async () => {});
    expect(where()).toBe("/onboarding?next=%2Fuse-cases%2Frevops&role=revops");
  });

  it("mid-task sign-in stays on the task and shows the card", async () => {
    setPostAuthIntent("/discoverability?url=x");
    renderAt("/discoverability?url=x");
    await act(async () => {});
    expect(where()).toBe("/discoverability?url=x");
    expect(screen.getByRole("region", { name: /Personalise DatIQ/i })).toBeInTheDocument();
  });

  it("OAuth lands on / → returns to the task it started from", async () => {
    setPostAuthIntent("/preview");
    state.auth = { user: USER, arrivedViaAuthCallback: true };
    renderAt("/");
    await act(async () => {});
    expect(where()).toBe("/preview");
  });

  it("email-confirmation landing (callback, no stash) on / → /onboarding", async () => {
    state.auth = { user: USER, arrivedViaAuthCallback: true };
    renderAt("/");
    await act(async () => {});
    expect(where()).toBe("/onboarding");
  });

  it("a plain reload with a stored session never redirects", async () => {
    renderAt("/");
    await act(async () => {});
    expect(where()).toBe("/");
  });

  it("an onboarded account is never sent to onboarding", async () => {
    state.persona = { onboarded: true, synced: true };
    setPostAuthIntent("/pricing");
    renderAt("/pricing");
    await act(async () => {});
    expect(where()).toBe("/pricing");
  });

  it("waits for the account's saved role before deciding", async () => {
    state.persona = { onboarded: false, synced: false };
    setPostAuthIntent("/");
    renderAt("/");
    await act(async () => {});
    expect(where()).toBe("/");
    expect(peekPostAuthIntent()).not.toBeNull(); // still waiting, not consumed
  });

  it("does not interrupt an exempt landing", async () => {
    setPostAuthIntent("/");
    state.auth = { user: USER, arrivedViaAuthCallback: true };
    renderAt("/reset-password");
    await act(async () => {});
    expect(where()).toBe("/reset-password");
  });
});

describe("PersonaNudge", () => {
  it("hidden for guests and onboarded accounts", () => {
    state.auth = { user: null };
    const { unmount } = renderAt("/preview");
    expect(screen.queryByRole("region", { name: /Personalise/i })).toBeNull();
    unmount();
    state.auth = { user: USER };
    state.persona = { onboarded: true, synced: true };
    renderAt("/preview");
    expect(screen.queryByRole("region", { name: /Personalise/i })).toBeNull();
  });

  it("the button opens onboarding with this page as next", async () => {
    renderAt("/preview");
    act(() => screen.getByRole("button", { name: /Tailor DatIQ to your role/i }).click());
    await act(async () => {});
    expect(where()).toBe("/onboarding?next=%2Fpreview");
  });

  it("'Not now' hides it", () => {
    renderAt("/preview");
    act(() => screen.getByRole("button", { name: /Not now/i }).click());
    expect(screen.queryByRole("region", { name: /Personalise/i })).toBeNull();
  });
});
