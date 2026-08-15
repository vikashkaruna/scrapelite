// src/components/ConsentBanner.jsx — analytics consent for the React app.
//
// Sits in the same banner slot as UsageUpsellBanner / ReferralBanner /
// GuestTrialBanner and reuses their chrome (.usage-upsell-banner-wrap +
// additive modifier classes), the pattern ReferralBanner established, so this
// reads as one design language rather than a fourth banner style.
//
// Two deliberate departures from the neighbouring banners:
//
//  1. NO DISMISS BUTTON. The other banners are advisories you can wave away.
//     This one asks a question that has only two valid answers, and closing it
//     without answering must not be recorded as either. Consent that can be
//     obtained by ignoring a dialog is not consent.
//
//  2. NO MONTHLY RE-PROMPT. The others store a `YYYY-MM` dismissal so they
//     return next month. A recorded choice here is durable until the visitor
//     changes it from the Privacy page or the footer.
//
// Not rendered on /admin: Shell returns a separate admin <Routes> before this
// point, so the exclusion is structural rather than a path check here.
//
// The static-owned pages (/faq, /dmca, /vs/* detail pages, /help/*) have no
// React at all — public/analytics.js renders an equivalent bar there.

import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";
import { hasChosen, setConsent, GRANTED, DENIED } from "../lib/consentService.js";

export default function ConsentBanner() {
  // Read once on mount. analytics.js has already applied any stored choice to
  // Consent Mode by the time React boots, so there is nothing to re-sync here.
  const [chosen, setChosen] = useState(() => hasChosen());

  if (chosen) return null;

  const choose = (choice) => {
    setConsent(choice, "banner");
    setChosen(true);
  };

  return (
    <div className="usage-upsell-banner-wrap consent-banner-wrap">
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
