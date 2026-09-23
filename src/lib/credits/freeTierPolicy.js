// freeTierPolicy.js — who may receive the Free lifetime grant.
//
// PURE. No I/O, no clock reads that are not injected. Imported by the server
// that issues the grant and available to any surface that wants to explain the
// refusal, exactly like entitlementModel.js.
//
// ── WHY THIS GUARDS THE GRANT AND NOT THE SIGNUP ────────────────────────────
// The obvious place for abuse controls is account creation. Signup here goes
// straight from the browser to Supabase Auth, so intercepting it would mean an
// auth hook, a second identity path, and a new way to lock people out of their
// own accounts.
//
// The grant is a better boundary anyway, because it is where the thing of
// value is actually handed over. Someone may create an account, look around,
// read the docs and decide — none of that costs us a provider call. What costs
// money is the 100 credits, and that is what this gates. A refused grant also
// leaves a usable account rather than a failed signup, so a false positive
// costs somebody a top-up conversation instead of the product.
//
// ── 🔴 NO DEVICE FINGERPRINTING. NOT NOW, NOT LATER. ────────────────────────
// It is the control this would naturally reach for next and it is explicitly
// out of scope. It tracks people across sites they did not consent to be
// tracked on, it is unreliable enough to lock out legitimate users behind
// shared or privacy-hardened browsers, and it is a privacy commitment this
// product has already made in public. The IP check below is a COARSE, hashed,
// windowed count — not an identifier, not persistent, and not linked to a
// device.

/**
 * Disposable-mail providers. Deliberately SHORT and deliberately the obvious
 * ones: a long list is a maintenance burden that goes stale, and the goal is
 * to raise the cost of farming a hundred free pools, not to win an arms race
 * nobody wins.
 *
 * ⚠️ A DOMAIN HERE IS REFUSED THE GRANT, NOT THE ACCOUNT. They can still sign
 * up, still be invited to a workspace, and still buy a plan.
 */
export const DISPOSABLE_DOMAINS = Object.freeze(new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com",
  "10minutemail.com", "tempmail.com", "temp-mail.org", "throwawaymail.com",
  "yopmail.com", "trashmail.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "fakeinbox.com", "mailnesia.com", "mohmal.com",
  "spamgourmet.com", "tempinbox.com", "emailondeck.com", "burnermail.io",
]));

/** How many Free grants one IP may receive in the window. */
export const MAX_FREE_GRANTS_PER_IP = 3;
export const IP_WINDOW_HOURS = 24;

/** The bare domain of an email, lower-cased. Null when it is not an address. */
export function emailDomain(email) {
  const at = String(email || "").lastIndexOf("@");
  if (at < 1 || at === String(email).length - 1) return null;
  return String(email).slice(at + 1).trim().toLowerCase() || null;
}

/**
 * ⚠️ SUBDOMAINS COUNT. `foo.mailinator.com` is mailinator; matching only the
 * exact string is how a one-character bypass works.
 */
export function isDisposable(email, list = DISPOSABLE_DOMAINS) {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (list.has(domain)) return true;
  for (const bad of list) {
    if (domain.endsWith(`.${bad}`)) return true;
  }
  return false;
}

/** Outcomes. Stable identifiers — they travel in ledger meta and in logs. */
export const FREE_GRANT = Object.freeze({
  OK: "ok",
  UNVERIFIED: "email_unverified",
  DISPOSABLE: "disposable_domain",
  IP_LIMIT: "ip_limit",
});

/**
 * May this account receive the Free lifetime grant?
 *
 * 🔴 EVERY UNKNOWN READS AS ELIGIBLE. `ipGrants` of null means we could not
 * count — not that the limit was hit. Refusing the taster because a lookup
 * failed would turn an infrastructure blip into "this product gave me
 * nothing", which is the first impression it would be making. Same asymmetry
 * requireEntitlement holds, and the same one creditMeter.affords() holds.
 */
export function freeGrantEligibility({
  email = "", emailVerified = null, ipGrants = null, disposableList = DISPOSABLE_DOMAINS,
} = {}) {
  // ⚠️ `false` refuses; `null` (we do not know) does not. An account resolved
  // without its verification state must not be punished for our lookup.
  if (emailVerified === false) {
    return { ok: false, reason: FREE_GRANT.UNVERIFIED,
      message: "Confirm your email address to receive your free credits." };
  }
  if (email && isDisposable(email, disposableList)) {
    return { ok: false, reason: FREE_GRANT.DISPOSABLE,
      message: "Free credits aren't available for disposable email addresses. Sign up with a permanent address, or choose a plan." };
  }
  if (Number.isFinite(ipGrants) && ipGrants >= MAX_FREE_GRANTS_PER_IP) {
    return { ok: false, reason: FREE_GRANT.IP_LIMIT,
      message: "We've issued the free allowance to several accounts from this network recently. Try again later, or choose a plan." };
  }
  return { ok: true, reason: FREE_GRANT.OK };
}
