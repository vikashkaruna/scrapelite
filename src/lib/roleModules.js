// roleModules.js — the modules a role's jobs point at (onboarding, use-cases).
//
// Six of these are the public product pillars and take their name, icon and
// STATUS from platformModules.js, so a module promoted from Beta to Available
// changes everywhere at once. Templates and Workflows are app surfaces, not
// pillars, and are listed here directly. Every entry names a real route; the
// role parity test fails the build if a role points at a key missing here.

import { PLATFORM_MODULES, MODULE_STATUS, moduleStatusLabel } from "./platformModules.js";

const PILLAR_ROUTES = {
  extract: "/",
  enrich: "/",
  discover: "/discoverability",
  compete: "/watchlists",
  connect: "/integrations",
  engage: "/engagement",
};

const pillars = Object.fromEntries(
  PLATFORM_MODULES.filter((m) => PILLAR_ROUTES[m.key]).map((m) => [
    m.key,
    { key: m.key, label: m.name.replace(/^DatIQ\s+/, ""), icon: m.icon, to: PILLAR_ROUTES[m.key], status: m.status },
  ]),
);

export const ROLE_MODULES = Object.freeze({
  ...pillars,
  templates: { key: "templates", label: "Templates", icon: "layout-list", to: "/templates", status: MODULE_STATUS.AVAILABLE },
  workflows: { key: "workflows", label: "Workflows", icon: "share-2", to: "/workflows", status: MODULE_STATUS.AVAILABLE },
});

export function roleModule(key) {
  return ROLE_MODULES[key] || null;
}

/** "Available" | "Beta" | "Upcoming" — the same wording as the Home cards. */
export function roleModuleStatus(key) {
  const m = ROLE_MODULES[key];
  return m ? moduleStatusLabel(m.status) : null;
}
