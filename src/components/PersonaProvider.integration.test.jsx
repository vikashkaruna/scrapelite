// PersonaProvider.integration.test.jsx — cross-device persona/onboarding
// sync via Supabase user_metadata. The app already has full Supabase auth;
// what stayed local-only was PersonaProvider's own choice, so a signed-in
// user picking "SEO agency" on their laptop got asked again on their phone.
//
//   - Sign-in with a server persona already set → local state adopts it
//     (server wins).
//   - Sign-in with NOTHING on the server but a local choice already made
//     (as a guest) → pushes the local choice up.
//   - Selecting/completing/resetting while signed in fires a metadata write.
//   - None of this ever throws — a failed sync degrades to local-only.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PersonaProvider, usePersona } from "./PersonaProvider.jsx";
import * as authProvider from "./AuthProvider.jsx";
import * as authService from "../lib/authService.js";

vi.mock("./AuthProvider.jsx", async () => {
  const actual = await vi.importActual("./AuthProvider.jsx");
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return { ...actual, updateUserMetadata: vi.fn() };
});

function Capture() {
  const ctx = usePersona();
  Capture.last = ctx;
  return (
    <div>
      <span data-testid="personaId">{ctx.personaId || "(none)"}</span>
      <span data-testid="onboarded">{String(ctx.onboarded)}</span>
      <button onClick={() => ctx.selectPersona("sales")}>select</button>
      <button onClick={() => ctx.completeOnboarding("Alice")}>complete</button>
      <button onClick={() => ctx.resetOnboarding()}>reset</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authService.updateUserMetadata.mockResolvedValue({ ok: true });
});

describe("PersonaProvider — signed out", () => {
  it("reads/writes localStorage only, and never calls updateUserMetadata", async () => {
    authProvider.useAuth.mockReturnValue({ user: null });
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    await act(async () => screen.getByText("select").click());
    expect(screen.getByTestId("personaId").textContent).toBe("sales");
    expect(localStorage.getItem("datiq.persona")).toBe("sales");
    expect(authService.updateUserMetadata).not.toHaveBeenCalled();
  });
});

describe("PersonaProvider — sign-in reconciliation", () => {
  it("server persona wins over an empty local state", async () => {
    authProvider.useAuth.mockReturnValue({
      user: { id: "u1", user_metadata: { persona_id: "recruiter", onboarded: true, user_name: "Bob" } },
    });
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    expect(screen.getByTestId("personaId").textContent).toBe("recruiter");
    expect(screen.getByTestId("onboarded").textContent).toBe("true");
    expect(localStorage.getItem("datiq.persona")).toBe("recruiter");
  });

  it("pushes a local-only choice up when the server has nothing yet", async () => {
    localStorage.setItem("datiq.persona", "founder");
    authProvider.useAuth.mockReturnValue({ user: { id: "u1", user_metadata: {} } });
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    expect(authService.updateUserMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ persona_id: "founder" }),
    );
    // The local choice is left as-is — the server had nothing to prefer.
    expect(screen.getByTestId("personaId").textContent).toBe("founder");
  });

  it("only reconciles once per signed-in user, not on every re-render", async () => {
    authProvider.useAuth.mockReturnValue({
      user: { id: "u1", user_metadata: { persona_id: "recruiter", onboarded: true } },
    });
    let view;
    await act(async () => { view = render(<PersonaProvider><Capture /></PersonaProvider>); });
    authService.updateUserMetadata.mockClear();
    // Selecting a NEW persona locally must not re-trigger the sign-in merge
    // and overwrite the fresh selection with the stale server value.
    await act(async () => screen.getByText("select").click());
    view.rerender(<PersonaProvider><Capture /></PersonaProvider>);
    expect(screen.getByTestId("personaId").textContent).toBe("sales");
  });
});

describe("PersonaProvider — writes while signed in", () => {
  beforeEach(() => {
    authProvider.useAuth.mockReturnValue({ user: { id: "u1", user_metadata: { persona_id: "sales" } } });
  });

  it("selectPersona syncs the new choice", async () => {
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    authService.updateUserMetadata.mockClear();
    await act(async () => screen.getByText("select").click());
    expect(authService.updateUserMetadata).toHaveBeenCalledWith({ persona_id: "sales" });
  });

  it("completeOnboarding syncs onboarded + name", async () => {
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    authService.updateUserMetadata.mockClear();
    await act(async () => screen.getByText("complete").click());
    expect(authService.updateUserMetadata).toHaveBeenCalledWith({ onboarded: true, user_name: "Alice" });
  });

  it("resetOnboarding syncs a clear", async () => {
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    authService.updateUserMetadata.mockClear();
    await act(async () => screen.getByText("reset").click());
    expect(authService.updateUserMetadata).toHaveBeenCalledWith({
      persona_id: null, onboarded: false, user_name: null,
    });
  });

  it("a rejected sync never breaks the local state change", async () => {
    authService.updateUserMetadata.mockRejectedValue(new Error("network down"));
    await act(async () => render(<PersonaProvider><Capture /></PersonaProvider>));
    await act(async () => screen.getByText("select").click());
    expect(screen.getByTestId("personaId").textContent).toBe("sales");
  });
});
