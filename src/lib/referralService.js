// src/lib/referralService.js — the referral loop, client half.
//
// "Invite a friend, you both get 25 extractions."
//
// ── WHAT THIS USED TO DO, AND WHY NONE OF IT WORKED ──────────────────────────
// The whole feature lived in localStorage, and every load-bearing part of it
// was broken:
//
//   1. The invite code came from an LCG, `h = (h * 1103515245 + 12345) >>> 0`.
//      With h up to 2^32-1 that product reaches ~1e18 — about 110x past
//      Number.MAX_SAFE_INTEGER — so the double rounded the low bits to zero,
//      `>>> 0` kept the zeros, and `% 32` was ALWAYS 0. Every user on the
//      platform got the same code: "AAAAAAAA". Attribution was impossible even
//      in principle.
//   2. Redemption wrote `datiq.referralBonus`, which nothing read except the
//      banner's own label. The quota reads `subscription.bonusExtractions`. So
//      the banner said "you have 25 bonus extractions" on the same screen that
//      refused to extract.
//   3. Redemption happened in the INVITEE's browser, so the referrer — the
//      person the reward exists to motivate — was never credited, despite the
//      copy promising both sides get 25.
//   4. The self-referral check compared against the code in the same
//      localStorage, so any second browser profile farmed it without limit.
//
// A referral grants real, paid quota. Codes are therefore minted by the server
// and rewards applied by the server (netlify/functions/referral.js →
// supabase/migrations/0029_referrals.sql). This module fetches and reports; it
// never computes a code, decides eligibility, or adds up a bonus.
//
// ── Signed-in only ───────────────────────────────────────────────────────────
// Both issuing and redeeming need an account, for the same reason scrape
// consent does: an anonymous identity can be cleared and re-made without limit.
// A guest who lands on ?ref=CODE has it STASHED and redeemed once they sign up
// — which is what the copy has always described ("when they sign up with your
// link").

import { apiClient } from "./apiClient.js";

/** Extractions granted to EACH side. Mirrors REFERRAL_BONUS on the server;
 *  display only — the server decides what is actually granted. */
export const REFERRAL_BONUS = 25;

// sessionStorage, not localStorage: OAuth navigates the document away and back,
// which discards in-memory state, but a stashed code should not outlive the
// visit that arrived with it. Same reasoning as lib/pendingSchedule.js.
const PENDING_KEY = "datiq.pendingReferral";

/** Shape a user could plausibly have typed or been sent. */
const CODE_RE = /^[A-Z0-9]{6,12}$/;

export function normalizeCode(code) {
  if (!code || typeof code !== "string") return "";
  const clean = code.trim().toUpperCase();
  return CODE_RE.test(clean) ? clean : "";
}

// ── Pending code (guest arrives on ?ref=, signs up later) ────────────────────

/** Stash an invite code to redeem once a session exists. */
export function setPendingReferral(code) {
  const clean = normalizeCode(code);
  if (!clean) return false;
  try { sessionStorage.setItem(PENDING_KEY, clean); return true; } catch { return false; }
}

export function getPendingReferral() {
  try { return sessionStorage.getItem(PENDING_KEY) || ""; } catch { return ""; }
}

export function clearPendingReferral() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* skip */ }
}

// ── Server-backed code + stats ───────────────────────────────────────────────

/**
 * This user's invite code and referral standing.
 * Returns { code, referrals, bonus, degraded }. `code` is null when the user
 * is signed out or the store cannot answer — callers must render nothing
 * rather than invent a code, which is precisely how "AAAAAAAA" reached users.
 */
export async function fetchReferralStatus() {
  try {
    const res = await apiClient.getReferral();
    return {
      code: res?.code || null,
      referrals: res?.referrals ?? 0,
      bonus: res?.bonus ?? 0,
      degraded: res?.degraded === true,
    };
  } catch {
    return { code: null, referrals: 0, bonus: 0, degraded: true };
  }
}

/**
 * Redeem an invite code for the signed-in user. The server credits both sides.
 * Returns { ok, bonus?, reason?, error? } — never throws, so a caller can
 * report the refusal without a try/catch around every call site.
 */
export async function redeemReferralCode(code) {
  const clean = normalizeCode(code);
  if (!clean) return { ok: false, reason: "invalid", error: "That doesn't look like a valid invite code." };
  try {
    const res = await apiClient.redeemReferral(clean);
    return { ok: true, bonus: res?.bonus ?? REFERRAL_BONUS };
  } catch (err) {
    // The server owns the wording for each verdict, so the two can't drift.
    return {
      ok: false,
      reason: err?.reason || (err?.status === 401 ? "signin" : "unavailable"),
      error: err?.message || "Couldn't redeem that code. Please try again.",
    };
  }
}

// ── URL helper ───────────────────────────────────────────────────────────────
export function buildReferralUrl(code, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "https://datiq.app");
  return `${base}/?ref=${encodeURIComponent(code)}`;
}
