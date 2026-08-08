import { useEffect, useRef } from "react";
import { RecentExtractions } from "datiq";

// RecentExtractions has no props — it reads "datiq.saved" from localStorage
// (the same key the real Dashboard uses) and filters to the current owner:
// signed-in user id, or — when there's no session, as here — a per-browser
// "datiq.sessionId" (see getSessionId() in src/lib/usageRepo.js). Seed both
// at module scope, before the component ever mounts, so the widget shows
// real, deterministic saved-extraction cards instead of its empty state.
const SESSION_ID = "sess_ds_preview_2f9a1c";

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

const SAVED_EXTRACTIONS = [
  {
    id: "ext_stripe_pricing",
    url: "https://stripe.com/pricing",
    page_title: "Pricing – Stripe",
    created_at: minutesAgo(18),
    session_id: SESSION_ID,
  },
  {
    id: "ext_linear_customers",
    url: "https://linear.app/customers",
    page_title: "Customer stories – Linear",
    created_at: hoursAgo(3),
    session_id: SESSION_ID,
  },
  {
    id: "ext_vercel_blog",
    url: "https://vercel.com/blog/framework-defined-infrastructure",
    page_title: "Framework-Defined Infrastructure – Vercel",
    created_at: hoursAgo(26),
    session_id: SESSION_ID,
  },
  {
    id: "ext_notion_ai",
    url: "https://notion.so/product/ai",
    page_title: "Notion AI",
    created_at: daysAgo(4),
    session_id: SESSION_ID,
  },
];

try {
  localStorage.setItem("datiq.sessionId", SESSION_ID);
  localStorage.setItem("datiq.saved", JSON.stringify(SAVED_EXTRACTIONS));
} catch {
  /* no-op outside a browser */
}

export function WithSavedExtractions() {
  return <RecentExtractions />;
}

// Drives the widget's own "Filter…" input (rendered once it has >1 item) to
// a query that matches nothing, exercising the "No recent extractions match"
// mini empty-state — scoped to this story's own wrapper so it doesn't touch
// the WithSavedExtractions cell's input when both render in the same grid.
function FilteredNoMatchHarness() {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const input = wrapRef.current?.querySelector<HTMLInputElement>(
        'input[aria-label="Filter recent extractions"]',
      );
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "quarterly-report-xyz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <div ref={wrapRef}>
      <RecentExtractions />
    </div>
  );
}

export function FilteredNoMatch() {
  return <FilteredNoMatchHarness />;
}
