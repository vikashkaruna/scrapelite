// Footer.jsx — simplified footer: socials + legal only.
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

const LEGAL_LINKS = [
  { label: "Privacy", path: "/privacy", icon: "shield" },
  { label: "Terms",   path: "/terms",   icon: "file" },
  // Deep-links to the cookie controls on the Privacy page. Both GDPR and the
  // DPDP Act require withdrawing consent to be as easy as giving it, which
  // means a persistent, site-wide route back to the choice — not a one-time
  // banner the visitor can never summon again.
  // A stable, named anchor — NOT #section-N. Those ids come from the SECTIONS
  // array index in Privacy.jsx and shift if a section is ever inserted.
  { label: "Cookie preferences", path: "/privacy#cookie-preferences", icon: "shield" },
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

        {/* Copyright centre + version tag */}
        <span className="footer-copy">
          © {new Date().getFullYear()} DatIQ · The Unified Web Intelligence Platform · Intelligence from Web
          <a
            className="footer-version-tag"
            href="/changelog"
            onClick={(e) => { e.preventDefault(); navigate("/changelog"); }}
            aria-label="DatIQ V1.0 — what's new"
            title="See what's in DatIQ V1.0"
          >
            V1.0
          </a>
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
