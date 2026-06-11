const MIGRATION_FLAG = "datiq.migrated";

const KEY_MAP = [
  ["scrapelite.persona",           "datiq.persona"],
  ["scrapelite.onboarded",         "datiq.onboarded"],
  ["scrapelite.userName",          "datiq.userName"],
  ["scrapelite.currency",          "datiq.currency"],
  ["scrapelite.coupons",           "datiq.coupons"],
  ["scrapelite.adminUsers",        "datiq.adminUsers"],
  ["scrapelite.pricingOverrides",  "datiq.pricingOverrides"],
  ["scrapelite.globalDiscount",    "datiq.globalDiscount"],
  ["scrapelite.topupOverrides",    "datiq.topupOverrides"],
  ["scrapelite.saved",             "datiq.saved"],
  ["scrapelite.pendingPayment",    "datiq.pendingPayment"],
  ["scrapelite.usage",             "datiq.usage"],
  ["scrapelite.subscription",      "datiq.subscription"],
  ["scrapelite.alertConfig",       "datiq.alertConfig"],
  ["scrapelite.alertedThresholds", "datiq.alertedThresholds"],
  ["scrapelite.currencyRates",     "datiq.currencyRates"],
  ["scrapelite.sessionId",         "datiq.sessionId"],
  ["scrapelite.theme",             "datiq.theme"],
  ["scrapelite.dashLayout",        "datiq.dashLayout"],
  ["scrapelite.current",           "datiq.current"],
  ["scrapelite.enrichments",       "datiq.enrichments"],
  ["scrapelite.stats",             "datiq.stats"],
  ["scrapelite.subscribers",       "datiq.subscribers"],
];

export function runMigrations() {
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;
    let migrated = 0;
    for (const [oldKey, newKey] of KEY_MAP) {
      const val = localStorage.getItem(oldKey);
      if (val !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, val);
        migrated++;
      }
    }
    // Also migrate any datiq.tip.* keys from scrapelite.tip.*
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("scrapelite.tip.")) {
        const newKey = k.replace("scrapelite.tip.", "datiq.tip.");
        if (localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, localStorage.getItem(k));
          migrated++;
        }
      }
    }
    localStorage.setItem(MIGRATION_FLAG, "1");
    if (migrated > 0) console.log(`[DatIQ] Migrated ${migrated} localStorage keys.`);
  } catch {}
}
