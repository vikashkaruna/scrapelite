// OffersBanner.jsx — compact "active offer" strip for Home/Pricing, built on
// the same .global-discount-banner chrome Pricing.jsx already uses for its
// own sale/coupon banners (see screens.css) so this reads as one design
// language rather than a second banner style.
import { Link } from "react-router";
import { getHeadlineOffer } from "../lib/offersService.js";
import Icon from "./Icon.jsx";

export default function OffersBanner({ variant = "compact" }) {
  const offer = getHeadlineOffer();
  if (!offer) return null;

  const icon = offer.kind === "coupon" ? "tag" : "gift";

  return (
    <Link
      to="/pricing"
      className={`global-discount-banner offers-banner offers-banner-${variant}`}
    >
      <Icon name={icon} size={16} />
      {offer.kind === "sale" && (
        <>
          <strong>{offer.percent}% off</strong>
          {offer.label ? ` — ${offer.label}` : ""}
        </>
      )}
      {offer.kind === "coupon" && (
        <>
          <strong>{offer.percent}% off</strong> with code <code>{offer.code}</code>
        </>
      )}
      {offer.kind === "bonus" && (
        <>
          <strong>+{offer.amount} bonus credits</strong> with code <code>{offer.code}</code>
        </>
      )}
      {offer.expiresAt && (
        <span className="discount-expiry"> · Ends {new Date(offer.expiresAt).toLocaleDateString()}</span>
      )}
    </Link>
  );
}
