// App.jsx — root: providers, top bar, routes, and the loading overlay.
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
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
import LoadingScreen from "./components/LoadingScreen.jsx";
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
import AdminGeneral from "./pages/admin/AdminGeneral.jsx";
import About from "./pages/About.jsx";
import Blog from "./pages/Blog.jsx";
import Contact from "./pages/Contact.jsx";
import UseCases from "./pages/UseCases.jsx";
import UseCaseLead from "./pages/UseCaseLead.jsx";
import UseCaseCompetitor from "./pages/UseCaseCompetitor.jsx";
import UseCaseSEO from "./pages/UseCaseSEO.jsx";
import UseCaseResearch from "./pages/UseCaseResearch.jsx";
import VsBrowseAI from "./pages/VsBrowseAI.jsx";
import VsClay from "./pages/VsClay.jsx";
import Integrations from "./pages/Integrations.jsx";
import Batch from "./pages/Batch.jsx";
import Schedules from "./pages/Schedules.jsx";
import UsageUpsellBanner from "./components/UsageUpsellBanner.jsx";
import { GuestTrialProvider } from "./components/GuestTrialProvider.jsx";
import GuestTrialBanner from "./components/GuestTrialBanner.jsx";
import GuestTrialModal from "./components/GuestTrialModal.jsx";


// Redirect /docs to the static help site
function DocsRedirect() {
  window.location.href = "/help/index.html";
  return null;
}

function Shell() {
  const { loading, loadingUrl } = useExtraction();
  const { showAuthModal } = useAuth();
  const { pathname } = useLocation();

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
          <Route path="ai"      element={<AdminAI />} />
          <Route path="general" element={<AdminGeneral />} />
        </Route>
      </Routes>
    );
  }

  const isAppPage = ["/", "/preview", "/dashboard", "/account", "/batch"].includes(pathname);
  if (loading && isAppPage) return <LoadingScreen url={loadingUrl} />;

  return (
    <>
      {/* Skip-to-content link for keyboard/screen reader users */}
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <TopBar />
      <GuestTrialBanner />
      <UsageUpsellBanner />
      <main id="main-content">
        <Routes>
          <Route path="/"                              element={<Home />} />
          <Route path="/onboarding"                    element={<Onboarding />} />
          <Route path="/preview"                       element={<Preview />} />
          <Route path="/dashboard"                     element={<Dashboard />} />
          <Route path="/batch"                         element={<Batch />} />
          <Route path="/schedules"                     element={<Schedules />} />
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
          <Route path="/vs/browse-ai"                  element={<VsBrowseAI />} />
          <Route path="/vs/clay"                       element={<VsClay />} />
          <Route path="/docs"                          element={<DocsRedirect />} />
          <Route path="/compare"                       element={<Navigate to="/vs/browse-ai" replace />} />
          <Route path="/compare/*"                     element={<Navigate to="/vs/browse-ai" replace />} />
          <Route path="*"                              element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {showAuthModal && <AuthModal />}
      <GuestTrialModal />
      <Footer />
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
              <PersonaProvider>
                <BillingProvider>
                  <ExtractionProvider>
                    <div className="app-root">
                      <Shell />
                    </div>
                  </ExtractionProvider>
                </BillingProvider>
              </PersonaProvider>
            </GuestTrialProvider>
          </AuthProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
