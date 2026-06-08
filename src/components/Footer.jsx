// Footer.jsx — site footer with nav links and social icons.
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

const LINKS = {
  Product: [
    { label: "Extract", path: "/" },
    { label: "Dashboard", path: "/dashboard" },
    { label: "Pricing", href: "#pricing" },
    { label: "Changelog", href: "#changelog" },
  ],
  Company: [
    { label: "About", href: "#about" },
    { label: "Blog", href: "#blog" },
  ],
  Legal: [
    { label: "Privacy Policy", path: "/privacy" },
    { label: "Terms of Service", path: "/terms" },
  ],
};

const SOCIALS = [
  { name: "linkedin", href: "https://linkedin.com", label: "LinkedIn" },
  { name: "twitter", href: "https://twitter.com", label: "Twitter / X" },
];

export default function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        {/* Brand column */}
        <div className="footer-brand-col">
          <div className="footer-brand" onClick={() => navigate("/")} role="button" tabIndex={0} aria-label="ScrapeLite home">
            <div className="footer-brand-mark">
              <Icon name="layers" size={17} strokeWidth={2.2} />
            </div>
            <span className="footer-brand-name">
              Scrape<b>Lite</b>
            </span>
          </div>
          <p className="footer-tagline">
            Zero-code web extraction and enrichment. From URL to structured intelligence in seconds.
          </p>
          <div className="footer-socials">
            {SOCIALS.map((s) => (
              <a
                key={s.name}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="footer-social-btn"
                aria-label={s.label}
              >
                <Icon name={s.name} size={16} />
              </a>
            ))}
          </div>
        </div>

        {/* Nav columns */}
        {Object.entries(LINKS).map(([section, items]) => (
          <div key={section} className="footer-nav-col">
            <div className="footer-nav-head">{section}</div>
            <ul className="footer-nav-list">
              {items.map((item) => (
                <li key={item.label}>
                  {item.path ? (
                    <button className="footer-nav-link" onClick={() => navigate(item.path)}>
                      {item.label}
                    </button>
                  ) : (
                    <a className="footer-nav-link" href={item.href}>
                      {item.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="site-footer-bottom">
        <div className="container">
          <span className="footer-copy">
            © {new Date().getFullYear()} ScrapeLite. All rights reserved.
          </span>
          <span className="footer-copy-right">
            Built with ♥ for data-driven teams
          </span>
        </div>
      </div>
    </footer>
  );
}
