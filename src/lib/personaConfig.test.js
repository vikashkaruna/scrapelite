import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PERSONAS, LEGACY_PERSONAS, PERSONA_BY_ID, LEGACY_PERSONA_ALIASES, ALL_PERSONA_IDS, resolvePersonaId,
} from "./personaConfig.js";
import { ROLE_MODULES } from "./roleModules.js";
import { QUICK_ACTIONS } from "./extractionPresets.js";
import { RECIPE_PACKS } from "./extractionTemplates.js";
import { PERSONA_PACKS } from "./discoverability/personaPacks.js";
import { PERSONA_TO_ACTIVATION } from "./pql/pqlModel.js";
import { SEED_TEMPLATES } from "./templates/seedTemplates.js";
import { TEMPLATE_ROLES, rolesForTemplate } from "./templates/templateRoles.js";

/**
 * The role model (owner, 2026-09-24): eight roles, two retired ids that still
 * resolve. Everything here is DERIVED from PERSONAS, so a ninth role added
 * later fails the build until every surface below knows about it — a list
 * that restates the roles would pass the day it was written and drift after.
 */

// Top-level routes the app serves (App.jsx), read rather than restated.
const APP_ROUTES = new Set(
  [...readFileSync(resolve(process.cwd(), "src/App.jsx"), "utf8").matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);
const routeOf = (to) => to.split("?")[0];
const PUBLISHED_TEMPLATES = new Set(SEED_TEMPLATES.filter((t) => t.status === "published").map((t) => t.template_key));

describe("the eight roles", () => {
  it("are exactly the owner's eight, in order", () => {
    expect(PERSONAS.map((p) => p.id)).toEqual([
      "sales", "revops", "competitive-intel", "pmm", "seo", "brand-growth", "founder-vc", "agency",
    ]);
  });

  it("ids are unique across current and legacy roles and aliases", () => {
    expect(new Set(ALL_PERSONA_IDS).size).toBe(ALL_PERSONA_IDS.length);
  });

  it.each(PERSONAS.map((p) => [p.id, p]))("%s has every field the product reads", (_id, p) => {
    for (const k of ["label", "shortLabel", "icon", "color", "job", "outcome", "tagline", "subtitle", "badge",
      "welcomeTitle", "welcomeBody", "guideTip", "dashboardLabel", "starterPack"]) {
      expect(p[k], `${p.id}.${k}`).toBeTruthy();
    }
    expect(p.jobs.length).toBeGreaterThanOrEqual(3);
    expect(p.jobs.length).toBeLessThanOrEqual(5);
    expect(p.examples.length).toBeGreaterThan(0);
  });
});

describe("every role points only at real things", () => {
  const all = [...PERSONAS, ...LEGACY_PERSONAS];

  it.each(all.map((p) => [p.id, p]))("%s: modules, first step, packs and quick actions exist", (_id, p) => {
    for (const j of p.jobs) expect(ROLE_MODULES[j.module], `${p.id} job → ${j.module}`).toBeTruthy();
    for (const m of p.modules) expect(ROLE_MODULES[m], `${p.id} module → ${m}`).toBeTruthy();
    // A module a job relies on must be listed among the role's modules.
    for (const j of p.jobs) expect(p.modules, `${p.id} lists ${j.module}`).toContain(j.module);

    expect(APP_ROUTES, `${p.id} firstStep ${p.firstStep.to}`).toContain(routeOf(p.firstStep.to));
    const key = new URLSearchParams(p.firstStep.to.split("?")[1] || "").get("key");
    if (key) expect(PUBLISHED_TEMPLATES, `${p.id} firstStep template ${key}`).toContain(key);

    expect(RECIPE_PACKS.map((x) => x.key)).toContain(p.starterPack);
    const quick = new Set(QUICK_ACTIONS.map((q) => q.key));
    for (const q of p.quickActions) expect(quick, `${p.id} quick action ${q}`).toContain(q);
    if (p.discoverPack) expect(PERSONA_PACKS[p.discoverPack], `${p.id} → ${p.discoverPack}`).toBeTruthy();
    expect(PERSONA_TO_ACTIVATION[p.id], `${p.id} PQL activation`).toBeTruthy();
  });

  it("every module a role can point at names a real route", () => {
    for (const m of Object.values(ROLE_MODULES)) expect(APP_ROUTES, m.key).toContain(m.to);
  });
});

describe("retired ids keep working", () => {
  it("market-research resolves to Founder, VC & Market Research", () => {
    expect(resolvePersonaId("market-research")).toBe("founder-vc");
    expect(PERSONA_BY_ID["market-research"]).toBe(PERSONA_BY_ID["founder-vc"]);
  });

  it("recruiter stays a hidden legacy role — resolvable, not offered", () => {
    expect(PERSONA_BY_ID.recruiter?.legacy).toBe(true);
    expect(PERSONAS.some((p) => p.id === "recruiter")).toBe(false);
    expect(resolvePersonaId("recruiter")).toBe("recruiter");
  });

  it("every alias lands on a current role", () => {
    for (const to of Object.values(LEGACY_PERSONA_ALIASES)) expect(PERSONAS.map((p) => p.id)).toContain(to);
  });

  it("the gallery CHECK constraint allows exactly the ids a stored value may hold", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0084_role_ids.sql"), "utf8");
    const allowed = [...sql.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(allowed)).toEqual(new Set(ALL_PERSONA_IDS));
  });
});

describe("template roles", () => {
  it("every published template serves at least one role, and only real ones", () => {
    for (const t of SEED_TEMPLATES.filter((x) => x.status === "published")) {
      const roles = rolesForTemplate(t);
      expect(roles.length, t.template_key).toBeGreaterThan(0);
      for (const r of roles) expect(PERSONA_BY_ID[r], `${t.template_key} → ${r}`).toBeTruthy();
    }
  });

  it("the role map names no template that does not exist", () => {
    for (const key of Object.keys(TEMPLATE_ROLES)) expect(PUBLISHED_TEMPLATES, key).toContain(key);
  });

  it("every current role has at least one template, so its filter is never empty", () => {
    const served = new Set(SEED_TEMPLATES.filter((t) => t.status === "published").flatMap(rolesForTemplate));
    for (const p of PERSONAS) expect(served, p.id).toContain(p.id);
  });
});
