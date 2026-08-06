import { ContentModal } from "datiq";

// ContentModal only ever reads `item.page_title` from the extraction record
// (the rest of the shape — url, ai_summary, headings — is real-looking here
// for context but not touched by this component). The generate/loading/
// output states are only reachable by clicking one of the three format
// buttons, which this mount-only capture harness can't drive, so both
// stories below show the modal's real starting point: the format picker,
// varied by a realistic extraction so the title line isn't identical noise.
const productLandingPage = {
  id: "ext_8f21a3",
  url: "https://lumio.io",
  page_title: "Lumio — Product analytics that actually make sense",
  ai_summary:
    "Lumio is a product-analytics platform aimed at fast-moving teams. The " +
    "landing page leads with a value proposition around real-time dashboards, " +
    "automated reporting, and privacy-first data handling.",
};

const competitorPricingPage = {
  id: "ext_c04e91",
  url: "https://stripe.com/pricing",
  page_title: "Pricing & fees | Stripe",
  ai_summary:
    "Stripe's pricing page breaks fees down by payment method and region, " +
    "with a pay-as-you-go model and no monthly minimums for the standard tier.",
};

export function Default() {
  return <ContentModal item={productLandingPage} onClose={() => {}} />;
}

export function CompetitorPricingPage() {
  return <ContentModal item={competitorPricingPage} onClose={() => {}} />;
}
