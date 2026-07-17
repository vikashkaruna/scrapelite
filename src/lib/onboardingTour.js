// src/lib/onboardingTour.js — Q4 (in-app onboarding tour) pure logic.
//
// Defines the tour steps and tracks which step the user is on. Persists
// "completed" / "skipped" to localStorage so the tour doesn't re-trigger.
//
// Each step has a `target` (CSS selector) and a `placement` for the
// popover ("top" | "bottom" | "left" | "right" | "center"). The TourOverlay
// component reads this and positions itself accordingly.

const LS_KEY = "datiq.onboardingTour.v1";

const DEFAULT_STEPS = [
  {
    key: "intro",
    title: "Welcome to DatIQ",
    body: "DatIQ turns any web page into structured data — headings, links, AI summaries, custom fields — in seconds. This quick tour shows you the key parts of the product.",
    target: null,                 // centred overlay
    placement: "center",
  },
  {
    key: "composer",
    title: "1. Paste a URL",
    body: "Type or paste any URL here. The composer auto-detects single URLs, lists of URLs, and even raw text — routing each to the right workflow.",
    target: ".hero-composer",
    placement: "bottom",
  },
  {
    key: "outcomes",
    title: "2. Pick what to extract",
    body: "These outcome tiles pre-wire the extraction for common jobs. Click one to pre-fill the URL, intent, and prompt. Click multiple to combine prompts.",
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
    title: "4. Batch mode",
    body: "When you paste multiple URLs (or import a CSV) DatIQ auto-routes to Batch mode. You can also open Batch directly from the top nav.",
    target: ".topbar",
    placement: "bottom",
  },
  {
    key: "done",
    title: "That's the tour",
    body: "You're all set. Press <kbd>?</kbd> any time to see keyboard shortcuts. Your work saves to the Dashboard automatically — visit it from the top nav.",
    target: null,
    placement: "center",
  },
];

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function lsWrite(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* skip */ }
}

export function getTourSteps() {
  return DEFAULT_STEPS;
}

export function isTourCompleted() {
  return Boolean(lsRead().completedAt);
}

export function isTourSkipped() {
  return Boolean(lsRead().skippedAt);
}

export function shouldAutoStart() {
  const s = lsRead();
  return !s.completedAt && !s.skippedAt;
}

export function markCompleted() {
  lsWrite({ ...lsRead(), completedAt: new Date().toISOString() });
}

export function markSkipped() {
  lsWrite({ ...lsRead(), skippedAt: new Date().toISOString() });
}

export function resetTour() {
  lsWrite({});
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
