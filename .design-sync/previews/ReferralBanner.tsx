import { ReferralBanner } from "datiq";

// ReferralBanner has no prop seam — every input comes from useBilling()
// (plan + usage) and localStorage (invite code, dismiss state). It only
// renders once the signed-in-or-guest user is within 10% of their plan's
// extraction quota. BillingProvider seeds its subscription/usage state
// SYNCHRONOUSLY from these exact localStorage keys on first mount (lazy
// useState(() => readSubscription()) / useState(() => readUsage()) in
// src/lib/usageService.js), so writing them here before the tree mounts
// reproduces the real "near quota" trigger honestly — this is the app's
// own persistence path, not a fabricated render.
//
// Only ONE story: BillingProvider is a single instance shared by every
// story mounted on this page, and this module-level seed runs once at
// import time — a second story with a different billing state would just
// read the same seeded values (see the WatchlistCard precedent in
// .design-sync/NOTES.md for the same class of problem).
function seed(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no-op outside a browser */
  }
}

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

seed("datiq.subscription", {
  planId: "select",
  activatedAt: new Date(Date.now() - 42 * 86_400_000).toISOString(),
  addons: [],
  coupon: null,
  bonusExtractions: 0,
});
seed("datiq.usage", {
  [monthKey()]: {
    month: monthKey(),
    extractions: 470, // Select plan = 500/mo → 94% used, clears the >=90% trigger
    enrichments: {},
    batchRuns: 6,
    contentGenerations: 2,
  },
});
seed("datiq.referralCode", "SHARE25X");
seed("datiq.referralBonus", 25);
try {
  localStorage.removeItem("datiq.referralDismissedMonth");
} catch {
  /* no-op outside a browser */
}

export function NearQuotaInvite() {
  return <ReferralBanner />;
}
