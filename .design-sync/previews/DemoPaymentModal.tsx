import { createPortal } from "react-dom";
import { DemoPaymentModal } from "datiq";

// DemoPaymentModal renders its own `position: fixed` backdrop inline (no
// portal). The preview harness's single-story wrapper (#r0.ds-single) turns
// out to establish a new containing block for fixed-position descendants
// (a `transform`/`contain` ancestor does this per spec), which traps the
// full-viewport overlay inside that small wrapper box instead of the real
// viewport. Portaling the story's render to document.body sidesteps the
// harness artifact — this mirrors how sibling modals in this codebase
// (PlanChangeWarning.jsx, InvoiceModal.jsx) already render via
// createPortal(..., document.body) for the same reason.
const portal = (node: React.ReactNode) => createPortal(node, document.body);

const RATES = { USD: 1, INR: 83.5 };

const PRO_PLAN = {
  id: "pro",
  name: "Pro",
  price_usd: 20.4,
  price_usd_annual: 17,
  price_inr: 1799,
  price_inr_annual: 1499,
  tagline: "For power users & consultants",
};

const BUSINESS_PLAN = {
  id: "business",
  name: "Business",
  price_usd: 44.4,
  price_usd_annual: 37,
  price_inr: 4199,
  price_inr_annual: 3499,
  tagline: "For teams and growing agencies",
};

const AGENCY_PLAN = {
  id: "agency",
  name: "Agency",
  price_usd: 106.8,
  price_usd_annual: 89,
  price_inr: 10199,
  price_inr_annual: 8499,
  tagline: "Unlimited scale, your brand",
};

const SELECT_PLAN = {
  id: "select",
  name: "Select",
  price_usd: 14.4,
  price_usd_annual: 12,
  price_inr: 1199,
  price_inr_annual: 999,
  tagline: "For individuals & freelancers",
};

export function Default() {
  return portal(
    <DemoPaymentModal
      plan={PRO_PLAN}
      billingPeriod="annual"
      currency="USD"
      rates={RATES}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function MonthlyBusinessPlan() {
  return portal(
    <DemoPaymentModal
      plan={BUSINESS_PLAN}
      billingPeriod="monthly"
      currency="USD"
      rates={RATES}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function AnnualAgencyINR() {
  return portal(
    <DemoPaymentModal
      plan={AGENCY_PLAN}
      billingPeriod="annual"
      currency="INR"
      rates={RATES}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}

export function MonthlySelectINR() {
  return portal(
    <DemoPaymentModal
      plan={SELECT_PLAN}
      billingPeriod="monthly"
      currency="INR"
      rates={RATES}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );
}
