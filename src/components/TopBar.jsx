// TopBar.jsx — sticky navigation with brand, route links, theme toggle, auth, and persona badge.
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

function UserChip({ user, onSignOut }) {
  const initials = getUserInitials(user);
  const avatar = getUserAvatar(user);
  const name = getUserDisplayName(user);

  return (
    <div className="user-chip" title={`Signed in as ${name}`}>
      <div className="user-avatar">
        {avatar ? (
          <img src={avatar} alt={name} className="user-avatar-img" referrerPolicy="no-referrer" />
        ) : (
          <span className="user-avatar-initials">{initials}</span>
        )}
      </div>
      <button
        className="user-signout"
        onClick={onSignOut}
        title="Sign out"
        aria-label="Sign out"
      >
        <Icon name="log-out" size={15} />
      </button>
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

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const { user, openAuth } = useAuth();
  const { personaId, userName, onboarded, resetOnboarding } = usePersona();

  const persona = personaId ? PERSONA_BY_ID[personaId] : null;

  const links = [
    { to: "/", label: "Extract", match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
  ];

  async function handleSignOut() {
    try { await signOut(); } catch { /* ignore */ }
    navigate("/");
  }

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
          {/* Static help site — plain anchor bypasses the SPA router. */}
          <a className="nav-link" href="/help/index.html" target="_blank" rel="noopener">
            Help
          </a>
        </nav>

        {/* Persona badge */}
        {persona && <PersonaBadge persona={persona} onClick={handleSwitchRole} />}

        {/* User name greeting (from persona onboarding) */}
        {userName && (
          <div className="topbar-username" title={`Logged in as ${userName}`}>
            <Icon name="user" size={15} />
            <span>{userName}</span>
          </div>
        )}

        <button
          className="theme-toggle"
          onClick={toggle}
          aria-label="Toggle theme"
          title="Toggle light / dark"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>

        {pathname === "/preview" && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>
            New
          </Button>
        )}

        {/* Auth UI */}
        {user ? (
          <UserChip user={user} onSignOut={handleSignOut} />
        ) : (
          <Button variant="secondary" size="sm" icon="log-in" onClick={openAuth}>
            Sign in
          </Button>
        )}
      </div>
    </header>
  );
}
