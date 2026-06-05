// App.jsx — root: providers, top bar, routes, and the loading overlay.
import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import { ExtractionProvider, useExtraction } from "./components/ExtractionProvider.jsx";
import TopBar from "./components/TopBar.jsx";
import LoadingScreen from "./components/LoadingScreen.jsx";
import Home from "./pages/Home.jsx";
import Preview from "./pages/Preview.jsx";
import Dashboard from "./pages/Dashboard.jsx";

// Inside the providers: shows the full-screen loader during extraction,
// otherwise the top bar + routed screen.
function Shell() {
  const { loading, loadingUrl } = useExtraction();

  if (loading) return <LoadingScreen url={loadingUrl} />;

  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/preview" element={<Preview />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ExtractionProvider>
          <div className="app-root">
            <Shell />
          </div>
        </ExtractionProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
