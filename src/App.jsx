// App.jsx — root: providers, top bar, routes, and the loading overlay.
import { useState, useEffect } from "react";
import { configurePqlClient } from "./lib/pql/pqlClient.js";
import { apiClient as _api } from "./lib/apiClient.js";

// Wire the activation-event transport once, at module scope rather than in
// an effect: an event emitted during the very first render would otherwise
// be buffered with nowhere to go and dropped on the first flush.
configurePqlClient((payload) => _api.pqlEvents(payload));
import { Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ErrorModalProvider } from "./components/ErrorModal.jsx";
import { AuthProvider, useAuth } from "./components/AuthProvider.jsx";
import AuthModal from "./components/AuthModal.jsx";
import { ExtractionProvider, useExtraction } from "./components/ExtractionProvider.jsx";
import { PersonaProvider } from "./components/PersonaProvider.jsx";
import { BillingProvider } from "./components/BillingProvider.jsx";
import TopBar from "./components/TopBar.jsx";
import Footer from "./components/Footer.jsx";
import ExtractionProgressDock from "./components/ExtractionProgressDock.jsx";
import Icon from "./components/Icon.jsx";
import Button from "./components/Button.jsx";
import WorkspaceRedirect from "./components/WorkspaceRedirect.jsx";
import { useHotkeys } from "./hooks/useHotkeys.js";
import HotkeyHelp from "./components/HotkeyHelp.jsx";
import OnboardingTour from "./components/OnboardingTour.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import Home from "./pages/Home.jsx";
import Preview from "./pages/Preview.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import Pricing from "./pages/Pricing.jsx";
import Account from "./pages/Account.jsx";
import PaymentSuccess from "./pages/PaymentSuccess.jsx";
import PaymentCancel from "./pages/PaymentCancel.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminRevenue from "./pages/admin/AdminRevenue.jsx";
import AdminPricing from "./pages/admin/AdminPricing.jsx";
import AdminCoupons from "./pages/admin/AdminCoupons.jsx";
import AdminUsers from "./pages/admin/AdminUsers.jsx";
import AdminAI from "./pages/admin/AdminAI.jsx";
import AdminGallery from "./pages/admin/AdminGallery.jsx";
import AdminGeneral from "./pages/admin/AdminGeneral.jsx";
import AdminAutomation from "./pages/admin/AdminAutomation.jsx";
import AdminMonitoring from "./pages/admin/AdminMonitoring.jsx";
import AdminHealth from "./pages/admin/AdminHealth.jsx";
import About from "./pages/About.jsx";
import Blog from "./pages/Blog.jsx";
import Contact from "./pages/Contact.jsx";
import UseCases from "./pages/UseCases.jsx";
import UseCaseLead from "./pages/UseCaseLead.jsx";
import UseCaseCompetitor from "./pages/UseCaseCompetitor.jsx";
import UseCaseSEO from "./pages/UseCaseSEO.jsx";
import UseCaseResearch from "./pages/UseCaseResearch.jsx";
import UseCaseAccountIntelligence from "./pages/UseCaseAccountIntelligence.jsx";
import UseCaseCompetitiveMonitoring from "./pages/UseCaseCompetitiveMonitoring.jsx";
import UseCaseAiVisibility from "./pages/UseCaseAiVisibility.jsx";
import UseCaseRecruiting from "./pages/UseCaseRecruiting.jsx";
import UseCaseDiligence from "./pages/UseCaseDiligence.jsx";
// The five per-tool /vs/* comparisons are static-owned (hand-written HTML in
// public/vs/<slug>/index.html) and have no React route — see
// scripts/site-routes.mjs. Only the hub is React.
import VsCompare from "./pages/VsCompare.jsx";
import Changelog from "./pages/Changelog.jsx";
import ProgrammaticRoute from "./pages/ProgrammaticRoute.jsx";
import BattleCard from "./pages/BattleCard.jsx";
import Integrations from "./pages/Integrations.jsx";
import Batch from "./pages/Batch.jsx";
import Templates from "./pages/Templates.jsx";
import Lists from "./pages/Lists.jsx";
import Watchlists from "./pages/Watchlists.jsx";
import SignalRules from "./pages/SignalRules.jsx";
import Workflows from "./pages/Workflows.jsx";
import Engagement from "./pages/Engagement.jsx";
import WorkflowRunPreview from "./pages/WorkflowRunPreview.jsx";
import Report from "./pages/Report.jsx";
import Schedules from "./pages/Schedules.jsx";
import Discoverability from "./pages/Discoverability.jsx";
import DiscoverabilityWorkspace from "./pages/DiscoverabilityWorkspace.jsx";
import NotFound from "./pages/NotFound.jsx";
import Workspace from "./pages/Workspace.jsx";
import PublicReport from "./pages/PublicReport.jsx";
import Gallery from "./pages/Gallery.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import UsageUpsellBanner from "./components/UsageUpsellBanner.jsx";
import SuspendedBanner from "./components/SuspendedBanner.jsx";
import { GuestTrialProvider } from "./components/GuestTrialProvider.jsx";
import GuestTrialBanner from "./components/GuestTrialBanner.jsx";
import { WorkspaceProvider } from "./components/WorkspaceContext.jsx";
import ReferralBanner from "./components/ReferralBanner.jsx";
import ConsentBanner from "./components/ConsentBanner.jsx";
import { usePageView } from "./hooks/usePageView.js";
import GuestTrialModal from "./components/GuestTrialModal.jsx";
import PendingScheduleFlush from "./components/PendingScheduleFlush.jsx";
import PendingReferralFlush from "./components/PendingReferralFlush.jsx";
import PendingWorkspaceInviteFlush from "./components/PendingWorkspaceInviteFlush.jsx";
import PendingAuditFlush from "./components/PendingAuditFlush.jsx";
import { BatchRunProvider } from "./components/BatchRunProvider.jsx";
import { TemplateRunProvider } from "./components/TemplateRunProvider.jsx";


// Redirect /docs to the static help site
function DocsRedirect() {
  window.location.href = "/help/index.html";
  return null;
}

// DmcaRedirect — F04 (DMCA takedown process page). The actual content
// lives in /public/dmca.html (a static page that doesn't go through the SPA
// shell), because it's a legal/process page that doesn't need the TopBar / Footer.
function DmcaRedirect() {
  if (typeof window !== "undefined") {
    window.location.href = "/dmca.html";
  }
  return null;
}

function Shell() {
  const { showAuthModal } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // GA4 + in-house page views on every route change. Called here, above the
  // /admin early return below, because hooks must run unconditionally — the
  // hook itself skips /admin paths rather than relying on not being called.
  usePageView();

  // Referral ?ref=CODE handler. The code is STASHED here, never redeemed here:
  // redemption grants real quota and is signed-in only, so a guest arriving on
  // an invite link keeps the code until they have an account — which is what
  // the copy has always described ("when they sign up with your link").
  // PendingReferralFlush below does the redeeming once a session exists.
  //
  // The param is stripped either way, so the URL a user copies out of their
  // address bar is never someone else's invite link.
  useEffect(() => {
    const ref = searchParams.get("ref");
    if (!ref) return;
    import("./lib/referralService.js").then(({ setPendingReferral }) => {
      setPendingReferral(ref);
      const next = new URLSearchParams(searchParams);
      next.delete("ref");
      setSearchParams(next, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Workspace invite ?invite=TOKEN handler — same STASH-here /
  // REDEEM-in-a-flush-component split as ?ref= above, and for the same
  // reason: accepting a seat is signed-in only, so a guest arriving on an
  // invite link keeps the token until they have an account.
  useEffect(() => {
    const invite = searchParams.get("invite");
    if (!invite) return;
    import("./lib/pendingWorkspaceInvite.js").then(({ setPendingWorkspaceInvite }) => {
      setPendingWorkspaceInvite(invite);
      const next = new URLSearchParams(searchParams);
      next.delete("invite");
      setSearchParams(next, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Q11 — keyboard shortcuts (power-user mode)
  const [hotkeyHelpOpen, setHotkeyHelpOpen] = useState(false);
  const [tourForceOpen, setTourForceOpen] = useState(0);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  useHotkeys({
    "?": () => setHotkeyHelpOpen(true),
    esc: () => { setHotkeyHelpOpen(false); setCmdPaletteOpen(false); },
    "mod+k": () => setCmdPaletteOpen(true),
    "g d": () => navigate("/dashboard"),
    "g b": () => navigate("/batch"),
    "g s": () => navigate("/schedules"),
    "g p": () => navigate("/pricing"),
    "g w": () => navigate("/workspace"),
    "g t": () => setTourForceOpen((n) => n + 1),
  });

  // F10 — listen for the synthetic event CommandPalette fires for "replay tour"
  useEffect(() => {
    const handler = () => setTourForceOpen((n) => n + 1);
    window.addEventListener("datiq:replay-tour", handler);
    return () => window.removeEventListener("datiq:replay-tour", handler);
  }, []);

  // Q11 — "/" focuses the URL composer if one is on the current page
  useHotkeys({
    "/": () => {
      // Only fire on the pages that have a composer
      const candidates = [
        ".hero-composer-input",
        ".hero-composer textarea",
        "textarea[aria-label*='URL']",
        "textarea[aria-label*='batch']",
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) { el.focus(); return; }
      }
    },
  });

  const isAdmin = pathname.startsWith("/admin");

  // Admin module — standalone shell (no TopBar/Footer)
  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/revenue" replace />} />
          <Route path="revenue" element={<AdminRevenue />} />
          <Route path="pricing" element={<AdminPricing />} />
          <Route path="coupons" element={<AdminCoupons />} />
          <Route path="users"   element={<AdminUsers />} />
          <Route path="ai"        element={<AdminAI />} />
          <Route path="gallery"   element={<AdminGallery />} />
          <Route path="general"   element={<AdminGeneral />} />
          <Route path="automation" element={<AdminAutomation />} />
          <Route path="monitoring" element={<AdminMonitoring />} />
          <Route path="health"     element={<AdminHealth />} />
        </Route>
      </Routes>
    );
  }

  return (
    <>
      {/* Skip-to-content link for keyboard/screen reader users */}
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <TopBar />
      <GuestTrialBanner />
      <ReferralBanner />
      <SuspendedBanner />
      <UsageUpsellBanner />
      <main id="main-content">
        <Routes>
          <Route path="/"                              element={<Home />} />
          <Route path="/workspace"                     element={<WorkspaceRedirect><Workspace /></WorkspaceRedirect>} />
          <Route path="/onboarding"                    element={<Onboarding />} />
          <Route path="/preview"                       element={<Preview />} />
          <Route path="/dashboard"                     element={<Dashboard />} />
          {/* Collections moved inside /workspace as a tab (2026-08-11).
              /collections is kept as a backward-compat redirect so old
              links (bookmarks, Slack shares, etc.) still land on the new
              Collections tab. */}
          <Route path="/collections"                   element={<Navigate to="/workspace?tab=collections" replace />} />
          <Route path="/batch"                         element={<Batch />} />
          <Route path="/schedules"                     element={<Schedules />} />
          <Route path="/discoverability"               element={<Discoverability />} />
          <Route path="/discoverability/truth"         element={<DiscoverabilityWorkspace />} />
          <Route path="/discoverability/entities"      element={<DiscoverabilityWorkspace />} />
          <Route path="/discoverability/local"         element={<DiscoverabilityWorkspace />} />
          <Route path="/discoverability/trust"         element={<DiscoverabilityWorkspace />} />
          <Route path="/discoverability/scores"        element={<DiscoverabilityWorkspace />} />
          <Route path="/discoverability/sxo"           element={<DiscoverabilityWorkspace />} />
          {/* PRD 1 — the workflow template gallery + runner. Public: the
              catalogue is an acquisition surface, and a guest can run a
              template (template.run is deliberately ungated) — they just
              cannot save the result. */}
          <Route path="/templates"                     element={<Templates />} />
          <Route path="/lists"                         element={<Lists />} />
          <Route path="/watchlists"                    element={<Watchlists />} />
          <Route path="/rules"                         element={<SignalRules />} />
          <Route path="/workflows"                     element={<Workflows />} />
          <Route path="/engagement"                    element={<Engagement />} />
          <Route path="/workflows/runs/:runId"         element={<WorkflowRunPreview />} />
          {/* PRD 2 — a shared report. NOT under a private prefix: this page
              exists to be opened by someone without a DatIQ account, which is
              the whole acquisition loop. Indexability is decided per report
              by the server; only `public` reports are indexable. */}
          <Route path="/r/:slug"                       element={<Report />} />
          <Route path="/pricing"                       element={<Pricing />} />
          <Route path="/account"                       element={<Account />} />
          <Route path="/payment/success"               element={<PaymentSuccess />} />
          <Route path="/payment/cancel"                element={<PaymentCancel />} />
          <Route path="/privacy"                       element={<Privacy />} />
          <Route path="/terms"                         element={<Terms />} />
          <Route path="/about"                         element={<About />} />
          <Route path="/blog"                          element={<Blog />} />
          <Route path="/contact"                       element={<Contact />} />
          <Route path="/integrations"                  element={<Integrations />} />
          <Route path="/use-cases"                     element={<UseCases />} />
          <Route path="/use-cases/lead-generation"     element={<UseCaseLead />} />
          <Route path="/use-cases/competitor-research" element={<UseCaseCompetitor />} />
          <Route path="/use-cases/seo-audit"           element={<UseCaseSEO />} />
          <Route path="/use-cases/market-research"     element={<UseCaseResearch />} />
          <Route path="/use-cases/account-intelligence"   element={<UseCaseAccountIntelligence />} />
          <Route path="/use-cases/competitive-monitoring" element={<UseCaseCompetitiveMonitoring />} />
          <Route path="/use-cases/ai-visibility"          element={<UseCaseAiVisibility />} />
          <Route path="/use-cases/recruiting"             element={<UseCaseRecruiting />} />
          <Route path="/use-cases/investor-diligence"     element={<UseCaseDiligence />} />
          <Route path="/vs/compare"                    element={<VsCompare />} />
          <Route path="/changelog"                     element={<Changelog />} />
          <Route path="/for-sales"                     element={<ProgrammaticRoute />} />
          <Route path="/for-seo"                       element={<ProgrammaticRoute />} />
          <Route path="/for-ci"                        element={<ProgrammaticRoute />} />
          <Route path="/extract-pricing"               element={<ProgrammaticRoute />} />
          <Route path="/extract-contacts"              element={<ProgrammaticRoute />} />
          <Route path="/extract-headings"              element={<ProgrammaticRoute />} />
          <Route path="/vs/battlecard"                 element={<BattleCard />} />
          <Route path="/dmca"                          element={<DmcaRedirect />} />
          <Route path="/docs"                          element={<DocsRedirect />} />
          {/* /compare and /compare/* used to <Navigate> to /vs/browse-ai. That
              route no longer exists in React (the page is static-owned), so the
              redirects moved to netlify.toml as 301s — a client-side Navigate
              to a non-route would land on NotFound. */}
          {/* Q6 — shareable report links + public gallery */}
          <Route path="/p/:slug"                       element={<PublicReport />} />
          <Route path="/gallery"                       element={<Gallery />} />
          {/* Password recovery landing — Supabase redirects here with #type=recovery */}
          <Route path="/reset-password"                element={<ResetPassword />} />
          <Route path="*"                              element={<NotFound />} />
        </Routes>
      </main>
      {showAuthModal && <AuthModal />}
      <GuestTrialModal />
      {/* Saves a schedule built while signed out, once the user signs in.
          Global because OAuth navigates the document away and back. */}
      <PendingScheduleFlush />
      <PendingReferralFlush />
      <PendingWorkspaceInviteFlush />
      <PendingAuditFlush />
      <HotkeyHelp open={hotkeyHelpOpen} onClose={() => setHotkeyHelpOpen(false)} />
      <OnboardingTour
        key={tourForceOpen}
        tourId="home"
        forceOpen={tourForceOpen > 0}
        enabled={pathname === "/"}
        onClose={() => setTourForceOpen(0)}
      />
      {/* Separate tour, separate localStorage flag — a first-time visitor to
          Discoverability gets walked through it independently of whether
          they've seen (or skipped) the Home tour. No replay hotkey wired to
          this one yet; forceOpen stays false so it only auto-starts once. */}
      <OnboardingTour
        tourId="discoverability"
        enabled={pathname === "/discoverability"}
      />
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />
      {/* Non-blocking background-extraction progress dock (replaces the old
          full-screen LoadingScreen). Global so it persists across route changes. */}
      <ExtractionProgressDock />
      <Footer />
      {/* Floating, not part of the in-flow banner stack above: it is a
          bottom-anchored overlay that auto-hides on its own timer rather
          than pushing page content down. Not rendered on /admin — Shell
          returns a separate admin <Routes> above this point. */}
      <ConsentBanner />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ErrorModalProvider>
          <AuthProvider>
            <GuestTrialProvider>
              <WorkspaceProvider>
                <PersonaProvider>
                  <BillingProvider>
                    <ExtractionProvider>
                      {/* Owns an in-flight batch above the router, so a run
                          survives navigation and reports through the same
                          global dock as a single extraction. */}
                      <BatchRunProvider>
                        {/* Same reasoning one level down: a template run is
                            tens of seconds of scrapes and AI calls, and used to
                            live in the page body with its own progress bar — so
                            navigating away hid it and abandoned it. */}
                        <TemplateRunProvider>
                          <div className="app-root">
                            <Shell />
                          </div>
                        </TemplateRunProvider>
                      </BatchRunProvider>
                    </ExtractionProvider>
                  </BillingProvider>
                </PersonaProvider>
              </WorkspaceProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
