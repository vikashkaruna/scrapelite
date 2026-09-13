import { Link, useLocation, useSearchParams } from "react-router";
import WorkspaceRedirect from "../components/WorkspaceRedirect.jsx";
import Icon from "../components/Icon.jsx";
import BusinessTruthPanel from "../components/discoverability/BusinessTruthPanel.jsx";
import EntityGraphPanel from "../components/discoverability/EntityGraphPanel.jsx";
import LocalDirectoryPanel from "../components/discoverability/LocalDirectoryPanel.jsx";
import SchemaTrustPanel from "../components/discoverability/SchemaTrustPanel.jsx";
import SubjectScoresPanel from "../components/discoverability/SubjectScoresPanel.jsx";
import SxoDashboard from "../components/discoverability/SxoDashboard.jsx";
import { useWorkspace } from "../components/WorkspaceContext.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { discoverability } from "../lib/discoverability/discoverabilityClient.js";

export const DISCOVERABILITY_WORKSPACES = Object.freeze([
  { path: "/discoverability/truth", label: "Business Truth", icon: "database", component: BusinessTruthPanel },
  { path: "/discoverability/entities", label: "Entity Graph", icon: "share-2", component: EntityGraphPanel },
  { path: "/discoverability/local", label: "Local Directory", icon: "map-pin", component: LocalDirectoryPanel },
  { path: "/discoverability/trust", label: "Schema & Trust", icon: "shield-check", component: SchemaTrustPanel },
  { path: "/discoverability/scores", label: "Subject Scores", icon: "award", component: SubjectScoresPanel },
  { path: "/discoverability/sxo", label: "SXO & Outcomes", icon: "zap", component: SxoDashboard },
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
        ...(config.path === "/discoverability/truth" ? { currentUser: user } : {}),
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

        <nav className="dsc-tabs dsc-subnav-tabs" aria-label="Discoverability workspaces">
          {DISCOVERABILITY_WORKSPACES.map((item) => (
            <Link
              key={item.path}
              className={`dsc-tab${item.path === config.path ? " dsc-tab-on" : ""}`}
              to={`${item.path}${auditId ? `?audit=${encodeURIComponent(auditId)}` : ""}`}
              aria-current={item.path === config.path ? "page" : undefined}
            >
              <span className="dsc-tab-label"><Icon name={item.icon} size={15} /> {item.label}</span>
            </Link>
          ))}
        </nav>

        <Screen {...screenProps} />
      </div>
    </div>
  );
}

export default function DiscoverabilityWorkspace() {
  return <WorkspaceRedirect><WorkspaceScreen /></WorkspaceRedirect>;
}
