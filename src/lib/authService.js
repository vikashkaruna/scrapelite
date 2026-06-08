// authService.js — thin wrapper over Supabase Auth.
// Supports email/password, Google, Microsoft (Azure), and GitHub OAuth.
// All functions degrade gracefully when Supabase is not configured.

import { supabase } from "./supabaseClient.js";

export const authEnabled = Boolean(supabase);

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
      // Redirect back to whatever origin the user signed up from so the
      // confirmation link works in both local dev and production.
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
  return data;
}

export async function signInWithOAuth(provider) {
  if (!supabase) throw new Error("Auth not configured — set VITE_SUPABASE_* env vars.");
  const options = {
    redirectTo: window.location.origin,
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
