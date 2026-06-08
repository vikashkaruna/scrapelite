// App.jsx — root: providers, top bar, routes, and the loading overlay.
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ErrorModalProvider } from "./components/ErrorModal.jsx";
import { ExtractionProvider, useExtraction } from "./components/ExtractionProvider.jsx";
import { PersonaProvider, usePersona } from "./components/PersonaProvider.jsx";
import TopBar from "./components/TopBar.jsx";
import Footer from "./components/Footer.jsx";
import LoadingScreen from "./components/LoadingScreen.jsx";
import Home from "./pages/Home.jsx";
import Preview from "./pages/Preview.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";

// Routes that skip the TopBar / Footer layout (standalone pages).
const STANDALONE = ["/onboarding"];
// Routes that are accessible without completing onboarding.
const PUBLIC_PATHS = ["/onboarding", "/privacy", "/terms"];

function Shell() {
  const { loading, loadingUrl } = useExtraction();
  const { onboarded } = usePersona();
  const { pathname } = useLocation();

  const isStandalone = STANDALONE.includes(pathname);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  // Redirect first-time visitors to onboarding.
  if (!onboarded && !isPublic) {
    return <Navigate to="/onboarding" replace />;
  }

  // Standalone pages (onboarding) — no chrome.
  if (isStandalone) {
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
        <Route path="/" element={<Home />} />
        <Route path="/preview" element={<Preview />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
            <ExtractionProvider>
              <div className="app-root">
                <Shell />
              </div>
            </ExtractionProvider>
          </PersonaProvider>
        </ErrorModalProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
