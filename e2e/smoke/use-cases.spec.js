// e2e/smoke/use-cases.spec.js
// K-12 — Use Cases hub renders every card; subpage (e.g. /use-cases/lead-generation) renders.

import { expect, test } from "playwright/test";
import { installOfflineMocks } from "../support.js";

test.beforeEach(async ({ page }) => {
  await installOfflineMocks(page);
});

// Plan §22: the hub is one section per role (8), each linking to its pages.
test("/use-cases hub renders one section per role", async ({ page }) => {
  await page.goto("/use-cases");
  await expect(page.locator(".uc-hub-card")).toHaveCount(8);
  for (const name of [
    /Sales, SDR & BDR/, /RevOps & Growth Operations/, /Product Marketing Manager/,
    /SEO, Content, AEO & GEO/, /Brand, Growth & CRO/, /Founder, VC & Market Research/,
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  // Every older landing page is still reachable from the hub, plus the new ones.
  for (const name of [/Lead Generation/, /Investor Diligence/, /Recruiting Research/, /^RevOps$/, /^Product Marketing$/, /^Brand & CRO$/]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
});

test("new role pages render an H1", async ({ page }) => {
  for (const slug of ["revops", "product-marketing", "brand-cro"]) {
    await page.goto(`/use-cases/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("/use-cases/lead-generation subpage renders", async ({ page }) => {
  await page.goto("/use-cases/lead-generation");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
