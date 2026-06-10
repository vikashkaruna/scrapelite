// TopBar.jsx — sticky navigation with brand, route links, theme toggle, auth, persona badge, and plan badge.
import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { signOut, getUserInitials, getUserAvatar, getUserDisplayName } from "../lib/authService.js";
import { usePersona } from "./PersonaProvider.jsx";
import { useBilling } from "./BillingProvider.jsx";
import { getEffectivePlanById } from "../lib/pricingOverrides.js";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";

const PLAN_COLORS = { free: "#94a3b8", select: "#60a5fa", pro: "#818cf8", business: "#a78bfa", agency: "#f472b6" };

function Brand({ onClick }) {
  return (
    <div className="brand" onClick={onClick} role="button" aria-label="DatIQ home">
      <div className="brand-mark">
        <Icon name="layers" size={19} strokeWidth={2.2} />
      </div>
      <div className="brand-text">
        <div className="brand-name">
          Dat<b>IQ</b>
        </div>
        <div className="brand-tagline">Intelligence from every URL</div>
      </div>
    </div>
  );
}

// ── Explore mega-dropdown ──────────────────────────────────────────
const EXPLORE_SECTIONS = [
  {
    key: "use-cases",
    label: "Use Cases",
    items: [
      { label: "Lead Generation",     icon: "target",    path: "/use-cases/lead-generation" },
      { label: "Competitor Research", icon: "eye",       path: "/use-cases/competitor-research" },
      { label: "SEO Audit",           icon: "search",    path: "/use-cases/seo-audit" },
      { label: "Market Research",     icon: "bar-chart", path: "/use-cases/market-research" },
    ],
  },
  {
    key: "compare",
    label: "Compare",
    items: [
      { label: "vs Browse.ai", icon: "zap",       path: "/vs/browse-ai" },
      { label: "vs Clay",      icon: "zap",       path: "/vs/clay" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { label: "About DatIQ", icon: "info",         path: "/about" },
      { label: "Blog",        icon: "book-open",    path: "/blog" },
      { label: "Help Center", icon: "help-circle",  path: "/help/index.html", external: true },
    ],
  },
];

const EXPLORE_ACTIVE_PATHS = [
  "/use-cases/", "/vs/", "/about", "/blog", "/integrations",
];

function ExploreDropdown({ onNavigate }) {
  return (
    <div className="nav-dropdown-menu nav-explore-menu" role="menu">
      {EXPLORE_SECTIONS.map((section, si) => (
        <div key={section.key}>
          {si > 0 && <div className="nav-dropdown-divider" />}
          <div className="nav-dropdown-section">{section.label}</div>
          {section.items.map((item) => (
            item.external ? (
              <a
                key={item.path}
                href={item.path}
                target="_blank"
                rel="noopener noreferrer"
                className="nav-dropdown-item"
                role="menuitem"
                onClick={() => onNavigate()}
              >
                <span className="nav-dd-icon"><Icon name={item.icon} size={14} /></span>
                {item.label}
              </a>
            ) : (
              <button
                key={item.path}
                className="nav-dropdown-item"
                role="menuitem"
                onClick={() => onNavigate(item.path)}
              >
                <span className="nav-dd-icon"><Icon name={item.icon} size={14} /></span>
                {item.label}
              </button>
            )
          ))}
        </div>
      ))}
    </div>
  );
}

// ── User dropdown ────────────────────────────────────────────────
function UserDropdown({ user, persona, onAccount, onSwitchRole, onSignOut, onSignIn }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const label = persona ? persona.label : (user ? getUserDisplayName(user) : "Account");
  const initials = user ? getUserInitials(user) : null;
  const avatar = user ? getUserAvatar(user) : null;

  return (
    <div className="user-dropdown-wrap" ref={ref}>
      <button
        className={"user-menu-btn" + (open ? " open" : "")}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Your account"
      >
        {avatar ? (
          <img src={avatar} alt={label} className="user-avatar-img" referrerPolicy="no-referrer" style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0 }} />
        ) : initials ? (
          <span className="user-avatar-initials" style={{ width: 22, height: 22, fontSize: ".72em" }}>{initials}</span>
        ) : (
          <Icon name="user-circle" size={18} />
        )}
        {persona && (
          <span className="user-menu-label" style={{ color: persona.color }}>
            <span className="user-persona-dot" style={{ background: persona.color }} />
            <span className="user-menu-name">{persona.label}</span>
          </span>
        )}
        {!persona && user && (
          <span className="user-menu-label">
            <span className="user-menu-name">{getUserDisplayName(user)}</span>
          </span>
        )}
        <Icon name="chevron-down" size={13} style={{ color: "var(--text-3)", transition: "transform .15s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </button>

      {open && (
        <div className="user-dropdown-menu" role="menu">
          {(user || persona) && (
            <>
              <div className="user-dd-profile">
                <div className="user-dd-avatar">
                  {avatar ? (
                    <img src={avatar} alt={label} className="user-avatar-img" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="user-avatar-initials">{initials || "?"}</span>
                  )}
                </div>
                <div className="user-dd-info">
                  {user && <div className="user-dd-name">{getUserDisplayName(user)}</div>}
                  {persona && <div className="user-dd-role" style={{ color: persona.color }}>{persona.label}</div>}
                </div>
              </div>
              <div className="nav-dropdown-divider" />
            </>
          )}

          <button className="nav-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onAccount(); }}>
            <span className="nav-dd-icon"><Icon name="user" size={14} /></span>
            Account &amp; Usage
          </button>
          <button className="nav-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onSwitchRole(); }}>
            <span className="nav-dd-icon"><Icon name="repeat" size={14} /></span>
            Switch Role / Persona
          </button>

          <div className="nav-dropdown-divider" />

          {user ? (
            <button className="nav-dropdown-item nav-dd-danger" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}>
              <span className="nav-dd-icon"><Icon name="log-out" size={14} /></span>
              Sign out
            </button>
          ) : (
            <button className="nav-dropdown-item" role="menuitem" onClick={() => { setOpen(false); onSignIn(); }}>
              <span className="nav-dd-icon"><Icon name="log-in" size={14} /></span>
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
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
  const { user, openAuth } = useAuth();
  const { personaId, onboarded, resetOnboarding } = usePersona();
  const { planId } = useBilling();

  const [showExplore, setShowExplore] = useState(false);
  const exploreRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      if (exploreRef.current && !exploreRef.current.contains(e.target)) {
        setShowExplore(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => { setShowExplore(false); }, [pathname]);

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const effectivePlan = getEffectivePlanById(planId ?? "free");

  const isExploreActive = EXPLORE_ACTIVE_PATHS.some((p) => pathname.startsWith(p));

  const mainLinks = [
    { to: "/",          label: "Extract",   icon: "globe",    match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", icon: "grid",     match: (p) => p === "/dashboard" },
    { to: "/pricing",   label: "Pricing",   icon: "tag",      match: (p) => p === "/pricing" },
  ];

  async function handleSignOut() {
    try { await signOut(); } catch { /* ignore */ }
    navigate("/");
  }

  const handleSwitchRole = () => {
    resetOnboarding();
    navigate("/onboarding");
  };

  const handleExploreNav = (path) => {
    setShowExplore(false);
    if (path) navigate(path);
  };

  return (
    <header className="topbar" aria-label="Site header">
      <Brand onClick={() => navigate("/")} />
      <div className="topbar-actions">
        <nav className="nav-links" aria-label="Main navigation">
          {mainLinks.map((l) => (
            <button
              key={l.to}
              type="button"
              className={"nav-link nav-link-icon" + (l.match(pathname) ? " active" : "")}
              onClick={() => navigate(l.to)}
              aria-current={l.match(pathname) ? "page" : undefined}
            >
              <Icon name={l.icon} size={14} />
              <span>{l.label}</span>
            </button>
          ))}

          {/* Explore mega-dropdown */}
          <div className="nav-dropdown" ref={exploreRef}>
            <button
              type="button"
              className={"nav-link nav-link-icon nav-link-dropdown" + (isExploreActive ? " active" : "")}
              onClick={() => setShowExplore((v) => !v)}
              aria-expanded={showExplore}
              aria-haspopup="true"
              aria-current={isExploreActive ? "page" : undefined}
            >
              <Icon name="compass" size={14} />
              <span>Explore</span>
              <Icon
                name="chevron-down"
                size={12}
                style={{
                  transition: "transform .15s",
                  transform: showExplore ? "rotate(180deg)" : "rotate(0deg)",
                  marginLeft: 1,
                }}
              />
            </button>
            {showExplore && (
              <ExploreDropdown onNavigate={handleExploreNav} />
            )}
          </div>
        </nav>

        {/* Plan badge — only for paid plans */}
        <PlanBadge planId={planId} planName={effectivePlan?.name ?? ""} onClick={() => navigate("/account")} />

        <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>

        {pathname === "/preview" && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>
            New
          </Button>
        )}

        {/* User menu (always show once onboarded or if user signed in) */}
        {(onboarded || user) ? (
          <UserDropdown
            user={user}
            persona={persona}
            onAccount={() => navigate("/account")}
            onSwitchRole={handleSwitchRole}
            onSignOut={handleSignOut}
            onSignIn={openAuth}
          />
        ) : (
          <Button variant="secondary" size="sm" icon="log-in" onClick={openAuth}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
