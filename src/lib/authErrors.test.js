import { describe, expect, it } from "vitest";
import { classifyAuthError } from "./authErrors.js";

/**
 * U-48 — authErrors maps Supabase auth error shapes to friendly UI copy.
 * The classifier must:
 *   - recognize the "Email link is invalid or has expired" surface error
 *     and offer an actionable next step (the original bug report)
 *   - recognize the common sign-up / sign-in failure modes
 *   - fall back gracefully for anything it doesn't know
 */

describe("classifyAuthError — Supabase auth surface errors (U-48)", () => {
  it("maps 'Email link is invalid or has expired' to the friendly title + back-to-signin CTA", () => {
    const r = classifyAuthError(new Error("Email link is invalid or has expired"));
    expect(r.title).toBe("This link is no longer valid");
    expect(r.message).toMatch(/sign in below with your email and password/);
    expect(r.cta).toEqual({ label: "Back to sign in", action: "back-to-signin" });
  });

  it("maps 'Email not confirmed' to the confirmation prompt with resend CTA", () => {
    const r = classifyAuthError(new Error("Email not confirmed"));
    expect(r.title).toBe("Please confirm your email first");
    expect(r.cta).toEqual({ label: "Resend confirmation", action: "resend-confirmation" });
  });

  it("maps 'User already registered' to the sign-in nudge", () => {
    const r = classifyAuthError(new Error("User already registered"));
    expect(r.title).toBe("Account already exists");
    expect(r.cta).toEqual({ label: "Back to sign in", action: "back-to-signin" });
  });

  it("maps 'Invalid login credentials' to the credentials hint with reset CTA", () => {
    const r = classifyAuthError(new Error("Invalid login credentials"));
    expect(r.title).toBe("Email or password is incorrect");
    expect(r.cta).toEqual({ label: "Reset password", action: "open-forgot" });
  });

  it("maps short-password errors to the length hint", () => {
    const r = classifyAuthError(new Error("Password should be at least 6 characters"));
    expect(r.title).toBe("Password is too short");
  });

  it("maps rate-limit errors to the slow-down prompt", () => {
    const r = classifyAuthError(new Error("Email rate limit exceeded"));
    expect(r.title).toBe("Too many attempts");
  });

  it("maps disabled-signup errors to the closed prompt", () => {
    const r = classifyAuthError(new Error("Signups not allowed"));
    expect(r.title).toBe("Sign-up is currently closed");
  });

  it("maps network-shape errors to the connectivity prompt", () => {
    const r = classifyAuthError(new Error("TypeError: Failed to fetch"));
    expect(r.title).toBe("Couldn't reach the auth server");
  });
});

describe("classifyAuthError — input shapes (U-48)", () => {
  it("accepts a bare string", () => {
    const r = classifyAuthError("Email link is invalid or has expired");
    expect(r.title).toBe("This link is no longer valid");
  });

  it("accepts a Supabase error_code / message object", () => {
    const r = classifyAuthError({
      code: "otp_expired",
      message: "Token has expired",
    });
    expect(r.title).toBe("This link is no longer valid");
  });

  it("accepts a { error_description } shape (used by the URL-hash parser)", () => {
    const r = classifyAuthError({
      error_description: "Email link is invalid or has expired",
    });
    expect(r.title).toBe("This link is no longer valid");
  });

  it("returns the fallback for null / empty / unknown errors", () => {
    expect(classifyAuthError(null).title).toBe("Authentication failed");
    expect(classifyAuthError("").title).toBe("Authentication failed");
    expect(classifyAuthError(new Error("totally novel failure mode")).title).toBe(
      "Authentication failed",
    );
  });

  it("fallback always includes an actionable CTA (reset password)", () => {
    const r = classifyAuthError(new Error("???"));
    expect(r.cta).toEqual({ label: "Reset password", action: "open-forgot" });
  });
});
