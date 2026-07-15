// test/fixtures/buildSubscription.js
// Factory for BillingProvider subscription state. Defaults match a freshly
// signed-up guest; tests pass overrides to model paid plans, coupons, or
// bonus-extraction grants.

/**
 * @typedef {Object} Subscription
 * @property {"free"|"select"|"pro"|"business"|"agency"|"enterprise"} planId
 * @property {"monthly"|"annual"} [billingPeriod]
 * @property {string} [status]
 * @property {string} [provider]
 * @property {number} [bonusExtractions]
 * @property {number} [bonusBatchUrls]
 * @property {string|null} [couponCode]
 * @property {number} [discountPercent]
 * @property {string|null} [trialCreditAppliedAt]
 * @property {string} [currentPeriodEnd]
 */

/**
 * Build a subscription fixture for tests.
 *
 * @param {Partial<Subscription>} [overrides]
 * @returns {Subscription}
 */
export function buildSubscription(overrides = {}) {
  return {
    planId: "free",
    billingPeriod: "annual",
    status: "active",
    provider: null,
    bonusExtractions: 0,
    bonusBatchUrls: 0,
    couponCode: null,
    discountPercent: 0,
    trialCreditAppliedAt: null,
    currentPeriodEnd: null,
    ...overrides,
  };
}

/**
 * Build a Pro monthly subscription — the most common "paid user" shape
 * used across integration and journey tests.
 *
 * @param {Partial<Subscription>} [overrides]
 * @returns {Subscription}
 */
export function buildProSubscription(overrides = {}) {
  return buildSubscription({
    planId: "pro",
    billingPeriod: "monthly",
    status: "active",
    provider: "stripe",
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ...overrides,
  });
}
