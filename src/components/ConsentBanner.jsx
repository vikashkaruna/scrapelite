// src/components/ConsentBanner.jsx — analytics consent for the React app.
//
// Floats above the bottom of the viewport rather than sitting in the in-flow
// banner stack (UsageUpsellBanner / ReferralBanner / GuestTrialBanner) — those
// are advisories that push page content down; this is a permission prompt
// that shouldn't be the first thing a visitor sees or reflow the page they
// came to read. It still reuses the same `.uub-*` inner chrome (icon/title/
// desc/button layout) so it reads as one design language, but owns its own
// wrap class (`.consent-banner-wrap`) instead of `.usage-upsell-banner-wrap`
// so it never inherits that class's warning-amber tint again.
//
// Three deliberate departures from the neighbouring banners:
//
//  1. NO DISMISS BUTTON. The other banners are advisories you can wave away.
//     This one asks a question that has only two valid answers, and closing it
//     without answering must not be recorded as either. Consent that can be
//     obtained by ignoring a dialog is not consent.
//
//  2. NO MONTHLY RE-PROMPT. The others store a `YYYY-MM` dismissal so they
//     return next month. A recorded choice here is durable until the visitor
//     changes it from the Privacy page or the footer's "Cookie preferences"
//     link (Footer.jsx → /privacy#cookie-preferences → clearConsent()).
//
//  3. AUTO-HIDES, BUT NEVER DECIDES. If the visitor takes no action within
//     AUTO_HIDE_MS it fades out on its own — the goal is to engage, not
//     distract, and a prompt that lingers forever is a worse experience than
//     one that gets out of the way. Hiding is purely visual: it must never
//     call setConsent(), or an ignored prompt would silently become "denied"
//     forever with no way for the visitor to notice or revisit it. The
//     footer's "Cookie preferences" link is what lets them come back to it.
//
// Not rendered on /admin: Shell returns a separate admin <Routes> before this
// point, so the exclusion is structural rather than a path check here.
//
// The static-owned pages (/faq, /dmca, /vs/* detail pages, /help/*) have no
// React at all — public/analytics.js renders an equivalent bar there.

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import Icon from "./Icon.jsx";
import { hasChosen, setConsent, GRANTED, DENIED } from "../lib/consentService.js";

const AUTO_HIDE_MS = 20_000;

export default function ConsentBanner() {
  // Read once on mount. analytics.js has already applied any stored choice to
  // Consent Mode by the time React boots, so there is nothing to re-sync here.
  const [chosen, setChosen] = useState(() => hasChosen());
  const [autoHidden, setAutoHidden] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (chosen) return undefined;
    timerRef.current = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(timerRef.current);
  }, [chosen]);

  // Being `position: fixed` at the viewport bottom means this banner sits
  // directly over the footer's own Privacy/Terms/Cookie-preferences links
  // whenever the page is scrolled all the way down — a real click-blocking
  // bug, not just a layout nit (it's what made the footer e2e spec time out
  // trying to click "Terms"). Toggling this class lets Footer.jsx reserve
  // matching bottom space only while the banner is actually visible, instead
  // of always padding the page (which would waste space for returning
  // visitors who already chose) or reflowing content the moment the app
  // boots (the whole reason this banner is `fixed` rather than in-flow).
  const path = typeof window !== "undefined" && window.location ? window.location.pathname || "" : "";
  const isAdmin = path === "/admin" || path.indexOf("/admin/") === 0;
  const visible = !chosen && !autoHidden && !isAdmin;
  useEffect(() => {
    document.body.classList.toggle("has-consent-banner", visible);
    return () => document.body.classList.remove("has-consent-banner");
  }, [visible]);

  if (!visible) return null;

  const choose = (choice) => {
    clearTimeout(timerRef.current);
    setConsent(choice, "banner");
    setChosen(true);
  };

  return (
    <div className="consent-banner-wrap">
      <div
        className="usage-upsell-banner consent-banner"
        role="region"
        aria-label="Cookie and analytics consent"
      >
        <div className="uub-icon">
          <Icon name="shield" size={16} />
        </div>
        <div className="uub-content">
          <span className="uub-title">Help us improve DatIQ?</span>
          <span className="uub-desc">
            We use Google Analytics to understand which features people actually use.
            Nothing is stored on your device until you allow it, and we never sell your
            data. <Link to="/privacy">Read the Privacy Policy</Link>.
          </span>
        </div>
        <button
          className="uub-upgrade-btn"
          onClick={() => choose(GRANTED)}
        >
          Allow analytics
        </button>
        <button
          className="consent-decline-btn"
          onClick={() => choose(DENIED)}
        >
          Decline analytics
        </button>
      </div>
    </div>
  );
}
