import { UsageUpsellBanner } from "datiq";

// UsageUpsellBanner has no prop seam — it reads useBilling() (usage,
// subscription, plan) and derives copy from paywallCopy.buildPaywallCopy().
// It only renders at >=80% of the plan's extraction quota. BillingProvider
// seeds its subscription/usage state SYNCHRONOUSLY from these exact
// localStorage keys on first mount (lazy useState(() => readSubscription())
// / useState(() => readUsage()) in src/lib/usageService.js), so writing
// them here before the tree mounts reproduces the real "near quota"
// trigger honestly — this is the app's own persistence path, not a
// fabricated render.
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
  planId: "free",
  activatedAt: null,
  addons: [],
  coupon: null,
  bonusExtractions: 0,
});
seed("datiq.usage", {
  [monthKey()]: {
    month: monthKey(),
    extractions: 9, // Free plan = 10/mo → 90% used, clears the >=80% trigger, not yet over
    enrichments: {},
    batchRuns: 1,
    contentGenerations: 0,
  },
});
try {
  localStorage.removeItem("datiq.upsellDismissedMonth");
} catch {
  /* no-op outside a browser */
}

export function NearMonthlyLimit() {
  return <UsageUpsellBanner />;
}
