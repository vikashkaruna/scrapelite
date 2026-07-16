// src/pages/NotFound.jsx
// 404 page rendered for any route the React Router does not match. The
// previous behaviour was `<Route path="*" element={<Navigate to="/" />} />`
// which silently sent users to the home page; a deep link from a chat
// thread, an email, or a stale share would land somewhere unrelated. This
// page keeps the SPA contract (still 200, no server error) while being
// honest about what happened.

import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";

const QUICK_LINKS = [
  { to: "/", label: "Extract a page", icon: "zap" },
  { to: "/dashboard", label: "Open dashboard", icon: "layout-dashboard" },
  { to: "/batch", label: "Run a batch", icon: "layers-2" },
  { to: "/schedules", label: "Schedules", icon: "calendar-clock" },
  { to: "/pricing", label: "Pricing", icon: "credit-card" },
  { to: "/contact", label: "Contact support", icon: "message-square" },
];

export default function NotFound() {
  return (
    <div className="page notfound-page">
      <div className="container notfound-container">
        <div className="notfound-card card">
          <div className="notfound-eyebrow">404 — Page not found</div>
          <h1 className="notfound-title">We could not find that page</h1>
          <p className="notfound-sub">
            The link may be old, mistyped, or moved. DatIQ is still here —
            pick one of the shortcuts below or jump back to the home screen.
          </p>

          <div className="notfound-actions">
            <Link to="/" className="btn btn-primary">
              <Icon name="home" size={16} />
              Back to DatIQ
            </Link>
            <Link to="/dashboard" className="btn btn-secondary">
              <Icon name="layout-dashboard" size={16} />
              Open dashboard
            </Link>
          </div>

          <div className="notfound-section-label">Popular destinations</div>
          <ul className="notfound-links" aria-label="Popular destinations">
            {QUICK_LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="notfound-link">
                  <Icon name={link.icon} size={16} aria-hidden="true" />
                  <span>{link.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
