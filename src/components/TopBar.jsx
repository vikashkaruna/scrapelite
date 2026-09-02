// TopBar.jsx — sticky navigation with brand, route links, theme toggle, auth, and mobile menu.
import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { signOut, getUserInitials, getUserAvatar, getUserDisplayName } from "../lib/authService.js";
import { usePersona } from "./PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useWorkspace } from "./WorkspaceContext.jsx";

function Brand({ onClick }) {
  return (
    <div className="brand" onClick={onClick} role="button" aria-label="DatIQ home">
      <div className="brand-mark">
        <Icon name="layers" size={19} strokeWidth={2.2} />
      </div>
      <div className="brand-text">
        <div className="brand-name">Dat<b>IQ</b></div>
        <div className="brand-tagline">Intelligence from Web</div>
      </div>
    </div>
  );
}

// ── Explore dropdown items ────────────────────────────────────────
// Flat list (no group separators). Entries with a `group` key render a
// labelled block ("Resources"); all other entries are standalone items.
// `external: true` renders a plain <a href> — a full page load. That is not a
// style choice: those destinations are STATIC-OWNED pages with no React route
// (see scripts/site-routes.mjs), so a react-router <Link> would fall through to
// NotFound. Everything without the flag is a React route and navigates in-app.
const EXPLORE_ITEMS = [
  { label: "Plans & Pricing", icon: "tag", path: "/pricing" },
  { label: "Integrations",    icon: "zap", path: "/integrations" },
  {
    group: "Resources",
    items: [
      { label: "Use Cases",      icon: "target",      path: "/use-cases" },
      { label: "Compare Tools",  icon: "bar-chart",   path: "/vs/compare" },
      { label: "Public Gallery", icon: "library",     path: "/gallery" },
      { label: "Blog",           icon: "book-open",   path: "/blog" },
      { label: "Changelog",      icon: "history",     path: "/changelog" },
      { label: "Help Center",    icon: "help-circle", path: "/help/index.html", external: true },
      { label: "FAQ",            icon: "help-circle", path: "/faq",             external: true },
    ],
  },
  { label: "Contact Us",  icon: "mail", path: "/contact" },
  { label: "About DatIQ", icon: "info", path: "/about" },
];

const EXPLORE_ACTIVE_PATHS = ["/pricing", "/integrations", "/use-cases", "/vs/", "/about", "/blog", "/contact", "/gallery", "/p/", "/changelog", "/for-", "/extract-", "/dmca", "/faq"];

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
function UserDropdown({ user, persona, onWorkspace, onAccount, onSchedules, onSwitchRole, onSignOut, onSignIn }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { workspaces, currentWorkspaceId, setCurrentWorkspaceId } = useWorkspace();

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
          {/* Workspace and Schedules both live here rather than in the
              primary nav. Both are signed-in destinations people reach from
              wherever they formed the intent — the Home composer, a persona
              switch, Dashboard's run history — so neither needs to compete
              with the four primary verbs for space. This is the "I know it
              exists, where was it" path. */}
          {user && (
            <button className="nav-dropdown-item" role="menuitem"
              onClick={() => { setOpen(false); onWorkspace(); }}>
              <span className="nav-dd-icon"><Icon name="layout-grid" size={14} /></span>
              Workspace
            </button>
          )}
          {user && workspaces.length > 0 && (
            <div className="nav-dd-workspace-switch" role="menuitem">
              <span className="nav-dd-icon"><Icon name="layout-grid" size={14} /></span>
              <label htmlFor="topbar-workspace-select" className="sr-only">Working in</label>
              <select
                id="topbar-workspace-select"
                className="nav-dd-workspace-select"
                value={currentWorkspaceId || ""}
                onChange={(e) => setCurrentWorkspaceId(e.target.value || null)}
                title="Which workspace new extractions and audits act under"
              >
                <option value="">Personal</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          )}
          {user && (
            <button className="nav-dropdown-item" role="menuitem"
              onClick={() => { setOpen(false); onSchedules(); }}>
              <span className="nav-dd-icon"><Icon name="calendar-clock" size={14} /></span>
              Schedules &amp; monitors
            </button>
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
                     onWorkspace, onAccount, onSchedules, onSwitchRole, onSignOut, onSignIn }) {
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
        //
        // Pass a real boolean, never `""`. Under React 18 this read
        // `inert={!isOpen ? "" : undefined}`, because React 18 did not know
        // `inert` and forwarded the empty string as a bare attribute, which
        // HTML reads as true. React 19 knows `inert` as a boolean prop, so
        // `""` now coerces to FALSE and the attribute is dropped entirely —
        // silently restoring the exact tab-into-the-offscreen-menu bug this
        // line exists to prevent. React 19 warns about it, but nothing fails:
        // no test asserts inertness, so the suite stayed green.
        inert={!isOpen}
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
              {user && (
                <button className="mobile-nav-item" onClick={() => { onWorkspace(); onClose(); }}>
                  <span className="mobile-nav-icon"><Icon name="layout-grid" size={17} /></span>
                  Workspace
                </button>
              )}
              {user && (
                <button className="mobile-nav-item" onClick={() => { onSchedules(); onClose(); }}>
                  <span className="mobile-nav-icon"><Icon name="calendar-clock" size={17} /></span>
                  Schedules &amp; monitors
                </button>
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
            <button className="mobile-nav-item mobile-nav-item-primary" onClick={() => { onSignIn("signin"); onClose(); }}>
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
    // "Extract" covers batch too: the Home composer detects 2+ URLs (or a CSV,
    // or links inside pasted prose) and routes to /batch itself, so a separate
    // Batch nav item advertised a second front door to the same feature. The
    // route still exists — it's the run + results surface, reached from the
    // composer and from Dashboard's batch-run history.
    { to: "/",            label: "Extract",     icon: "globe",     match: (p) => p === "/" || p === "/preview" || p === "/batch" },
    // Schedules is deliberately NOT a nav item. Every place a person forms the
    // intent to schedule something already offers the door: the Home composer's
    // cadence dropdown, Workspace's Schedules tab and quick actions, Dashboard's
    // run history, and the Explore menu. A fifth entry competed with the four
    // primary verbs for the widest breakpoint's worth of space while duplicating
    // routes the user reaches from where they already are. The /schedules route
    // is unchanged and every existing link still works.
    // Discoverability is its own entry rather than a tab inside Extract: it
    // answers a different question ("can this page be found and cited?") about
    // a page the user usually already owns, whereas Extract answers "what is on
    // this page?" about one they usually do not.
    // Labelled "Discover", not "Discoverability". The full word is 15
    // characters against 7-9 for every sibling, so it dominated the nav and was
    // the first item to force the tablet breakpoint to compress. The ROUTE, the
    // page <h1> and every piece of copy stay "Discoverability" — this is the
    // nav label only, where space is the constraint and the icon plus context
    // carry the rest of the meaning.
    // Templates is the activation path (PRD 1): the fastest route from "I have
    // a job to do" to a finished piece of work. It earns a primary slot because
    // it is where a new user's first successful session starts — the catalogue
    // is also a public acquisition surface, so it must be reachable without
    // already knowing it exists. "Templates" is 9 chars, matching Dashboard and
    // Schedules, so it does not repeat the tablet-breakpoint crowding that made
    // "Discoverability" become "Discover".
    { to: "/templates",   label: "Templates",   icon: "layout-list", match: (p) => p.startsWith("/templates") },
    { to: "/discoverability", label: "Discover", icon: "scan-search", match: (p) => p === "/discoverability" },
    { to: "/dashboard",   label: "Dashboard",   icon: "grid",      match: (p) => p === "/dashboard" },
    // Workspace moved into the signed-in user menu (2026-08-28), same
    // reasoning already applied to Schedules below: it's a destination people
    // reach with intent already formed (a persona switch, a team's shared
    // view), not one that needs to compete with the primary verbs for the
    // widest breakpoint's worth of nav space. Listed above "Schedules &
    // monitors" in that menu. Collections moved inside /workspace as a tab
    // (2026-08-11) — old /collections URLs still work via the redirect in
    // App.jsx.
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
              onWorkspace={() => navigate("/workspace")}
              onAccount={() => navigate("/account")}
              onSchedules={() => navigate("/schedules")}
              onSwitchRole={handleSwitchRole}
              onSignOut={handleSignOut}
              onSignIn={() => openAuth("signin")}
            />
          ) : (
            <Button variant="primary" size="sm" icon="log-in" onClick={() => openAuth("signin")}>Sign in</Button>
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
        onWorkspace={() => navigate("/workspace")}
        onAccount={() => navigate("/account")}
        onSchedules={() => navigate("/schedules")}
        onSwitchRole={handleSwitchRole}
        onSignOut={handleSignOut}
        onSignIn={(mode) => openAuth(mode || "signin")}
      />
    </>
  );
}
