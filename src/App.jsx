// App.jsx — root: providers, top bar, routes, and the loading overlay.
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ErrorModalProvider } from "./components/ErrorModal.jsx";
import { ExtractionProvider, useExtraction } from "./components/ExtractionProvider.jsx";
import { PersonaProvider, usePersona } from "./components/PersonaProvider.jsx";
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
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import AdminRevenue from "./pages/admin/AdminRevenue.jsx";
import AdminPricing from "./pages/admin/AdminPricing.jsx";
import AdminCoupons from "./pages/admin/AdminCoupons.jsx";
import AdminUsers from "./pages/admin/AdminUsers.jsx";

const PUBLIC_PATHS = ["/onboarding", "/privacy", "/terms", "/pricing"];

function Shell() {
  const { loading, loadingUrl } = useExtraction();
  const { onboarded } = usePersona();
  const { pathname } = useLocation();

  const isAdmin  = pathname.startsWith("/admin");
  const isPublic = PUBLIC_PATHS.includes(pathname) || isAdmin;

  if (!onboarded && !isPublic) return <Navigate to="/onboarding" replace />;

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
        </Route>
      </Routes>
    );
  }

  // Onboarding — standalone (no chrome)
  if (pathname === "/onboarding") {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    );
  }

  if (loading && !isPublic) return <LoadingScreen url={loadingUrl} />;

  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/"          element={<Home />} />
        <Route path="/preview"   element={<Preview />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pricing"   element={<Pricing />} />
        <Route path="/account"   element={<Account />} />
        <Route path="/privacy"   element={<Privacy />} />
        <Route path="/terms"     element={<Terms />} />
        <Route path="*"          element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ErrorModalProvider>
          <PersonaProvider>
            <BillingProvider>
              <ExtractionProvider>
                <div className="app-root">
                  <Shell />
                </div>
              </ExtractionProvider>
            </BillingProvider>
          </PersonaProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
