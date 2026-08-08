import { ExtractSimilarCard } from "datiq";

// pickSiblings() scores same-domain links: shallow paths score higher,
// high-intent paths (pricing/features/product/about/team/docs/blog/
// customers/contact) get +4, meaningful anchor text gets +1, and "/" is
// penalized. Off-domain links and the page itself are always excluded.
// This link set puts "Customer stories", "Docs" and "Pricing" at the top
// (all score 10, tiebroken alphabetically by path), with "Changelog" and
// "Home" scoring lower and dropping off the top-3.

const LINEAR_FEATURES = {
  url: "https://linear.app/features",
  links: [
    { href: "https://linear.app/pricing", text: "Pricing" },
    { href: "https://linear.app/customers", text: "Customer stories" },
    { href: "https://linear.app/docs", text: "Docs" },
    { href: "https://linear.app/changelog", text: "Changelog" },
    { href: "https://linear.app/", text: "Home" },
    { href: "https://twitter.com/linear", text: "Twitter" },
    { href: "https://linear.app/features", text: "Features (self)" },
  ],
};

export function MarketingSitePage() {
  return <ExtractSimilarCard extraction={LINEAR_FEATURES} />;
}

const NOTION_PRODUCT = {
  url: "https://notion.so/product/notion-ai",
  links: [
    { href: "https://notion.so/product", text: "Product overview" },
    { href: "https://notion.so/about", text: "About Notion" },
    { href: "https://notion.so/contact-sales", text: "Contact sales" },
    { href: "https://notion.so/templates", text: "Templates" },
    { href: "https://notion.so/", text: "Home" },
    { href: "https://twitter.com/notionhq", text: "Twitter" },
  ],
};

export function ProductPage() {
  return <ExtractSimilarCard extraction={NOTION_PRODUCT} />;
}
