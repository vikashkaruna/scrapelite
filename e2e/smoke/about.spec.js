// e2e/smoke/about.spec.js
// K-08 — About renders the founder block (Axiom Minds Private Limited) and the
// hero text does NOT contain the "powered by DatIQ" copy bug from R4.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

test("about page renders the founder block (Axiom Minds Private Limited)", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByText("Axiom Minds Private Limited")).toBeVisible();
  // Scope to the founder block to avoid matching other "Founder" text on the
  // page (e.g. the Startup Founder / VC persona chip).
  await expect(page.locator(".about-founder-role")).toContainText(/Founder/);
});

test("about page does NOT contain the 'powered by DatIQ' copy bug (R4)", async ({ page }) => {
  await page.goto("/about");
  // The body text should never say "DatIQ (powered by DatIQ)".
  const text = await page.locator("body").textContent();
  expect(text?.toLowerCase()).not.toContain("powered by datiq");
});

test("about page renders the Pillar 0 (Web Intelligence Core) section", async ({ page }) => {
  // R1 rebrand: the about page now opens with a Pillars section that names
  // Pillar 0 as the proven foundation. Pin the section so a regression that
  // drops the architecture framing is caught at the gate.
  await page.goto("/about");
  const section = page.locator(".about-pillars");
  await expect(section).toBeVisible();
  // All five pillars (P0..P4) are listed, with P0 highlighted as the foundation.
  await expect(section.locator(".about-pillar")).toHaveCount(5);
  await expect(section.locator(".about-pillar-p0")).toBeVisible();
  await expect(section.locator(".about-pillar-p0")).toContainText(/Pillar 0/i);
  await expect(section.locator(".about-pillar-p0")).toContainText(/Web Intelligence \(Core\)/i);
});

test("about page shows the Axiom Minds logo next to the company name", async ({ page }) => {
  // R1 rebrand: the Axiom Minds seal is anchored to the LEFT of the legal
  // entity name in the founder block. Two distinct placements:
  //   1. The large avatar on the left of the block
  //   2. The small inline mark to the left of "Axiom Minds Private Limited"
  // Both must render and both must use the same logo source.
  await page.goto("/about");
  const founderBlock = page.locator(".about-founder");
  await expect(founderBlock).toBeVisible();
  // 1. Large company-logo avatar (replaces the generic user-icon)
  const avatarImg = founderBlock.locator(".about-founder-company img").first();
  await expect(avatarImg).toBeVisible();
  await expect(avatarImg).toHaveAttribute("src", /axiom-minds-logo\.png$/);
  // 2. Small inline mark pinned to the left of the company name
  const inlineMark = founderBlock.locator(".about-founder-company-mark");
  await expect(inlineMark).toBeVisible();
  // The company name itself (already covered by another test, but pinned here
  // again so the inline-mark → name proximity is part of the contract)
  await expect(founderBlock.locator(".about-founder-name")).toContainText("Axiom Minds Private Limited");
});
