import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TopupBundleModal } from "datiq";

// Bundles mirror TOPUP_BUNDLES in src/lib/pricingConfig.js exactly. Upsell
// plans come from getEffectivePlanById() (localStorage-backed) — clear any
// stale admin override left by a previous capture so the static defaults show.
try {
  localStorage.removeItem("datiq.pricingOverrides");
} catch {}

// TopupBundleModal renders its own `position: fixed` backdrop inline (no
// portal). The preview harness's single-story wrapper (#r0.ds-single) sets
// `transform: translateZ(0)`, which — per spec — makes it the containing
// block for position:fixed descendants, trapping the full-viewport overlay
// inside that small wrapper box instead of the real viewport. Portaling the
// story's render to document.body sidesteps that — mirroring how sibling
// modals in this codebase (PlanChangeWarning.jsx, InvoiceModal.jsx) already
// render via createPortal(..., document.body) for the same reason.
//
// `.tbm-card` also sets `max-height: 90vh; overflow-y: auto`. At this
// 900x700 capture viewport that's a 630px cap, and the INR + GST story's
// trailing upsell row sits just past it — present but scrolled out of a
// screenshot taken at scrollTop 0. A layout-effect override raises the cap
// to just under the full viewport height and top-anchors the backdrop (was
// vertically centered) so the header stays pinned at a fixed offset instead
// of shifting per-story, and any residual overflow spills below the fold
// rather than pushing content above y=0.
function FixedFullBleed({ selector, children }: { selector: string; children: React.ReactNode }) {
  useLayoutEffect(() => {
    const card = document.querySelector<HTMLElement>(selector);
    if (card) {
      card.style.maxHeight = "calc(100vh - 24px)";
    }
    const backdrop = card?.parentElement;
    if (backdrop) {
      backdrop.style.alignItems = "flex-start";
      backdrop.style.paddingTop = "16px";
    }
  });
  return createPortal(children, document.body);
}

const EXTRACTIONS_BUNDLE = {
  id: "extractions-bundle",
  name: "Extractions Bundle",
  icon: "zap",
  price_usd: 9,
  price_inr: 749,
  description: "100 extra extractions with all enrichments, CSV + PDF, and email export.",
  unit: "per 100 extractions",
  bonusExtractions: 100,
  stackable: true,
};

const BATCH_PACK = {
  id: "batch-pack",
  name: "Batch Pack",
  icon: "layers",
  price_usd: 9,
  price_inr: 749,
  description: "Unlock batch mode for 50 URLs. Run multi-URL extractions with combined CSV/JSON/Markdown output. Stackable in multiples of 50.",
  unit: "per 50 URLs",
  stackable: true,
  bonusBatchUrls: 50,
};

const SCHEDULER_ADDON = {
  id: "scheduler-addon",
  name: "Scheduled Monitor",
  icon: "clock",
  price_usd: 5,
  price_inr: 399,
  description: "Monitor one URL daily — email alert when content changes are detected.",
  unit: "per URL / month",
  stackable: true,
};

const RATES = { USD: 1, INR: 83.5 };

export function ExtractionsBundleSingleUnit() {
  return (
    <FixedFullBleed selector=".tbm-card">
      <TopupBundleModal
        bundle={EXTRACTIONS_BUNDLE}
        currency="USD"
        rates={RATES}
        currentPlanId="free"
        loading={false}
        onClose={() => {}}
        onPurchase={() => {}}
        onUpgrade={() => {}}
      />
    </FixedFullBleed>
  );
}

export function BatchPackINRWithGST() {
  return (
    <FixedFullBleed selector=".tbm-card">
      <TopupBundleModal
        bundle={BATCH_PACK}
        currency="INR"
        rates={RATES}
        currentPlanId="select"
        loading={false}
        onClose={() => {}}
        onPurchase={() => {}}
        onUpgrade={() => {}}
      />
    </FixedFullBleed>
  );
}

export function SchedulerAddonNoUpsellAgency() {
  return (
    <FixedFullBleed selector=".tbm-card">
      <TopupBundleModal
        bundle={SCHEDULER_ADDON}
        currency="USD"
        rates={RATES}
        currentPlanId="agency"
        loading={false}
        onClose={() => {}}
        onPurchase={() => {}}
        onUpgrade={() => {}}
      />
    </FixedFullBleed>
  );
}

export function ProcessingPurchase() {
  return (
    <FixedFullBleed selector=".tbm-card">
      <TopupBundleModal
        bundle={EXTRACTIONS_BUNDLE}
        currency="USD"
        rates={RATES}
        currentPlanId="pro"
        loading={true}
        onClose={() => {}}
        onPurchase={() => {}}
        onUpgrade={() => {}}
      />
    </FixedFullBleed>
  );
}
