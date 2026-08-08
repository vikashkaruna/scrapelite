import { UrlReviewTable } from "datiq";

export function BatchWithInvalidUrls() {
  return (
    <UrlReviewTable
      urls={[
        "https://acme-widgets.com/about",
        "https://vercel.com/pricing",
        "https://linear.app/customers",
        "https://stripe.com/docs/api",
        "https://notion.so/product",
        "https://airtable.com/enterprise",
      ]}
      invalid={["not a real url", "ftp://old-protocol.example/list"]}
      onRemove={() => {}}
      onClear={() => {}}
    />
  );
}

export function AllValidCompactList() {
  return (
    <UrlReviewTable
      urls={[
        "https://webflow.com/designers",
        "https://webflow.com/templates",
        "https://webflow.com/enterprise",
      ]}
      invalid={[]}
      onRemove={() => {}}
      onClear={() => {}}
    />
  );
}
