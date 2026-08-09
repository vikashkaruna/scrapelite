import { EmailModal } from "datiq";

// EmailModal is fully prop-driven (items/hint/onSend/onClose), so — unlike
// the other four modals in this wave — its real variety IS reachable
// without simulating clicks: how many extractions are queued up, and
// whether a plan-hint is attached, both come straight from props.

const singleItem = [
  {
    id: "ext_8f21a3",
    url: "https://lumio.io",
    page_title: "Lumio — Product analytics that actually make sense",
  },
];

const selectedBatch = [
  { id: "ext_8f21a3", url: "https://lumio.io", page_title: "Lumio — Product analytics that actually make sense" },
  { id: "ext_c04e91", url: "https://stripe.com/pricing", page_title: "Pricing & fees | Stripe" },
  { id: "ext_11b7d4", url: "https://www.notion.so", page_title: "Notion – The all-in-one workspace" },
  { id: "ext_4a9f02", url: "https://linear.app", page_title: "Linear – The issue tracking tool you'll enjoy using" },
];

const largeSelection = [
  { id: "ext_8f21a3", url: "https://lumio.io", page_title: "Lumio — Product analytics that actually make sense" },
  { id: "ext_c04e91", url: "https://stripe.com/pricing", page_title: "Pricing & fees | Stripe" },
  { id: "ext_11b7d4", url: "https://www.notion.so", page_title: "Notion – The all-in-one workspace" },
  { id: "ext_4a9f02", url: "https://linear.app", page_title: "Linear – The issue tracking tool you'll enjoy using" },
  { id: "ext_7c3e88", url: "https://vercel.com/pricing", page_title: "Pricing – Vercel" },
  { id: "ext_9d1f56", url: "https://www.figma.com", page_title: "Figma: The Collaborative Interface Design Tool" },
  { id: "ext_2e8a71", url: "https://airtable.com", page_title: "Airtable | Digital operations platform" },
  { id: "ext_5b6c30", url: "https://www.intercom.com/pricing", page_title: "Pricing | Intercom" },
  { id: "ext_0f4d29", url: "https://retool.com", page_title: "Retool — Build internal tools, remarkably fast" },
];

export function SingleExtraction() {
  return (
    <EmailModal
      items={singleItem}
      hint=""
      onSend={async () => {}}
      onClose={() => {}}
    />
  );
}

export function SelectedBatch() {
  return (
    <EmailModal
      items={selectedBatch}
      hint="Bundled as a single CSV attachment."
      onSend={async () => {}}
      onClose={() => {}}
    />
  );
}

export function LargeSelection() {
  return (
    <EmailModal
      items={largeSelection}
      hint="Business plan required for exports over 5 pages."
      onSend={async () => {}}
      onClose={() => {}}
    />
  );
}
