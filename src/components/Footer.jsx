// Footer.jsx — site footer with brand identity and essential links only.
// Product/app nav is intentionally excluded (already in TopBar).
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

const COMPANY_LINKS = [
  { label: "About", path: "/about" },
  { label: "Blog", path: "/blog" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", path: "/privacy" },
  { label: "Terms of Service", path: "/terms" },
];

const SOCIALS = [
  { name: "linkedin", href: "https://linkedin.com", label: "LinkedIn" },
  { name: "twitter", href: "https://twitter.com", label: "Twitter / X" },
];

export default function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="container site-footer-inner">
        {/* Brand column */}
        <div className="footer-brand-col">
          <div className="footer-socials" aria-label="Social links">
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

        {/* Company links */}
        <div className="footer-nav-col">
          <div className="footer-nav-head" id="footer-company-heading">Company</div>
          <ul className="footer-nav-list" aria-labelledby="footer-company-heading">
            {COMPANY_LINKS.map((item) => (
              <li key={item.label}>
                <button
                  className="footer-nav-link"
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal links */}
        <div className="footer-nav-col">
          <div className="footer-nav-head" id="footer-legal-heading">Legal</div>
          <ul className="footer-nav-list" aria-labelledby="footer-legal-heading">
            {LEGAL_LINKS.map((item) => (
              <li key={item.label}>
                <button
                  className="footer-nav-link"
                  onClick={() => navigate(item.path)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="site-footer-bottom">
        <div className="container">
          <span className="footer-copy">
            © {new Date().getFullYear()} DatIQ · ScrapeLite. All rights reserved.
          </span>
          <span className="footer-copy-right">
            Data + IQ — intelligence from every URL
          </span>
        </div>
      </div>
    </footer>
  );
}
