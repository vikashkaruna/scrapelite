// Footer.jsx — simplified footer: socials + legal only.
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

const LEGAL_LINKS = [
  { label: "Privacy", path: "/privacy", icon: "shield" },
  { label: "Terms",   path: "/terms",   icon: "file" },
  { label: "Contact", path: "/contact", icon: "mail" },
];

const SOCIALS = [
  { name: "linkedin", href: "https://linkedin.com", label: "LinkedIn" },
  { name: "twitter", href: "https://twitter.com", label: "Twitter / X" },
];

export default function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="site-footer" role="contentinfo" aria-label="Site footer">
      <div className="site-footer-slim container">
        {/* Socials */}
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

        {/* Copyright centre */}
        <span className="footer-copy">
          © {new Date().getFullYear()} DatIQ · Data + IQ, intelligence from every URL
        </span>

        {/* Legal */}
        <div className="footer-legal-links">
          {LEGAL_LINKS.map((item, i) => (
            <span key={item.label} className="footer-legal-group">
              {i > 0 && <span className="footer-legal-sep" aria-hidden="true">·</span>}
              <button className="footer-nav-link" onClick={() => navigate(item.path)}>
                <Icon name={item.icon} size={13} />
                {item.label}
              </button>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
