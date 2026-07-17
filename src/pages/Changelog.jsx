// src/pages/Changelog.jsx — F12 (public changelog + Product Hunt social launch).
//
// Reverse-chronological release log. Manually curated from the actual shipped
// commits. Future: when the team switches to a CMS, swap the static RELEASES
// for a fetch — the rendering and SEO are designed to be agnostic.
//
// URL: /changelog. Linked from TopBar Explore + Footer + llms.txt + sitemap.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { setMeta } from "../lib/seoMeta.js";

// Curated release entries. Add a new entry at the top when shipping a release.
// "scope" is a short human label, "highlights" is the bullet list, "shipped" is
// the human date the code went to main.
const RELEASES = [
  {
    version: "R19",
    name: "Scheduler & unified Home composer",
    shipped: "2026-06-20",
    scope: "Recurring monitoring + URL-or-batch-or-schedule home",
    highlights: [
      "Unified Home composer (single URL / multi-URL / schedule in one textarea)",
      "/schedules route with custom cadence builder, end dates, alert email",
      "Hourly Netlify scheduled-runner (Firecrawl → fingerprint → change diff)",
      "Dashboard gets Type column (Single / Batch / Scheduled) + collapsible groupings",
      "Server execution: netlify/functions/scheduled-runner.js + schedules.js",
    ],
  },
  {
    version: "R18",
    name: "Admin dashboard upgrades",
    shipped: "2026-06-17",
    scope: "Real revenue + user management + INR pricing in admin",
    highlights: [
      "/admin/revenue — live KPIs from Supabase (MRR, ARR, trend, user counts)",
      "/admin/users — real Supabase data; plan period + coupon + extractions columns",
      "AdminPricing INR inputs with live GST preview (18% breakdown)",
      "AdminCoupons — planId='manual' coupons (admin-assign only)",
      "Coupon assign modal — manual-only picker, discount % override, persistence",
    ],
  },
  {
    version: "R17",
    name: "Guest-trial hard limits + admin general config",
    shipped: "2026-06-16",
    scope: "Bypass prevention + operator-tunable guest limits",
    highlights: [
      "Non-dismissible hard block at 10 single-URL extractions or 5 batch runs",
      "datiq.guestTrial never cleared on login/logout (anti-bypass)",
      "Logout cleanup: 7 sensitive localStorage keys + navigate to /",
      "/admin/general — soft limit, reprompt interval, hard limits (4 fields)",
      "General settings cached 5 min via globalSettingsService",
    ],
  },
  {
    version: "R16",
    name: "Batch mode parity + guest trial gate",
    shipped: "2026-06-15",
    scope: "Map site + guest trial + enrichment persistence",
    highlights: [
      "Map site intent chip (5th outcome tile) on Home + Batch",
      "Per-URL content generation toggle (SEO/competitor/social) in Batch",
      "enrichMeta tab persistence for contacts/pricing/custom",
      "GuestTrialProvider + GuestTrialBanner + GuestTrialModal",
      "Soft trial gate (3 extractions, re-prompts every 2)",
    ],
  },
  {
    version: "R15",
    name: "Home polish + Batch draft persistence",
    shipped: "2026-06-14",
    scope: "FAB → /batch + textarea localStorage draft",
    highlights: [
      "Home FAB (layers-2) navigates to /batch (no inline textarea)",
      "Batch textarea draft persisted to datiq.batchDraft",
      "Unified Export ▾ dropdown in /batch (CSV / PDF / MD / JSON)",
      "BatchRunsDropdown left-aligned in Dashboard (z-index + overflow fix)",
    ],
  },
  {
    version: "R14",
    name: "Firecrawl fallback chain + Home intent chips + OG preview",
    shipped: "2026-06-13",
    scope: "Multi-provider scraping + home UX overhaul",
    highlights: [
      "Firecrawl → Spider.cloud → Jina AI → Direct fetch fallback chain",
      "5 intent chips (summary / contacts / pricing / map / custom) on Home",
      "OG preview card (800ms debounce, server-side fetcher)",
      "Clickable feature cards map to intent chips",
      "/api/og-preview Netlify function (no env needed)",
    ],
  },
  {
    version: "R13",
    name: "GST breakdown + top-up INR + comparison pages",
    shipped: "2026-06-11",
    scope: "Indian tax compliance + competitive SEO surface",
    highlights: [
      "PaymentConfirmModal — pre-GST base + 18% GST + total",
      "TopupBundleModal INR upsell prices (₹999 / ₹1,499 / mo)",
      "/vs/apify.html + /vs/phantombuster.html static comparison pages",
      "/vs/compare.html hero quick-links for all 4 pages",
      "Batch results table full-width (was capped at 860px)",
      "Account quick stats: batch executions + content generations",
    ],
  },
  {
    version: "R12",
    name: "Plan card hover + TopupBundleModal + payment-gated activation",
    shipped: "2026-06-10",
    scope: "Premium pricing UX + real payment gating",
    highlights: [
      "Plan card hover/selecting/current states (green ring, lift, pulse)",
      "TopupBundleModal — qty selector, cumulative pricing, upsell section",
      "upgradePlan() only fires on demo_mode / success (not on cancel)",
      "DemoPaymentModal — explicit confirm step when no payment keys",
      "Razorpay env-var diagnostic notices (exact variable names)",
    ],
  },
  {
    version: "R11",
    name: "Razorpay PAYMENT_STAGE state machine + retry callback",
    shipped: "2026-06-09",
    scope: "Robust INR payment flow with retry",
    highlights: [
      "PAYMENT_STAGE / PAYMENT_STAGE_LABELS state machine in paymentService",
      "PaymentProcessingModal — 3-step progress + retry/cancel",
      "retryPayment callback re-uses last payment args",
      "INR annual amount fix (price_inr_annual × 12 × 100 paise)",
      "create-checkout.js rewrite (agency $299, bundles, server-authoritative amounts)",
      "verify-payment.js timing-safe HMAC (timingSafeEqual)",
    ],
  },
  {
    version: "R10",
    name: "Explore restructure + bug-report flow + AdminUsers fix",
    shipped: "2026-06-08",
    scope: "Top-down navigation + bug-report intake",
    highlights: [
      "TopBar Explore restructured into 6 sections (Company → Contact)",
      "Contact page 'Bug report' enquiry type + ?type=bug pre-fill",
      "AdminUsers PLAN_BY_ID fix (now uses getEffectivePlanById)",
    ],
  },
  {
    version: "R9",
    name: "Topbar reorder + Dashboard z-index + auto-save hardening",
    shipped: "2026-06-07",
    scope: "Critical UX fixes from R8 audit",
    highlights: [
      "Topbar nav reordered: Extract → Batch → Dashboard",
      "Dashboard export dropdowns z-index fix (position: relative; z-index: 10)",
      "Dashboard localStorage-first loading (instant render, background sync)",
      "Dashboard Refresh button + inline selection Generate/Email/Clear",
      "Preview Download ▾ dropdown + Extract → View Dashboard + Delete",
      "Batch auto-save strips _status/_error before saveExtraction",
    ],
  },
  {
    version: "R8",
    name: "Grouped Export + Selection bar + Preview action bar redesign",
    shipped: "2026-06-06",
    scope: "Export everywhere + selection actions + auto-save on extract",
    highlights: [
      "Grouped Export ▾ dropdown (CSV / PDF / MD / JSON) in Dashboard + Batch + Preview",
      "Floating SelectionBar (Generate / Email / Export) when ≥1 row selected",
      "Auto-save on extraction (result._saved = true)",
      "Preview action bar: View Dashboard + Download ▾ + Delete",
      "Generate content on Preview (in Quick Enrichment card header)",
      "Home cleanup: removed inline batch toggle + Try example chips",
    ],
  },
  {
    version: "R7",
    name: "Batch Pack + admin price limits + stable AI model",
    shipped: "2026-06-05",
    scope: "Bundle top-ups + per-plan batch limits",
    highlights: [
      "Top-up bundles: Batch Pack (50 URLs), Power Pack (100 extractions)",
      "AdminPricing: batch_max_urls field per plan",
      "purchaseBatchPack wired through real payment (Razorpay) + demo mode",
      "AI_MODEL=claude-3-5-haiku-20241022 default (stable)",
      "Removed dead submitBatch / MultiUrlReveal code",
    ],
  },
  {
    version: "R6",
    name: "Inline batch + feature card tags + no demo data",
    shipped: "2026-06-04",
    scope: "Multi-URL on Home + Dashboard cleanup",
    highlights: [
      "Inline batch mode on Home (multi-URL textarea, progress, inline results)",
      "Feature card Popular/Recommended tags inline (.feature-title-row)",
      "Dashboard no-demo: empty state with 'Extract a page' CTA",
      "Auto-save batch results to Dashboard (Promise.allSettled)",
    ],
  },
  {
    version: "R5",
    name: "Batch mode + CSV import + Markdown/JSON export",
    shipped: "2026-06-03",
    scope: "Multi-URL workflow as a first-class feature",
    highlights: [
      "/batch page — paste URLs / import CSV → progress → results → export",
      "CONCURRENCY=3 parallel multi-URL extraction",
      "Markdown + JSON export formats (utils.js)",
      "parseUrlsFromCsv in batchService",
      "Plan-gated batch (Business ≤200, Agency ≤500 URLs)",
    ],
  },
  {
    version: "R4",
    name: "Pricing & billing + marketing pages + trust messaging",
    shipped: "2026-05-30",
    scope: "Monetization surface + landing pages",
    highlights: [
      "Annual/monthly toggle, USD+INR only, 20% annual discount",
      "7 plan tiers (Free / Select / Pro / Business / Agency / Developer / Enterprise)",
      "PaymentConfirmModal with GST breakdown",
      "/use-cases hub + 4 detail pages",
      "/contact, /about, /blog, /integrations marketing pages",
      "DPDP Act 2023 section in Privacy + Indian arbitration in Terms",
      "AI key moved server-side (no VITE_AI_API_KEY)",
    ],
  },
  {
    version: "R3",
    name: "Admin sidebar + auth-gated nav + page padding",
    shipped: "2026-05-26",
    scope: "Internal polish + nav hardening",
    highlights: [
      "Admin sidebar collapsible (chevron toggle + pin)",
      "Auth-gated UserDropdown (Sign in / Sign up when logged out)",
      "Page padding override fix (padding-top/bottom only, no shorthand)",
      "TopBar content aligned to .container (max-width 1080px)",
    ],
  },
  {
    version: "R2",
    name: "Onboarding in Shell + responsive nav + persona chips",
    shipped: "2026-05-22",
    scope: "Persona-driven UX + responsive polish",
    highlights: [
      "Onboarding in Shell (TopBar + Footer; no forced redirect)",
      "Responsive nav: text+icons down to 600px, hamburger <600px",
      "Geo-currency detection (INR for IST, USD default)",
      "Toggle tooltip prop (.opt-tooltip hover popover)",
      "Persona quick-chips above URL input on Home",
      "Scrape opts 2-col grid (collapses to 1 on mobile)",
      "favicon layered-diamond indigo SVG",
    ],
  },
  {
    version: "R1",
    name: "DatIQ rebrand + Razorpay integration + SEO surface",
    shipped: "2026-05-15",
    scope: "Full rebrand + first real payment integration",
    highlights: [
      "DatIQ rebrand: localStorage keys → datiq.*, console logs → [DatIQ]",
      "Razorpay INR payment (one-time Orders)",
      "PaymentService: initiateCheckout / verifyPayment / demo mode",
      "Migration service: scrapelite.* → datiq.* on first load",
      "Privacy + Terms rewritten for DatIQ + Indian governing law",
      "Topbar tagline 'Intelligence from every URL'",
    ],
  },
  {
    version: "v0",
    name: "ScrapeLite baseline (renamed to DatIQ)",
    shipped: "2026-05-01",
    scope: "First public release under the original name",
    highlights: [
      "Single-URL extraction (headings, links, summary, custom field, contacts)",
      "Domain mapping",
      "AI enrichment (summarize, contacts, leadership, social, pricing)",
      "CSV + PDF export",
      "Supabase auth (email + OAuth stub)",
      "7-persona system (Sales, CI, SEO, Research, Recruiter, Founder, VC)",
    ],
  },
];

const PRODUCT_HUNT = {
  status: "upcoming",
  badge: "Launching soon",
  tagline: "DatIQ is preparing for its Product Hunt launch. Subscribe to be notified on launch day.",
};

function ReleaseCard({ release }) {
  return (
    <article className="cl-entry" id={`release-${release.version.toLowerCase()}`}>
      <header className="cl-entry-head">
        <div className="cl-entry-version">
          <span className="cl-version-tag">{release.version}</span>
          <span className="cl-version-name">{release.name}</span>
        </div>
        <time className="cl-entry-date" dateTime={release.shipped}>
          {release.shipped}
        </time>
      </header>
      <p className="cl-entry-scope">{release.scope}</p>
      <ul className="cl-entry-list">
        {release.highlights.map((h, i) => (
          <li key={i}>{h}</li>
        ))}
      </ul>
    </article>
  );
}

export default function Changelog() {
  useEffect(() => {
    setMeta({
      title: "Changelog — DatIQ",
      description:
        "Every DatIQ release, reverse-chronological. R1 through R19, plus the upcoming Product Hunt launch.",
      url: typeof window !== "undefined" ? `${window.location.origin}/changelog` : "/changelog",
    });
  }, []);

  return (
    <div className="page cl-page">
      <div className="container cl-container">
        <header className="cl-head rise">
          <span className="ws-eyebrow">
            <Icon name="history" size={12} />
            Changelog
          </span>
          <h1 className="cl-title">What's new in DatIQ</h1>
          <p className="cl-sub">
            Every release we ship, with the highlights that matter. Reverse-chronological —
            newest at the top. {RELEASES.length} releases to date.
          </p>

          <div className="cl-ph-banner">
            <Icon name="rocket" size={16} />
            <div>
              <strong>{PRODUCT_HUNT.badge}</strong>
              <span>{PRODUCT_HUNT.tagline}</span>
            </div>
            <a
              className="cl-ph-link"
              href="mailto:support@datiq.app?subject=Notify%20me%20on%20Product%20Hunt%20launch"
            >
              Notify me →
            </a>
          </div>
        </header>

        <nav className="cl-toc" aria-label="Release index">
          <span className="cl-toc-label">Jump to:</span>
          {RELEASES.map((r) => (
            <a key={r.version} href={`#release-${r.version.toLowerCase()}`}>
              {r.version}
            </a>
          ))}
        </nav>

        <div className="cl-list">
          {RELEASES.map((r) => (
            <ReleaseCard key={r.version} release={r} />
          ))}
        </div>

        <footer className="cl-foot">
          <p>
            <Icon name="info" size={12} />
            Older history (v0 alpha) is summarised in the bottom entry. Each release is
            tied to a public merge commit on{" "}
            <a href="https://github.com/vikashkaruna/scrapelite" target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
            .
          </p>
          <p>
            <Link to="/">← Back to DatIQ</Link>
          </p>
        </footer>
      </div>
    </div>
  );
}
