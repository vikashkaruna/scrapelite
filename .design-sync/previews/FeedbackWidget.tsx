import { FeedbackWidget } from "datiq";

// FeedbackWidget reads its initial rating/comment synchronously from
// localStorage ("datiq.summaryFeedback", a map keyed by extractionId — see
// src/lib/feedbackService.js's getLocalFeedback()) via a lazy useState
// initializer. Seeding that map once, at module scope, before any story
// mounts is how the "already rated" stories below show real persisted
// state instead of the component's own default. Each story uses a distinct
// extractionId so the seeded rows never collide, and two ids are
// deliberately left OUT of the seed so their stories render the pristine
// unrated default.
try {
  localStorage.setItem(
    "datiq.summaryFeedback",
    JSON.stringify({
      ext_9f2k4m: {
        extractionId: "ext_9f2k4m",
        rating: 1,
        comment: "Nailed the pricing tiers and the annual-vs-monthly breakdown.",
        updatedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
      },
      ext_7q1w3e: {
        extractionId: "ext_7q1w3e",
        rating: -1,
        comment: "",
        updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      },
    }),
  );
} catch {
  /* no-op outside a browser */
}

export function Unrated() {
  return (
    <FeedbackWidget
      extractionId="ext_5c8v2n"
      url="https://stripe.com/pricing"
      intent="pricing"
    />
  );
}

export function ThumbsUpWithComment() {
  return (
    <FeedbackWidget
      extractionId="ext_9f2k4m"
      url="https://linear.app/pricing"
      intent="pricing"
    />
  );
}

export function ThumbsDownNoComment() {
  return (
    <FeedbackWidget
      extractionId="ext_7q1w3e"
      url="https://www.ycombinator.com/companies"
      intent="summary"
    />
  );
}

export function Disabled() {
  return (
    <FeedbackWidget
      extractionId="ext_3b6t8y"
      url="https://www.notion.so/product"
      intent="custom"
      disabled
    />
  );
}
