// authService.js — thin wrapper over Supabase Auth.
// Supports email/password, Google, Microsoft (Azure), and GitHub OAuth.
// All functions degrade gracefully when Supabase is not configured.

import { supabase } from "./supabaseClient.js";
import { AUTH_RETURN_URL } from "./config.js";

export const authEnabled = Boolean(supabase);

// Where the user should land after an OAuth / email-link callback.
// Set by runtime-config.js per branch (main → datiq.app, everything else
// → the branch's own origin). Falls back to window.location.origin if the
// runtime config didn't specify one (older branches / dev).
const returnUrl = AUTH_RETURN_URL || (typeof window !== "undefined" ? window.location.origin : "");

// ── Sign-in / Sign-up ─────────────────────────────────────────────────────────

export async function signInWithEmail(email, password) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email, password) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Redirect back to this branch's origin (not the production primary).
      emailRedirectTo: returnUrl,
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithOAuth(provider) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const options = {
    redirectTo: returnUrl,
  };
  if (provider === "azure") options.scopes = "openid profile email";

  const { data, error } = await supabase.auth.signInWithOAuth({ provider, options });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ── Password reset ───────────────────────────────────────────────────────────

/**
 * Send a password-reset email. The link in the email lands the user back on
 * `<returnUrl>/reset-password#access_token=...&type=recovery` where they can
 * pick a new password. Requires Supabase Site URL + redirect allowlist to
 * include `<returnUrl>/reset-password` — see docs/SUPABASE-AUTH-REDIRECT-URLS.md.
 */
export async function resetPasswordForEmail(email) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const redirectTo = `${returnUrl}/reset-password`;
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  return data;
}

/**
 * Update the password for the currently signed-in user. Used on the
 * /reset-password page after the user arrives via the recovery link.
 */
export async function updatePassword(newPassword) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
}

/**
 * Merge fields into the signed-in user's own `user_metadata`. This is a
 * client-writable field on the user's OWN record — Supabase Auth enforces
 * that a caller can only ever update their own metadata via this API, so it
 * needs no server function and no RLS policy, unlike an admin-assigned field
 * (coupon_availed, bonus_extractions) which is written via the Auth Admin
 * API from a Netlify Function instead. Never throws — this is UX
 * convenience (cross-device persona sync), not an authorization write, so a
 * failure here must not block the caller's own local state change.
 */
export async function updateUserMetadata(fields) {
  if (!supabase) return { ok: false, reason: "not_configured" };
  try {
    const { error } = await supabase.auth.updateUser({ data: fields });
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "unknown" };
  }
}

/**
 * Resend the signup confirmation email. The link uses the same
 * `emailRedirectTo` as the original signup (origin).
 */
export async function resendSignUpConfirmation(email) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const { data, error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return data;
}

// ── Session helpers ───────────────────────────────────────────────────────────

export async function getSession() {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthStateChange(callback) {
  if (!supabase) return () => {};
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
}

// ── User display helpers ──────────────────────────────────────────────────────

export function getUserDisplayName(user) {
  if (!user) return "";
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "User"
  );
}

export function getUserInitials(user) {
  const name = getUserDisplayName(user);
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getUserAvatar(user) {
  return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
}
