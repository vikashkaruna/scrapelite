// TopBar.jsx — sticky navigation with brand, route links, theme toggle, auth, and mobile menu.
import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { signOut, getUserInitials, getUserAvatar, getUserDisplayName } from "../lib/authService.js";
import { usePersona } from "./PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";

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

// ── Explore dropdown items ────────────────────────────────────────
// Flat list (no group separators). Entries with a `group` key render a
// labelled block ("Resources"); all other entries are standalone items.
const EXPLORE_ITEMS = [
  { label: "Plans & Pricing", icon: "tag",    path: "/pricing" },
  { label: "Use Cases",       icon: "target", path: "/use-cases/usecase.html", external: true },
  {
    group: "Resources",
    items: [
      { label: "Integrations",  icon: "zap",         path: "/integrations" },
      { label: "Compare Tools", icon: "bar-chart",   path: "/vs/compare.html", external: true },
      { label: "Blog",          icon: "book-open",   path: "/blog" },
      { label: "Help Center",   icon: "help-circle", path: "/help/index.html", external: true },
    ],
  },
  { label: "Contact Us",  icon: "mail", path: "/contact" },
  { label: "About DatIQ", icon: "info", path: "/about" },
];

const EXPLORE_ACTIVE_PATHS = ["/pricing", "/integrations", "/use-cases", "/vs/", "/about", "/blog", "/contact"];

function ExploreItem({ item, onNavigate }) {
  return item.external ? (
    <a
      href={item.path}
      className="nav-dropdown-item"
      role="menuitem"
      onClick={() => onNavigate()}
    >
      <span className="nav-dd-icon"><Icon name={item.icon} size={14} /></span>
      {item.label}
    </a>
  ) : (
    <button
      className="nav-dropdown-item"
      role="menuitem"
      onClick={() => onNavigate(item.path)}
    >
      <span className="nav-dd-icon"><Icon name={item.icon} size={14} /></span>
      {item.label}
    </button>
  );
}

function ExploreDropdown({ onNavigate }) {
  return (
    <div className="nav-dropdown-menu nav-explore-menu" role="menu">
      {EXPLORE_ITEMS.map((entry) =>
        entry.group ? (
          <div key={entry.group} className="nav-dropdown-group">
            <div className="nav-dropdown-section">{entry.group}</div>
            {entry.items.map((item) => (
              <ExploreItem key={item.path} item={item} onNavigate={onNavigate} />
            ))}
            <div className="nav-dropdown-divider" />
          </div>
        ) : (
          <ExploreItem key={entry.path} item={entry} onNavigate={onNavigate} />
        )
      )}
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
            Switch persona
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

// ── Mobile nav panel (hamburger menu) ────────────────────────────
function MobileNav({ isOpen, onClose, pathname, navigate, mainLinks, isExploreActive, persona, user,
                     onAccount, onSwitchRole, onSignOut, onSignIn }) {
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
        // The `inert` attribute (HTML standard) removes the entire subtree
        // from the focus order and from the a11y tree when the mobile menu
        // is closed. Without it, `aria-hidden` only hides content from the
        // a11y tree but Tab still moves into the offscreen buttons.
        inert={!isOpen ? "" : undefined}
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
              {EXPLORE_ITEMS.map((entry) => {
                const renderItem = (item) =>
                  item.external ? (
                    <a key={item.path} href={item.path}
                      className="mobile-nav-subitem" onClick={onClose}>
                      <Icon name={item.icon} size={14} />
                      {item.label}
                    </a>
                  ) : (
                    <button key={item.path} className="mobile-nav-subitem" onClick={() => go(item.path)}>
                      <Icon name={item.icon} size={14} />
                      {item.label}
                    </button>
                  );
                return entry.group ? (
                  <div key={entry.group} className="mobile-nav-group">
                    <div className="mobile-nav-group-label">{entry.group}</div>
                    {entry.items.map(renderItem)}
                  </div>
                ) : (
                  renderItem(entry)
                );
              })}
            </div>
          )}
        </div>

        {/* User section */}
        <div className="mobile-nav-divider" />
        <div className="mobile-nav-section">
          {user ? (
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
                Switch persona
              </button>
              <div className="mobile-nav-divider" />
              <button className="mobile-nav-item mobile-nav-danger" onClick={() => { onSignOut(); onClose(); }}>
                <span className="mobile-nav-icon"><Icon name="log-out" size={17} /></span>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button className="mobile-nav-item" onClick={() => { onSignIn("signin"); onClose(); }}>
                <span className="mobile-nav-icon"><Icon name="log-in" size={17} /></span>
                Sign in
              </button>
              <button className="mobile-nav-item" onClick={() => { onSignIn("signup"); onClose(); }}>
                <span className="mobile-nav-icon"><Icon name="user-plus" size={17} /></span>
                Sign up
              </button>
            </>
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
  const { personaId, resetOnboarding } = usePersona();

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

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;
  const isExploreActive = EXPLORE_ACTIVE_PATHS.some((p) => pathname.startsWith(p));

  const mainLinks = [
    { to: "/",            label: "Extract",     icon: "globe",     match: (p) => p === "/" || p === "/preview" },
    { to: "/batch",       label: "Batch",       icon: "layers-2",  match: (p) => p === "/batch" },
    { to: "/schedules",   label: "Schedules",   icon: "repeat",    match: (p) => p === "/schedules" },
    { to: "/dashboard",   label: "Dashboard",   icon: "grid",      match: (p) => p === "/dashboard" },
    { to: "/collections", label: "Collections", icon: "folder",    match: (p) => p === "/collections" },
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
      <div className="topbar-inner">
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

          <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme" title="Toggle light / dark">
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>

          {pathname === "/preview" && (
            <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>New</Button>
          )}

          {user ? (
            <UserDropdown
              user={user} persona={persona}
              onAccount={() => navigate("/account")}
              onSwitchRole={handleSwitchRole}
              onSignOut={handleSignOut}
              onSignIn={() => openAuth("signin")}
            />
          ) : (
            <>
              <Button variant="ghost" size="sm" icon="log-in" onClick={() => openAuth("signin")}>Sign in</Button>
              <Button variant="primary" size="sm" onClick={() => openAuth("signup")}>Sign up</Button>
            </>
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
        onAccount={() => navigate("/account")}
        onSwitchRole={handleSwitchRole}
        onSignOut={handleSignOut}
        onSignIn={(mode) => openAuth(mode || "signin")}
      />
    </>
  );
}
