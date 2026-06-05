// TopBar.jsx — sticky navigation with brand, route links, theme toggle.
import { useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useTheme } from "./ThemeProvider.jsx";

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

export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();

  const links = [
    { to: "/", label: "Extract", match: (p) => p === "/" || p === "/preview" },
    { to: "/dashboard", label: "Dashboard", match: (p) => p === "/dashboard" },
  ];

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
        {pathname !== "/" && (
          <Button variant="primary" size="sm" icon="plus" onClick={() => navigate("/")}>
            New
          </Button>
        )}
      </div>
    </header>
  );
}
