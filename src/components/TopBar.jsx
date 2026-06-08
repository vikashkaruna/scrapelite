// TopBar.jsx — sticky navigation. V5: pricing + account links, plan badge.
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";
import { usePersona } from "./PersonaProvider.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";

const PLAN_COLORS = { free: "#94a3b8", select: "#60a5fa", pro: "#818cf8", business: "#a78bfa", agency: "#f472b6" };

function Brand({ onClick }) {
  return (
    <div className="brand" onClick={onClick} role="button" aria-label="ScrapeLite home">
      <div className="brand-mark">
        <Icon name="layers" size={19} strokeWidth={2.2} />
      </div>
      <div className="brand-name">
        Scrape<b>Lite</b>
      </div>
    </div>
  );
}

function PersonaBadge({ persona, onClick }) {
  return (
    <button
      className="persona-badge"
      onClick={onClick}
      title="Switch role"
      aria-label={`Current role: ${persona.label}. Click to switch.`}
      style={{ "--pb-color": persona.color }}
    >
      <span className="persona-badge-dot" style={{ background: persona.color }} />
      <span className="persona-badge-label">{persona.label}</span>
      <Icon name="chevron-down" size={13} style={{ color: "var(--text-3)" }} />
    </button>
  );
}

function PlanBadge({ planId, planName, onClick }) {
  const color = PLAN_COLORS[planId] ?? "#888";
  if (planId === "free") return null;
  return (
    <button className="plan-badge-btn" onClick={onClick} title="View your plan" style={{ "--pb-c": color }}>
      <Icon name="zap" size={12} style={{ color }} />
      <span style={{ color }}>{planName}</span>
    </button>
  );
}

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const { personaId, userName, onboarded, resetOnboarding } = usePersona();
  const { plan, planId } = useBilling();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  // Use effective plan (picks up admin overrides); guard against null billing context
  const effectivePlan = getEffectivePlanById(planId ?? "free");

  const links = [
    { to: "/", label: "Extract", match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
    { to: "/pricing", label: "Pricing", match: (p) => p === "/pricing" },
  ];

  const handleSwitchRole = () => {
    resetOnboarding();
    navigate("/onboarding");
  };

  return (
    <header className="topbar">
      <Brand onClick={() => navigate("/")} />

      <div className="topbar-actions">
        <nav className="nav-links">
          {links.map((l) => (
            <div
              key={l.to}
              className={"nav-link" + (l.match(pathname) ? " active" : "")}
              onClick={() => navigate(l.to)}
            >
              {l.label}
            </div>
          ))}
        </nav>

        {/* Plan badge — only for paid plans */}
        <PlanBadge planId={planId} planName={effectivePlan?.name ?? ""} onClick={() => navigate("/account")} />

        {/* Persona badge */}
        {persona && <PersonaBadge persona={persona} onClick={handleSwitchRole} />}

        {!onboarded && !persona && (
          <Button variant="secondary" size="sm" icon="log-in" onClick={() => navigate("/onboarding")}>
            Get started
          </Button>
        )}

        {/* Account link */}
        {onboarded && (
          <button
            className={"theme-toggle topbar-account" + (pathname === "/account" ? " active" : "")}
            onClick={() => navigate("/account")}
            title="Your account & usage"
            aria-label="Account"
          >
            <Icon name="user" size={17} />
          </button>
        )}

        {userName && (
          <div className="topbar-username" title={`Logged in as ${userName}`}>
            <Icon name="user" size={15} />
            <span>{userName}</span>
          </div>
        )}

        <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>

        {pathname === "/preview" && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>
            New
          </Button>
        )}
      </div>
    </header>
  );
}
