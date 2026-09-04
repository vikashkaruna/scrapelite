// src/components/SignedInRequired.jsx
//
// The signed-out state for a workspace that is signed-in only.
//
// Why this exists: /lists, /watchlists and /rules used to render for anyone,
// because their endpoints answered an unauthenticated request with somebody
// else's data. Now that those endpoints refuse (401), a signed-out visitor
// would otherwise see a raw "Authentication required" error thrown by the
// client SDK — a correct decision reported as a fault, which is the exact
// failure shape this codebase has had to fix repeatedly (a robots.txt refusal
// rendered as a crash, a quota refusal rendered as "something went wrong").
//
// One component rather than three copies, so the three pages cannot drift into
// describing the same rule three different ways.

import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { useAuth } from "./AuthProvider.jsx";

/**
 * @param {object}  props
 * @param {string}  props.title    What the visitor came for, e.g. "Competitor watchlists".
 * @param {string}  props.reason   Why an account is needed — the VALUE, not the rule.
 */
export default function SignedInRequired({ title, reason }) {
  const { openAuth } = useAuth();

  return (
    <div className="container" style={{ padding: "40px 20px" }}>
      <div className="empty-state" style={{ maxWidth: 520, margin: "48px auto", textAlign: "center" }}>
        <Icon name="lock" size={32} />
        <h2>{title}</h2>
        {/* State the value, not the restriction: these features are worth an
            account because the work persists and recurs, which is a reason a
            visitor can act on rather than a rule they have run into. */}
        <p style={{ margin: "0 auto 20px" }}>{reason}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => openAuth("signup")}>
            Create a free account
          </Button>
          <Button variant="ghost" onClick={() => openAuth("signin")}>
            Sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
