// TrustStrip.jsx — F14 (in-product trust messaging) UI.
//
// Three short trust pills rendered under the Home composer (or above the
// credit estimator). Each pill links to /privacy for the full policy text.
// Icons are lucide-react via the Icon wrapper; pill text is plain.
//
// Why this lives on Home: the council noted that "Data deleted after Xd, no
// training on your data" is table stakes for Agency/API deals, and it has
// to live in the conversion-critical spot — under the input box, not buried
// in /privacy.

import { Link } from "react-router";
import Icon from "./Icon.jsx";

const PILLS = [
  {
    key: "encrypted",
    icon: "shield-check",
    title: "Encrypted in transit",
    body: "HTTPS-only — your URLs and content are never sent in clear text.",
  },
  {
    key: "retention",
    icon: "trash",
    title: "Auto-deleted in 30 days",
    body: "Free plan extractions expire automatically. Agency tier keeps them forever.",
  },
  {
    key: "no-train",
    icon: "ban",
    title: "Never used to train AI",
    body: "Your data stays yours. We never feed extracted content to model training.",
  },
];

export default function TrustStrip({ compact = false }) {
  return (
    <div className={"trust-strip rise" + (compact ? " trust-strip-compact" : "")}
         style={{ animationDelay: ".22s" }}
         aria-label="Data privacy guarantees">
      {PILLS.map((p) => (
        <Link
          key={p.key}
          to="/privacy"
          className="trust-pill"
          title={p.body}
          aria-label={`${p.title} — ${p.body}. Read our privacy policy.`}
        >
          <span className="trust-pill-icon" aria-hidden="true">
            <Icon name={p.icon} size={13} />
          </span>
          <span className="trust-pill-text">{p.title}</span>
        </Link>
      ))}
    </div>
  );
}
