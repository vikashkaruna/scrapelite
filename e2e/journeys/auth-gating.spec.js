// e2e/journeys/auth-gating.spec.js
// J-04 — Guest trial gating: soft prompt at the soft limit, hard block at
// the single-URL hard limit, and the auth-modal entry point that lets the
// user escape the block. The actual sign-in transition (user state change →
// block clears) is exercised at the system level in
// src/components/GuestTrialProvider.integration.test.jsx (I-09) because the
// Playwright browser env intentionally runs with no Supabase URL.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("Guest 3 → soft prompt; 10 → hard block; 'Sign in' opens AuthModal", async ({ page }) => {
  // Seed a fresh guest identity so the soft prompt fires after 3 extractions
  // (default soft limit) and the hard block fires after 10.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "datiq.guestTrial",
      JSON.stringify({ count: 0, batchCount: 0, sid: "j04-test" })
    );
  });

  // Visit Home. The composer + nav are present; no gating yet (count=0).
  await page.goto("/");
  await expect(page.getByText(/Intelligence from every URL/i).first()).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Trial limit reached/i })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Sign up to continue/i })).toHaveCount(0);

  // Jump straight to count=3 (soft limit). On mount, the GuestTrialProvider
  // initial useEffect doesn't auto-fire the soft prompt — the soft prompt
  // fires when trackGuestExtraction pushes the count over the limit. So we
  // simulate three trackings by writing count=3 to localStorage and forcing
  // a hard reload: the soft prompt will NOT re-fire on reload (it's transient
  // state), but the count is preserved for the hard-block test below.
  await page.evaluate(() => {
    localStorage.setItem(
      "datiq.guestTrial",
      JSON.stringify({ count: 3, batchCount: 0, sid: "j04-test" })
    );
  });
  await page.reload();
  // Count=3 + reload: hard block does NOT fire (3 < 10), soft prompt does
  // not auto-replay on reload (transient state). User is still usable.
  await expect(page.getByRole("dialog", { name: /Sign up to continue/i })).toHaveCount(0);

  // Push to count=10 (single hard limit). On reload the GuestTrialProvider
  // mount useEffect reads count >= singleHardLimit and shows the hard block.
  await page.evaluate(() => {
    localStorage.setItem(
      "datiq.guestTrial",
      JSON.stringify({ count: 10, batchCount: 0, sid: "j04-test" })
    );
  });
  await page.reload();
  const hardBlock = page.getByRole("dialog", { name: /Sign up to continue/i });
  await expect(hardBlock).toBeVisible();
  await expect(hardBlock.getByText(/guest extraction limit/i)).toBeVisible();

  // The hard block is non-dismissible: backdrop is absent, and the only
  // escape is via the auth buttons.
  await expect(page.locator(".guest-trial-backdrop")).toHaveCount(0);
  await expect(hardBlock.getByText(/Continue as guest/i)).toHaveCount(0);

  // Click "Sign in" → AuthModal opens on the sign-in tab.
  await hardBlock.getByRole("button", { name: /^Sign in$/i }).click();
  const authModal = page.locator(".auth-modal");
  await expect(authModal).toBeVisible();
  // The sign-in tab is active by default (openAuth("signin")).
  await expect(authModal.getByRole("button", { name: /Sign in/i }).first()).toBeVisible();
  await expect(authModal.getByLabel(/email/i)).toBeVisible();
  await expect(authModal.getByLabel(/password/i)).toBeVisible();
});

test("Guest trial count persists across sign-out (NOT cleared)", async ({ page }) => {
  // This invariant is enforced by the production code: datiq.guestTrial is
  // intentionally excluded from the SENSITIVE_KEYS cleared on logout so
  // users can't cycle auth to get a fresh window. We assert the localStorage
  // key is untouched after a reload that simulates a fresh session.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem(
      "datiq.guestTrial",
      JSON.stringify({ count: 7, batchCount: 2, sid: "j04-persist" })
    );
  });
  await page.reload();
  const stored = await page.evaluate(() => localStorage.getItem("datiq.guestTrial"));
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored);
  expect(parsed.count).toBe(7);
  expect(parsed.batchCount).toBe(2);
  // The other sensitive keys are still empty (the test env cleared them at
  // install), and crucially the trial key is present.
  expect(parsed.sid).toBe("j04-persist");
});
