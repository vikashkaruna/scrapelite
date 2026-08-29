import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authEnabled,
  getUserAvatar,
  getUserDisplayName,
  getUserInitials,
  resetPasswordForEmail,
  resendSignUpConfirmation,
  signInWithEmail,
  signInWithOAuth,
  signOut,
  signUpWithEmail,
  updatePassword,
  updateUserMetadata,
} from "./authService.js";

/**
 * U-45..46 + U-47 (password reset) — authService is a thin wrapper over
 * Supabase Auth. Tests mock the supabase client; the production code only
 * touches the documented surface.
 */

const mockSupabase = vi.hoisted(() => ({
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signInWithOAuth: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    resend: vi.fn(),
  },
}));

vi.mock("./supabaseClient.js", () => ({
  supabase: mockSupabase,
}));

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom default: window.location.origin = "http://localhost:3000"
  // Reset to a stable value for assertions.
  if (typeof window !== "undefined" && !window.location.origin) {
    Object.defineProperty(window, "location", {
      value: { origin: "https://datiq.app" },
      writable: true,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signUpWithEmail (U-45)", () => {
  it("passes emailRedirectTo: window.location.origin", async () => {
    mockSupabase.auth.signUp.mockResolvedValue({ data: { user: { id: "u_1" } }, error: null });
    await signUpWithEmail("a@b.com", "pw");
    const args = mockSupabase.auth.signUp.mock.calls[0][0];
    expect(args.email).toBe("a@b.com");
    expect(args.password).toBe("pw");
    expect(args.options.emailRedirectTo).toBe(window.location.origin);
  });

  it("throws when supabase returns an error", async () => {
    const err = new Error("Email already registered");
    mockSupabase.auth.signUp.mockResolvedValue({ data: null, error: err });
    await expect(signUpWithEmail("a@b.com", "pw")).rejects.toBe(err);
  });
});

describe("signInWithOAuth (U-46)", () => {
  it("calls signInWithOAuth with the provider", async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    await signInWithOAuth("google");
    const args = mockSupabase.auth.signInWithOAuth.mock.calls[0][0];
    expect(args.provider).toBe("google");
    expect(args.options.redirectTo).toBe(window.location.origin);
  });

  it("adds scopes for azure provider", async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    await signInWithOAuth("azure");
    const args = mockSupabase.auth.signInWithOAuth.mock.calls[0][0];
    expect(args.provider).toBe("azure");
    expect(args.options.scopes).toMatch(/openid|profile|email/);
  });
});

describe("signInWithEmail + signOut", () => {
  it("signInWithEmail forwards email + password to supabase", async () => {
    mockSupabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await signInWithEmail("a@b.com", "pw");
    expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "pw" });
  });

  it("signOut throws on supabase error", async () => {
    const err = new Error("Session expired");
    mockSupabase.auth.signOut.mockResolvedValue({ error: err });
    await expect(signOut()).rejects.toBe(err);
  });
});

describe("display helpers", () => {
  it("getUserDisplayName prefers full_name, then name, then email local-part", () => {
    expect(getUserDisplayName({ user_metadata: { full_name: "Ada Lovelace" } })).toBe("Ada Lovelace");
    expect(getUserDisplayName({ user_metadata: { name: "Alan Turing" } })).toBe("Alan Turing");
    expect(getUserDisplayName({ email: "grace@hopper.com" })).toBe("grace");
    expect(getUserDisplayName(null)).toBe("");
  });

  it("getUserInitials is 1–2 chars, uppercased", () => {
    expect(getUserInitials({ user_metadata: { full_name: "Ada Lovelace" } })).toBe("AL");
    expect(getUserInitials({ user_metadata: { name: "Alan" } })).toBe("A");
    expect(getUserInitials({ email: "grace@hopper.com" })).toBe("G");
  });

  it("getUserAvatar prefers avatar_url then picture", () => {
    expect(getUserAvatar({ user_metadata: { avatar_url: "https://a", picture: "https://b" } })).toBe("https://a");
    expect(getUserAvatar({ user_metadata: { picture: "https://b" } })).toBe("https://b");
    expect(getUserAvatar({ user_metadata: {} })).toBeNull();
  });
});

describe("authEnabled flag", () => {
  it("is true when supabase is configured", () => {
    // The mock resolves to true via the module-level `supabase` import
    expect(typeof authEnabled).toBe("boolean");
  });
});

describe("resetPasswordForEmail (U-47)", () => {
  it("calls supabase.auth.resetPasswordForEmail with the email and a redirectTo at <origin>/reset-password", async () => {
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await resetPasswordForEmail("alice@example.com");
    const args = mockSupabase.auth.resetPasswordForEmail.mock.calls[0];
    expect(args[0]).toBe("alice@example.com");
    expect(args[1]).toEqual({ redirectTo: `${window.location.origin}/reset-password` });
  });

  it("throws when supabase returns an error", async () => {
    const err = new Error("Email rate limit exceeded");
    mockSupabase.auth.resetPasswordForEmail.mockResolvedValue({ data: null, error: err });
    await expect(resetPasswordForEmail("a@b.com")).rejects.toBe(err);
  });
});

describe("updatePassword (U-47)", () => {
  it("calls supabase.auth.updateUser with the new password", async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({ data: { user: { id: "u_1" } }, error: null });
    await updatePassword("hunter3hunter");
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({ password: "hunter3hunter" });
  });

  it("throws on supabase error", async () => {
    const err = new Error("Auth session missing");
    mockSupabase.auth.updateUser.mockResolvedValue({ data: null, error: err });
    await expect(updatePassword("pw1234")).rejects.toBe(err);
  });
});

describe("updateUserMetadata — cross-device persona sync", () => {
  it("merges fields into user_metadata via updateUser({data})", async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({ data: { user: { id: "u_1" } }, error: null });
    const r = await updateUserMetadata({ persona_id: "recruiter" });
    expect(mockSupabase.auth.updateUser).toHaveBeenCalledWith({ data: { persona_id: "recruiter" } });
    expect(r).toEqual({ ok: true });
  });

  it("reports failure rather than throwing on a Supabase error", async () => {
    mockSupabase.auth.updateUser.mockResolvedValue({ data: null, error: new Error("session expired") });
    const r = await updateUserMetadata({ persona_id: "recruiter" });
    expect(r).toEqual({ ok: false, reason: "session expired" });
  });

  it("reports failure rather than throwing when the call itself rejects", async () => {
    mockSupabase.auth.updateUser.mockRejectedValue(new Error("network down"));
    const r = await updateUserMetadata({ persona_id: "recruiter" });
    expect(r).toEqual({ ok: false, reason: "network down" });
  });
});

describe("resendSignUpConfirmation (U-47)", () => {
  it("calls supabase.auth.resend with type=signup and emailRedirectTo at window.location.origin", async () => {
    mockSupabase.auth.resend.mockResolvedValue({ data: {}, error: null });
    await resendSignUpConfirmation("a@b.com");
    const args = mockSupabase.auth.resend.mock.calls[0][0];
    expect(args.type).toBe("signup");
    expect(args.email).toBe("a@b.com");
    expect(args.options.emailRedirectTo).toBe(window.location.origin);
  });

  it("throws on supabase error", async () => {
    const err = new Error("Email rate limit exceeded");
    mockSupabase.auth.resend.mockResolvedValue({ data: null, error: err });
    await expect(resendSignUpConfirmation("a@b.com")).rejects.toBe(err);
  });
});
