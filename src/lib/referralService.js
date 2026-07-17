// src/lib/referralService.js — FA2 (referral credits loop: give 25 / get 25).
//
// Council intent: "Triggered at quota-exhaustion moment; classic PLG,
// near-zero build."
//
// Mechanic:
//   1. Every user has a 8-char invite code derived from their session id
//      (datiq.referralCode in localStorage).
//   2. Sharing the code via ?ref=CODE in a URL gets the referrer 25 bonus
//      extractions AND the new user 25 bonus extractions on their first
//      successful extraction.
//   3. The "Invite a friend, get 25 more" prompt appears at quota
//      exhaustion (called from the upsell banner).
//
// localStorage keys:
//   datiq.referralCode       — the user's own 8-char invite code
//   datiq.referralBonus      — bonus extractions granted to this user
//                              (sum of invitee + referrer rewards)
//   datiq.referralRedemptions — list of codes the user has already redeemed
//                                (prevents self-redemption)
//
// In a Supabase-enabled deployment, the redemption is mirrored to a
// `referrals` table via a future Netlify function — out of scope for v1.0+
// (the local-only path is fully functional and the UI never blocks on it).

import { getSessionId } from "./usageRepo.js";

const CODE_KEY = "datiq.referralCode";
const BONUS_KEY = "datiq.referralBonus";
const REDEEMED_KEY = "datiq.referralRedemptions";

export const REFERRAL_BONUS = 25; // both sides

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function lsRead(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function lsWrite(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* skip */ }
}

// ── Invite code generation ───────────────────────────────────────────────────
function generateCode() {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function hashSessionId(sid) {
  // Simple deterministic hash → 8 chars from the alphabet. Not cryptographically
  // secure (just a code, not auth) but stable across reloads.
  let h = 5381;
  for (let i = 0; i < sid.length; i++) {
    h = ((h * 33) ^ sid.charCodeAt(i)) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out += ALPHABET[h % ALPHABET.length];
  }
  return out;
}

/** Get (or create) this user's invite code. */
export function getMyReferralCode() {
  let code = lsRead(CODE_KEY, null);
  if (code) return code;
  // Derive a stable code from the session id; if no session yet, generate
  // a random one. Both forms are valid 8-char invite codes.
  try {
    const sid = getSessionId();
    if (sid) code = hashSessionId(sid);
  } catch { /* noop */ }
  if (!code) code = generateCode();
  lsWrite(CODE_KEY, code);
  return code;
}

/** Reset the invite code (for tests). */
export function _resetMyReferralCode() {
  lsWrite(CODE_KEY, null);
}

// ── Bonus + redemption tracking ──────────────────────────────────────────────
export function getReferralBonus() {
  return lsRead(BONUS_KEY, 0);
}

export function addReferralBonus(amount = REFERRAL_BONUS) {
  const next = getReferralBonus() + amount;
  lsWrite(BONUS_KEY, next);
  return next;
}

export function getRedeemedCodes() {
  return lsRead(REDEEMED_KEY, []);
}

export function hasRedeemedCode(code) {
  if (!code) return false;
  return getRedeemedCodes().includes(code);
}

function markCodeRedeemed(code) {
  const list = getRedeemedCodes();
  if (!list.includes(code)) {
    list.push(code);
    lsWrite(REDEEMED_KEY, list);
  }
}

// ── URL helper ───────────────────────────────────────────────────────────────
export function buildReferralUrl(code, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "https://datiq.app");
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

// ── Apply a referral code (called when a new user lands with ?ref=CODE) ──────
/**
 * Redeem an invite code. Returns:
 *   { ok: true, bonus: N }              — successfully redeemed
 *   { ok: false, reason: "self" }       — you can't redeem your own code
 *   { ok: false, reason: "already" }    — already redeemed this code
 *   { ok: false, reason: "invalid" }    — empty / wrong shape
 *
 * Side effects: adds REFERRAL_BONUS to datiq.referralBonus and writes the
 * code to datiq.referralRedemptions so subsequent calls are no-ops.
 */
export function redeemReferralCode(code) {
  if (!code || typeof code !== "string") {
    return { ok: false, reason: "invalid" };
  }
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(clean)) {
    return { ok: false, reason: "invalid" };
  }
  const myCode = getMyReferralCode();
  if (clean === myCode) {
    return { ok: false, reason: "self" };
  }
  if (hasRedeemedCode(clean)) {
    return { ok: false, reason: "already" };
  }
  markCodeRedeemed(clean);
  const bonus = addReferralBonus(REFERRAL_BONUS);
  return { ok: true, bonus };
}

// ── Reset all referral state (for tests) ────────────────────────────────────
export function _resetReferralsForTests() {
  lsWrite(CODE_KEY, null);
  lsWrite(BONUS_KEY, 0);
  lsWrite(REDEEMED_KEY, []);
}
