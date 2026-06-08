// TopBar.jsx — sticky navigation with brand, route links, theme toggle, and auth.
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { signOut, getUserInitials, getUserAvatar, getUserDisplayName } from "../lib/authService.js";

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

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const { user, openAuth } = useAuth();

  const links = [
    { to: "/", label: "Extract", match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
  ];

  async function handleSignOut() {
    try {
      await signOut();
    } catch {
      // Ignore sign-out errors; the session will be cleared locally.
    }
    navigate("/");
  }

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
