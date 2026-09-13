// src/components/WorkspaceRedirect.jsx — Q4 (logged-in → workspace) guard.
//
// Logged-out users see a marketing teaser; logged-in users get the full
// command-center. Lives in its own file so it's testable in isolation
// without spinning up the whole App.

import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useAuth } from "./AuthProvider.jsx";

export default function WorkspaceRedirect({ children }) {
  const { user, loginAsReviewer, isNonProd } = useAuth();
  if (!user) {
    return (
      <div className="page">
        <div className="container" style={{ paddingTop: "clamp(40px, 6vh, 72px)", paddingBottom: "clamp(40px, 6vh, 72px)", textAlign: "center" }}>
          <div className="ws-eyebrow">
            <Icon name="layout-grid" size={12} />
            Workspace
          </div>
          <h1 style={{ fontSize: "clamp(26px, 4vw, 38px)", marginTop: 16 }}>
            Your workspace, once you sign in.
          </h1>
          <p style={{ color: "var(--text-2)", maxWidth: 540, margin: "16px auto 0", lineHeight: 1.6 }}>
            Sign in to access your saved extractions, batch runs, schedules, and templates —
            all in one place. Anonymous extraction still works on the home page.
          </p>
          <div style={{ marginTop: 28, display: "inline-flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            {isNonProd && (
              <Button variant="primary" icon="zap" onClick={() => loginAsReviewer?.()}>
                Enter as Reviewer (1-Click)
              </Button>
            )}
            <Button variant={isNonProd ? "secondary" : "primary"} onClick={() => window.dispatchEvent(new CustomEvent("datiq:openAuth", { detail: { mode: "signup" } }))}>
              Create a free account
            </Button>
            <Button variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent("datiq:openAuth", { detail: { mode: "signin" } }))}>
              Sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return children;
}
