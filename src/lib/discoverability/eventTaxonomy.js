// eventTaxonomy.js — Frozen 24 normalized event names, categories, segmentation axes, and mappers (Stage 3 / P3B).
//
// PURE. Imported by React components and Netlify functions.
//
// ── THE 24 NORMALIZED EVENT NAMES (LOCKED — §5 / §11.8) ─────────────────────
// Count is exactly 24. A source event maps onto one of them or is rejected;
// an unmapped event is NAMED, never silently dropped.

export const NORMALIZED_EVENTS = Object.freeze([
  "page_view",
  "scroll_25",
  "scroll_50",
  "scroll_75",
  "scroll_90",
  "primary_cta_view",
  "primary_cta_click",
  "secondary_cta_click",
  "pricing_view",
  "form_view",
  "form_start",
  "form_field_error",
  "form_abandon",
  "form_submit",
  "booking_start",
  "booking_complete",
  "add_to_cart",
  "checkout_start",
  "purchase_complete",
  "chat_start",
  "phone_click",
  "whatsapp_click",
  "conversion_complete",
  "qualified_conversion",
]);

export const NORMALIZED_EVENT_SET = Object.freeze(new Set(NORMALIZED_EVENTS));

export const EVENT_CATEGORIES = Object.freeze({
  discovery: Object.freeze([
    "page_view",
    "primary_cta_view",
    "pricing_view",
    "form_view",
  ]),
  engagement: Object.freeze([
    "scroll_25",
    "scroll_50",
    "scroll_75",
    "scroll_90",
    "secondary_cta_click",
    "chat_start",
    "phone_click",
    "whatsapp_click",
  ]),
  friction: Object.freeze([
    "form_field_error",
    "form_abandon",
  ]),
  conversion: Object.freeze([
    "primary_cta_click",
    "form_start",
    "form_submit",
    "booking_start",
    "booking_complete",
    "add_to_cart",
    "checkout_start",
    "purchase_complete",
    "conversion_complete",
    "qualified_conversion",
  ]),
});

export const EVENT_TO_CATEGORY = Object.freeze(
  Object.entries(EVENT_CATEGORIES).reduce((acc, [category, events]) => {
    for (const e of events) acc[e] = category;
    return acc;
  }, {})
);

// ── THE 7 SEGMENTATION AXES (§5 / §11.8) ──────────────────────────────────
// 1. landing page
// 2. source/channel
// 3. device
// 4. region
// 5. time
// 6. new/returning
// 7. conversion goal
export const SEGMENTATION_AXES = Object.freeze([
  "landing_page",
  "source_channel",
  "device",
  "region",
  "time",
  "visitor_type",
  "conversion_goal",
]);

// ── PROVIDER MAPPINGS ──────────────────────────────────────────────────────

const GA4_EVENT_MAP = Object.freeze({
  page_view: "page_view",
  scroll: (props = {}) => {
    const depth = Number(props.percent_scrolled || props.depth || 0);
    if (depth >= 90) return "scroll_90";
    if (depth >= 75) return "scroll_75";
    if (depth >= 50) return "scroll_50";
    if (depth >= 25) return "scroll_25";
    return null;
  },
  click: (props = {}) => {
    if (props.is_primary || props.button_type === "primary" || props.cta_type === "primary") {
      return "primary_cta_click";
    }
    return "secondary_cta_click";
  },
  view_item: "pricing_view",
  view_promotion: "primary_cta_view",
  select_promotion: "primary_cta_click",
  form_start: "form_start",
  form_submit: "form_submit",
  add_to_cart: "add_to_cart",
  begin_checkout: "checkout_start",
  purchase: "purchase_complete",
  generate_lead: "conversion_complete",
});

const POSTHOG_EVENT_MAP = Object.freeze({
  $pageview: "page_view",
  $autocapture: (props = {}) => {
    if (props.event_type === "submit" || props.tag_name === "form") return "form_submit";
    if (props.is_primary) return "primary_cta_click";
    return "secondary_cta_click";
  },
  cta_click: (props = {}) => (props.is_primary ? "primary_cta_click" : "secondary_cta_click"),
  form_started: "form_start",
  form_submitted: "form_submit",
  checkout_started: "checkout_start",
  order_completed: "purchase_complete",
  lead_qualified: "qualified_conversion",
});

const PLAUSIBLE_EVENT_MAP = Object.freeze({
  pageview: "page_view",
  "Signup Form Submit": "form_submit",
  "Purchase Complete": "purchase_complete",
  "Demo Booked": "booking_complete",
  "CTA Click": "primary_cta_click",
});

/**
 * Validates if an event name is one of the 24 normalized names.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidNormalizedEvent(name) {
  return typeof name === "string" && NORMALIZED_EVENT_SET.has(name);
}

/**
 * Maps an incoming event from a known provider or custom source into
 * one of the 24 normalized event names.
 *
 * ⚠️ An unmapped event is named and returned with valid: false, never silently dropped.
 *
 * @param {string} provider - 'ga4' | 'posthog' | 'plausible' | 'custom'
 * @param {string} sourceEvent - Raw event name from the source
 * @param {object} [properties={}] - Event properties for conditional mappings
 * @returns {object} { valid: boolean, normalized_event: string|null, category: string|null, unmapped_name?: string, reason?: string }
 */
export function mapSourceEvent(provider = "custom", sourceEvent = "", properties = {}) {
  const cleanName = String(sourceEvent || "").trim();
  if (!cleanName) {
    return {
      valid: false,
      normalized_event: null,
      category: null,
      unmapped_name: cleanName,
      reason: "Empty or missing event name",
    };
  }

  // If the source event is already a valid normalized event, accept it directly
  if (NORMALIZED_EVENT_SET.has(cleanName)) {
    return {
      valid: true,
      normalized_event: cleanName,
      category: EVENT_TO_CATEGORY[cleanName],
      source_event: cleanName,
      provider,
    };
  }

  const prov = String(provider).toLowerCase();
  let mapped = null;

  if (prov === "ga4") {
    const handler = GA4_EVENT_MAP[cleanName];
    if (typeof handler === "function") {
      mapped = handler(properties);
    } else if (typeof handler === "string") {
      mapped = handler;
    }
  } else if (prov === "posthog") {
    const handler = POSTHOG_EVENT_MAP[cleanName];
    if (typeof handler === "function") {
      mapped = handler(properties);
    } else if (typeof handler === "string") {
      mapped = handler;
    }
  } else if (prov === "plausible") {
    const handler = PLAUSIBLE_EVENT_MAP[cleanName];
    if (typeof handler === "string") {
      mapped = handler;
    }
  }

  if (mapped && NORMALIZED_EVENT_SET.has(mapped)) {
    return {
      valid: true,
      normalized_event: mapped,
      category: EVENT_TO_CATEGORY[mapped],
      source_event: cleanName,
      provider,
    };
  }

  // Not mapped: return explicit naming rather than silently dropping
  return {
    valid: false,
    normalized_event: null,
    category: null,
    unmapped_name: cleanName,
    provider,
    reason: `Unrecognized source event '${cleanName}' for provider '${provider}'. Must map to one of the 24 normalized events.`,
  };
}
