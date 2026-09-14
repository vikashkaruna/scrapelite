import { Link, useLocation, useSearchParams } from "react-router";
import WorkspaceRedirect from "../components/WorkspaceRedirect.jsx";
import Icon from "../components/Icon.jsx";
import BusinessTruthPanel from "../components/discoverability/BusinessTruthPanel.jsx";
import EntityGraphPanel from "../components/discoverability/EntityGraphPanel.jsx";
import LocalDirectoryPanel from "../components/discoverability/LocalDirectoryPanel.jsx";
import SchemaTrustPanel from "../components/discoverability/SchemaTrustPanel.jsx";
import SubjectScoresPanel from "../components/discoverability/SubjectScoresPanel.jsx";
import SxoDashboard from "../components/discoverability/SxoDashboard.jsx";
import ClosedLoopRibbon from "../components/discoverability/ClosedLoopRibbon.jsx";
import { UNIFIED_DISCOVERABILITY_NAV } from "./Discoverability.jsx";
import { useWorkspace } from "../components/WorkspaceContext.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { discoverability } from "../lib/discoverability/discoverabilityClient.js";

export const DISCOVERABILITY_WORKSPACES = Object.freeze([
  { path: "/discoverability/truth", label: "Business Truth", icon: "database", component: BusinessTruthPanel, step: "implement" },
  { path: "/discoverability/entities", label: "Entity Graph", icon: "share-2", component: EntityGraphPanel, step: "expand" },
  { path: "/discoverability/local", label: "Local Directory", icon: "map-pin", component: LocalDirectoryPanel, step: "expand" },
  { path: "/discoverability/trust", label: "Schema & Trust", icon: "shield-check", component: SchemaTrustPanel, step: "implement" },
  { path: "/discoverability/scores", label: "Subject Scores", icon: "award", component: SubjectScoresPanel, step: "benchmark" },
  { path: "/discoverability/sxo", label: "SXO & Outcomes", icon: "zap", component: SxoDashboard, step: "validate" },
]);

function WorkspaceScreen() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { currentWorkspaceId } = useWorkspace();
  const { user } = useAuth();
  const showToast = useToast();
  const config = DISCOVERABILITY_WORKSPACES.find((item) => item.path === pathname)
    || DISCOVERABILITY_WORKSPACES[0];
  const Screen = config.component;
  const auditId = params.get("audit");

  useSeo({
    title: `${config.label} — Discoverability | DatIQ`,
    description: `Manage ${config.label.toLowerCase()} in the DatIQ Discoverability workspace.`,
    robots: "noindex,nofollow",
  });

  const screenProps = config.path === "/discoverability/sxo"
    ? {
        auditId,
        fullAudit: null,
        workspaceId: currentWorkspaceId,
        onRunSxo: async () => {
          if (!auditId) {
            showToast("Open an audit before running SXO.", "warning");
            return;
          }
          try {
            await discoverability.evaluateSxo({ audit_id: auditId, workspace_id: currentWorkspaceId });
            showToast("SXO evaluation refreshed.", "success");
          } catch (error) {
            showToast(error.message || "Failed to evaluate SXO.", "error");
          }
        },
      }
    : {
        workspaceId: currentWorkspaceId,
        currentUser: user,
      };

  return (
    <div className="page dsc-page">
      <div className="container">
        <header className="dsc-header">
          <div>
            <p className="eyebrow">Discoverability workspace</p>
            <h1 className="dsc-h1"><Icon name={config.icon} size={24} /> {config.label}</h1>
            <p className="dsc-sub">A dedicated operational surface with workspace-scoped review and governance.</p>
          </div>
          <Link className="btn btn-ghost btn-sm" to={auditId ? `/discoverability?audit=${encodeURIComponent(auditId)}` : "/discoverability"}>
            <Icon name="arrow-left" size={14} /> Audit workspace
          </Link>
        </header>

        <ClosedLoopRibbon auditId={auditId || null} currentStep={config.step || "implement"} />

        <nav className="dsc-tabs dsc-subnav-tabs" aria-label="Discoverability workspaces">
          {UNIFIED_DISCOVERABILITY_NAV.map((item) => {
            const isTabActive = item.path === pathname;
            const targetUrl = item.path
              ? `${item.path}${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`
              : (item.id === "history"
                  ? `/discoverability?view=history${auditId ? `&audit=${encodeURIComponent(auditId)}` : ""}`
                  : `/discoverability${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`);
            return (
              <Link
                key={item.id}
                className={`dsc-tab${isTabActive ? " dsc-tab-on" : ""}`}
                to={targetUrl}
                aria-current={isTabActive ? "page" : undefined}
              >
                <span className="dsc-tab-label"><Icon name={item.icon} size={15} /> {item.label}</span>
              </Link>
            );
          })}
        </nav>

        {auditId && (
          <div className="dsc-active-audit-banner">
            <div className="dsc-active-audit-info">
              <Icon name="scan-search" size={16} className="text-accent" />
              <span>Active Audit Context: <code>{auditId}</code></span>
            </div>
            <Link to={`/discoverability?audit=${encodeURIComponent(auditId)}`} className="btn btn-ghost btn-sm">
              Return to Audit Report &rarr;
            </Link>
          </div>
        )}

        <Screen {...screenProps} />
      </div>
    </div>
  );
}

export default function DiscoverabilityWorkspace() {
  return <WorkspaceRedirect><WorkspaceScreen /></WorkspaceRedirect>;
}
