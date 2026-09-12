// platformModules.js — one truthful public catalog for DatIQ's product pillars.
//
// Marketing surfaces must not invent destinations or claim unfinished work is
// ready. Keep the status and CTA policy together so Home, future Help/About
// pages, and their tests all make the same promise.

export const MODULE_STATUS = Object.freeze({
  AVAILABLE: "available",
  BETA: "beta",
  UPCOMING: "upcoming",
});

export const PLATFORM_MODULES = Object.freeze([
  {
    key: "extract",
    name: "DatIQ Extract",
    icon: "globe",
    headline: "Every page, structured.",
    description: "Turn one URL, a batch, or a schedule into clean data, summaries and exports.",
    status: MODULE_STATUS.AVAILABLE,
    cta: "Start extracting",
    action: "composer",
  },
  {
    key: "enrich",
    name: "DatIQ Enrich",
    icon: "sparkles",
    headline: "Answers behind the page.",
    description: "Pull contacts, pricing, company context and custom fields from what a page actually says.",
    status: MODULE_STATUS.AVAILABLE,
    cta: "Enrich a page",
    action: "enrich-composer",
  },
  {
    key: "discover",
    name: "DatIQ Discover",
    icon: "scan-search",
    headline: "Be found where decisions start.",
    description: "Measure visibility across search, answer engines and AI. Act on evidence-backed priorities and track progress.",
    status: MODULE_STATUS.BETA,
    cta: "Run a visibility audit",
    to: "/discoverability",
  },
  {
    key: "compete",
    name: "DatIQ Compete",
    icon: "eye",
    headline: "Never miss a competitor move.",
    description: "Monitor pricing, positioning and page changes with evidence and an alert trail.",
    status: MODULE_STATUS.BETA,
    cta: "Explore watchlists",
    to: "/watchlists",
  },
  {
    key: "connect",
    name: "DatIQ Connect",
    icon: "share",
    headline: "Put intelligence to work.",
    description: "Export or route verified outputs to your operating tools and workflows.",
    status: MODULE_STATUS.BETA,
    cta: "Explore integrations",
    to: "/integrations",
  },
  {
    key: "engage",
    name: "DatIQ Engage",
    icon: "users",
    headline: "Turn research into next steps.",
    description: "Organise prospect intelligence and outreach workflows.",
    status: MODULE_STATUS.UPCOMING,
  },
]);

/** Upcoming work must remain a non-interactive roadmap card. */
export function hasModuleCta(module) {
  return Boolean(module?.cta && module.status !== MODULE_STATUS.UPCOMING && (module.to || module.action));
}

/** A display label kept separate from public copy to avoid status drift. */
export function moduleStatusLabel(status) {
  return status === MODULE_STATUS.AVAILABLE ? "Available"
    : status === MODULE_STATUS.BETA ? "Beta"
    : "Upcoming";
}
