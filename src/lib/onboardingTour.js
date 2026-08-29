// src/lib/onboardingTour.js — onboarding tour pure logic.
//
// Supports more than one tour (currently "home" and "discoverability"),
// each with its own step list and its own localStorage completed/skipped
// flag, so finishing or skipping one tour never affects the other. Every
// exported function takes an optional `tourId` (defaulting to "home" for
// backward compatibility with existing callers) and looks up the matching
// entry in TOURS.
//
// Each step has a `target` (CSS selector, or null for a centered overlay)
// and a `placement` for the popover ("top" | "bottom" | "left" | "right" |
// "center"). The TourOverlay component reads this and positions itself
// accordingly.

const HOME_STEPS = [
  {
    key: "intro",
    title: "Welcome to DatIQ",
    body: "DatIQ turns any web page into structured data — headings, links, AI summaries, custom fields, and now a full SEO/AEO/GEO discoverability score — in seconds. This quick tour shows you the key parts of the product.",
    target: null,
    placement: "center",
  },
  {
    key: "composer",
    title: "1. Paste anything",
    body: "Type or paste a URL here — or a list of URLs, a CSV, or even a block of text with links buried in it. The composer detects what you gave it and routes each case to the right workflow automatically.",
    target: ".hero-composer",
    placement: "bottom",
  },
  {
    key: "modes",
    title: "2. 12 extraction modes",
    body:
      "DatIQ has 12 preset extraction modes — pick one and we'll wire the prompt for you.\n\n" +
      "Outcome tiles (6): Lead list · Pricing · Competitor research · AI summary · Job board · Custom.\n" +
      "Quick actions (5): Find contact info · Leadership & board · Social links · Company mission · Pricing & plans.\n" +
      "Plus: free-text custom prompts. You can also stack modes (e.g. lead list + pricing) into one combined extraction.",
    target: ".outcome-tiles",
    placement: "bottom",
  },
  {
    key: "templates",
    title: "3. Use a template",
    body: "Need a starting point? The template library has 12 pre-built extraction recipes for YC companies, SaaS pricing, job boards, GitHub repos, and more.",
    target: ".template-gallery",
    placement: "top",
  },
  {
    key: "batch",
    title: "4. Batch mode, in the background",
    body: "Paste multiple URLs (or import a CSV) and DatIQ auto-routes to Batch mode — up to 500 pages in one run. Turn on \"Run in background\" from the + menu and keep working while it finishes; you'll find it in the progress dock and in Dashboard's run history either way.",
    target: ".topbar",
    placement: "bottom",
  },
  {
    key: "discoverability",
    title: "5. Score a page for AI answer engines",
    body: "Discoverability (the \"Discover\" link in the top nav) audits a page for classic SEO, answer engines like ChatGPT and Perplexity, and generative engines — then hands you the fixes, already written and ready to paste in.",
    target: null,
    placement: "center",
  },
  {
    key: "automate",
    title: "6. Schedules, Workspace & Push",
    body: "Turn any extraction into a recurring Schedule that emails you when a page changes. Invite teammates into a Workspace to share the work. And push results straight to HubSpot, Notion, Airtable, Slack or Google Sheets from the Push menu — no CSV round-trip required.",
    target: null,
    placement: "center",
  },
  {
    key: "done",
    title: "That's the tour",
    body: "You're all set. Press ? any time to see keyboard shortcuts, or mod+K to jump anywhere. Your work saves to the Dashboard automatically — visit it from the top nav.",
    target: null,
    placement: "center",
  },
];

const DISCOVERABILITY_STEPS = [
  {
    key: "intro",
    title: "Score how discoverable a page really is",
    body: "Discoverability scores a page across four pillars — for classic search, AI answer engines, and generative engines — then hands you the fixes, already written. This is a signed-in feature with its own monthly audit quota.",
    target: null,
    placement: "center",
  },
  {
    key: "composer",
    title: "1. Run an audit",
    body: "Paste a URL, pick a profile (SEO / AEO / GEO / balanced) and a device, then run. A full audit fetches the page twice — once raw, once rendered — and reads its structure, schema, entity signals, and crawler policy.",
    target: ".dsc-composer",
    placement: "bottom",
  },
  {
    key: "pillars",
    title: "2. Four pillars, one score each",
    body:
      "Answer Clarity — could an assistant quote a passage and have it still make sense?\n" +
      "Entity Authority — can a machine tell who published this?\n" +
      "Structural Hierarchy — is the page segmented cleanly enough to retrieve the right section?\n" +
      "Technical Accessibility — can bots and AI crawlers reach, render, and trust the page at all?",
    target: ".dsc-intro-grid",
    placement: "top",
  },
  {
    key: "history",
    title: "3. History, exports & monitoring",
    body: "Every audit is saved — re-audit any URL to see what changed, export a report as Markdown, PDF, CSV or JSON, and set up scheduled monitoring so a regression alerts you instead of going unnoticed.",
    target: ".dsc-header-actions",
    placement: "bottom",
  },
  {
    key: "done",
    title: "That's the tour",
    body: "Run your first audit above whenever you're ready. Fixes are written to be pasted straight into your site — anything we couldn't verify is marked TODO rather than guessed.",
    target: null,
    placement: "center",
  },
];

const TOURS = {
  home: { storageKey: "datiq.onboardingTour.v1", steps: HOME_STEPS },
  discoverability: { storageKey: "datiq.discoverabilityTour.v1", steps: DISCOVERABILITY_STEPS },
};

function tourEntry(tourId) {
  return TOURS[tourId] || TOURS.home;
}

function lsRead(tourId) {
  try { return JSON.parse(localStorage.getItem(tourEntry(tourId).storageKey)) || {}; } catch { return {}; }
}
function lsWrite(tourId, obj) {
  try { localStorage.setItem(tourEntry(tourId).storageKey, JSON.stringify(obj)); } catch { /* skip */ }
}

export function getTourSteps(tourId = "home") {
  return tourEntry(tourId).steps;
}

export function isTourCompleted(tourId = "home") {
  return Boolean(lsRead(tourId).completedAt);
}

export function isTourSkipped(tourId = "home") {
  return Boolean(lsRead(tourId).skippedAt);
}

export function shouldAutoStart(tourId = "home") {
  const s = lsRead(tourId);
  return !s.completedAt && !s.skippedAt;
}

export function markCompleted(tourId = "home") {
  lsWrite(tourId, { ...lsRead(tourId), completedAt: new Date().toISOString() });
}

export function markSkipped(tourId = "home") {
  lsWrite(tourId, { ...lsRead(tourId), skippedAt: new Date().toISOString() });
}

export function resetTour(tourId = "home") {
  lsWrite(tourId, {});
}

export function nextStep(currentIdx, total) {
  return Math.min(currentIdx + 1, total - 1);
}

export function prevStep(currentIdx) {
  return Math.max(currentIdx - 1, 0);
}

export function progressFraction(currentIdx, total) {
  if (total <= 1) return 1;
  return (currentIdx + 1) / total;
}
