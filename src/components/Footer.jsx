// Footer.jsx — site footer with nav links and social icons.
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";
import { LINK_ABOUT, LINK_BLOG, LINK_PRICING, LINK_CHANGELOG } from "../lib/config.js";

const LINKS = {
  Product: [
    { label: "Extract", path: "/" },
    { label: "Dashboard", path: "/dashboard" },
    ...(LINK_PRICING   ? [{ label: "Pricing",   href: LINK_PRICING   }] : []),
    ...(LINK_CHANGELOG ? [{ label: "Changelog", href: LINK_CHANGELOG }] : []),
  ],
  Company: [
    ...(LINK_ABOUT ? [{ label: "About", href: LINK_ABOUT }] : []),
    ...(LINK_BLOG  ? [{ label: "Blog",  href: LINK_BLOG  }] : []),
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
          <div className="footer-brand" onClick={() => navigate("/")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/")} role="button" tabIndex={0} aria-label="ScrapeLite home">
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

        {/* Nav columns — skip sections with no items */}
        {Object.entries(LINKS).filter(([, items]) => items.length > 0).map(([section, items]) => (
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
