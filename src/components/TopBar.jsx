// TopBar.jsx — sticky navigation with brand, route links, theme toggle, auth, and mobile menu.
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
        <div className="brand-name">Dat<b>IQ</b></div>
        <div className="brand-tagline">Intelligence from every URL</div>
      </div>
    </div>
  );
}

// ── Explore mega-dropdown sections ────────────────────────────────
const EXPLORE_SECTIONS = [
  {
    key: "pricing",
    label: "Pricing",
    items: [
      { label: "Plans & Pricing",     icon: "tag",       path: "/pricing" },
      { label: "Integrations",        icon: "zap",       path: "/integrations" },
    ],
  },
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
      { label: "vs Browse.ai", icon: "zap", path: "/vs/browse-ai" },
      { label: "vs Clay",      icon: "zap", path: "/vs/clay" },
    ],
  },
  {
    key: "resources",
    label: "Resources",
    items: [
      { label: "About DatIQ", icon: "info",        path: "/about" },
      { label: "Blog",        icon: "book-open",   path: "/blog" },
      { label: "Help Center", icon: "help-circle", path: "/help/index.html", external: true },
    ],
  },
];

const EXPLORE_ACTIVE_PATHS = ["/pricing", "/integrations", "/use-cases/", "/vs/", "/about", "/blog"];

function ExploreDropdown({ onNavigate }) {
  return (
    <div className="nav-dropdown-menu nav-explore-menu" role="menu">
      {EXPLORE_SECTIONS.map((section, si) => (
        <div key={section.key}>
          {si > 0 && <div className="nav-dropdown-divider" />}
          <div className="nav-dropdown-section">{section.label}</div>
          {section.items.map((item) =>
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
          )}
        </div>
      ))}
    </div>
  );
}

// ── User account dropdown ─────────────────────────────────────────
function UserDropdown({ user, persona, onAccount, onSwitchRole, onSignOut, onSignIn }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = user ? getUserInitials(user) : null;
  const avatar   = user ? getUserAvatar(user)    : null;

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
          <img src={avatar} alt="avatar" className="user-avatar-img" referrerPolicy="no-referrer"
            style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0 }} />
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
        <Icon name="chevron-down" size={13} style={{
          color: "var(--text-3)", transition: "transform .15s",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
        }} />
      </button>

      {open && (
        <div className="user-dropdown-menu" role="menu">
          {(user || persona) && (
            <>
              <div className="user-dd-profile">
                <div className="user-dd-avatar">
                  {avatar
                    ? <img src={avatar} alt="avatar" className="user-avatar-img" referrerPolicy="no-referrer" />
                    : <span className="user-avatar-initials">{initials || "?"}</span>}
                </div>
                <div className="user-dd-info">
                  {user    && <div className="user-dd-name">{getUserDisplayName(user)}</div>}
                  {persona && <div className="user-dd-role" style={{ color: persona.color }}>{persona.label}</div>}
                </div>
              </div>
              <div className="nav-dropdown-divider" />
            </>
          )}
          <button className="nav-dropdown-item" role="menuitem"
            onClick={() => { setOpen(false); onAccount(); }}>
            <span className="nav-dd-icon"><Icon name="user" size={14} /></span>
            Account &amp; Usage
          </button>
          <button className="nav-dropdown-item" role="menuitem"
            onClick={() => { setOpen(false); onSwitchRole(); }}>
            <span className="nav-dd-icon"><Icon name="repeat" size={14} /></span>
            Switch Role / Persona
          </button>
          <div className="nav-dropdown-divider" />
          {user ? (
            <button className="nav-dropdown-item nav-dd-danger" role="menuitem"
              onClick={() => { setOpen(false); onSignOut(); }}>
              <span className="nav-dd-icon"><Icon name="log-out" size={14} /></span>
              Sign out
            </button>
          ) : (
            <button className="nav-dropdown-item" role="menuitem"
              onClick={() => { setOpen(false); onSignIn(); }}>
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

// ── Mobile nav panel (hamburger menu) ────────────────────────────
function MobileNav({ isOpen, onClose, pathname, navigate, mainLinks, isExploreActive, persona, user,
                     onAccount, onSwitchRole, onSignOut, onSignIn, onboarded }) {
  const [exploreOpen, setExploreOpen] = useState(false);

  // Close panel on navigation
  function go(path) {
    navigate(path);
    onClose();
  }

  return (
    <>
      {/* Overlay backdrop */}
      {isOpen && <div className="mobile-nav-backdrop" onClick={onClose} aria-hidden="true" />}

      <nav
        className={"mobile-nav" + (isOpen ? " mobile-nav-open" : "")}
        aria-label="Mobile navigation"
        aria-hidden={!isOpen}
      >
        {/* Main links with icon + text */}
        <div className="mobile-nav-section">
          {mainLinks.map((l) => (
            <button
              key={l.to}
              className={"mobile-nav-item" + (l.match(pathname) ? " active" : "")}
              onClick={() => go(l.to)}
              aria-current={l.match(pathname) ? "page" : undefined}
            >
              <span className="mobile-nav-icon"><Icon name={l.icon} size={17} /></span>
              <span>{l.label}</span>
            </button>
          ))}

          {/* Explore accordion */}
          <button
            className={"mobile-nav-item" + (isExploreActive ? " active" : "")}
            onClick={() => setExploreOpen((v) => !v)}
            aria-expanded={exploreOpen}
          >
            <span className="mobile-nav-icon"><Icon name="compass" size={17} /></span>
            <span>Explore</span>
            <Icon name="chevron-down" size={14} style={{
              marginLeft: "auto", transition: "transform .15s",
              transform: exploreOpen ? "rotate(180deg)" : "rotate(0)",
            }} />
          </button>
          {exploreOpen && (
            <div className="mobile-nav-sub">
              {EXPLORE_SECTIONS.map((section) => (
                <div key={section.key} className="mobile-nav-group">
                  <div className="mobile-nav-group-label">{section.label}</div>
                  {section.items.map((item) =>
                    item.external ? (
                      <a key={item.path} href={item.path} target="_blank" rel="noopener noreferrer"
                        className="mobile-nav-subitem" onClick={onClose}>
                        <Icon name={item.icon} size={14} />
                        {item.label}
                      </a>
                    ) : (
                      <button key={item.path} className="mobile-nav-subitem" onClick={() => go(item.path)}>
                        <Icon name={item.icon} size={14} />
                        {item.label}
                      </button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User section */}
        <div className="mobile-nav-divider" />
        <div className="mobile-nav-section">
          {(onboarded || user) ? (
            <>
              {persona && (
                <div className="mobile-nav-persona">
                  <span className="user-persona-dot" style={{ background: persona.color, width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                  <span style={{ color: persona.color, fontSize: ".86em", fontWeight: 650 }}>{persona.label}</span>
                </div>
              )}
              <button className="mobile-nav-item" onClick={() => { onAccount(); onClose(); }}>
                <span className="mobile-nav-icon"><Icon name="user" size={17} /></span>
                Account &amp; Usage
              </button>
              <button className="mobile-nav-item" onClick={() => { onSwitchRole(); onClose(); }}>
                <span className="mobile-nav-icon"><Icon name="repeat" size={17} /></span>
                Switch Role
              </button>
              <div className="mobile-nav-divider" />
              {user ? (
                <button className="mobile-nav-item mobile-nav-danger" onClick={() => { onSignOut(); onClose(); }}>
                  <span className="mobile-nav-icon"><Icon name="log-out" size={17} /></span>
                  Sign out
                </button>
              ) : (
                <button className="mobile-nav-item" onClick={() => { onSignIn(); onClose(); }}>
                  <span className="mobile-nav-icon"><Icon name="log-in" size={17} /></span>
                  Sign in
                </button>
              )}
            </>
          ) : (
            <button className="mobile-nav-item" onClick={() => { onSignIn(); onClose(); }}>
              <span className="mobile-nav-icon"><Icon name="log-in" size={17} /></span>
              Sign in
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

// ── TopBar root ───────────────────────────────────────────────────
export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const { user, openAuth } = useAuth();
  const { personaId, onboarded, resetOnboarding } = usePersona();
  const { planId } = useBilling();

  const [showExplore, setShowExplore]  = useState(false);
  const [mobileOpen,  setMobileOpen]   = useState(false);
  const exploreRef = useRef(null);

  // Close Explore dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (exploreRef.current && !exploreRef.current.contains(e.target)) setShowExplore(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close dropdowns on route change
  useEffect(() => { setShowExplore(false); setMobileOpen(false); }, [pathname]);

  const persona      = personaId ? PERSONA_BY_ID[personaId] : null;
  const effectivePlan = getEffectivePlanById(planId ?? "free");
  const isExploreActive = EXPLORE_ACTIVE_PATHS.some((p) => pathname.startsWith(p));

  const mainLinks = [
    { to: "/",          label: "Extract",   icon: "globe", match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", icon: "grid",  match: (p) => p === "/dashboard" },
  ];

  async function handleSignOut() {
    try { await signOut(); } catch { /* ignore */ }
    navigate("/");
  }
  const handleSwitchRole = () => { resetOnboarding(); navigate("/onboarding"); };
  const handleExploreNav = (path) => { setShowExplore(false); if (path) navigate(path); };

  return (
    <>
      <header className="topbar" aria-label="Site header">
        <Brand onClick={() => navigate("/")} />

        {/* ── Desktop / tablet nav ── */}
        <div className="topbar-actions topbar-desktop-actions">
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
                <span className="nav-link-text">{l.label}</span>
              </button>
            ))}

            {/* Explore dropdown */}
            <div className="nav-dropdown" ref={exploreRef}>
              <button
                type="button"
                className={"nav-link nav-link-icon nav-link-dropdown" + (isExploreActive ? " active" : "")}
                onClick={() => setShowExplore((v) => !v)}
                aria-expanded={showExplore}
                aria-haspopup="true"
              >
                <Icon name="compass" size={14} />
                <span className="nav-link-text">Explore</span>
                <Icon name="chevron-down" size={12} style={{
                  transition: "transform .15s",
                  transform: showExplore ? "rotate(180deg)" : "rotate(0)",
                  marginLeft: 1,
                }} />
              </button>
              {showExplore && <ExploreDropdown onNavigate={handleExploreNav} />}
            </div>
          </nav>

          <PlanBadge planId={planId} planName={effectivePlan?.name ?? ""} onClick={() => navigate("/account")} />

          <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>

          {pathname === "/preview" && (
            <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>New</Button>
          )}

          {(onboarded || user) ? (
            <UserDropdown
              user={user} persona={persona}
              onAccount={() => navigate("/account")}
              onSwitchRole={handleSwitchRole}
              onSignOut={handleSignOut}
              onSignIn={openAuth}
            />
          ) : (
            <Button variant="secondary" size="sm" icon="log-in" onClick={openAuth}>Sign in</Button>
          )}
        </div>

        {/* ── Mobile top-right: theme + hamburger ── */}
        <div className="topbar-mobile-actions">
          <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
          <button
            className={"theme-toggle hamburger-btn" + (mobileOpen ? " open" : "")}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
          >
            <Icon name={mobileOpen ? "x" : "menu"} size={20} />
          </button>
        </div>
      </header>

      {/* Mobile nav panel (rendered outside topbar for z-index stacking) */}
      <MobileNav
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        pathname={pathname}
        navigate={navigate}
        mainLinks={mainLinks}
        isExploreActive={isExploreActive}
        persona={persona}
        user={user}
        onboarded={onboarded}
        onAccount={() => navigate("/account")}
        onSwitchRole={handleSwitchRole}
        onSignOut={handleSignOut}
        onSignIn={openAuth}
      />
    </>
  );
}
