// extractionPresets.js — shared prompts for the V2 Custom Extraction, Contacts,
// and "Quick Action" enrichment features. Centralized so the Home form, the
// Preview quick-actions, and firecrawlService all speak the same language.

// Used by the "Contacts & Emails" toggle on Home and the leadership quick action.
export const CONTACTS_PROMPT =
  "Extract the full names, job titles, and email addresses of the company's " +
  "senior leadership and board members (e.g. CEO, CFO, CTO, founders, executives, " +
  "directors). Also capture any general contact emails. Return them as a list of contacts.";

// One-click enrichment presets (PRD 4.2). Each populates the Custom Extraction
// field / re-runs the extraction with a focused B2B prompt.
export const QUICK_ACTIONS = [
  {
    key: "contacts",
    label: "Find Contact Info",
    icon: "mail",
    prompt:
      "Extract the names, job titles, email addresses, and phone numbers of key " +
      "contacts, leadership, and the general company contact details.",
  },
  {
    key: "leadership",
    label: "Leadership & Board",
    icon: "users",
    prompt: CONTACTS_PROMPT,
  },
  {
    key: "social",
    label: "Social Links",
    icon: "share",
    prompt:
      "Extract all social media profile URLs for this company " +
      "(LinkedIn, Twitter/X, Facebook, Instagram, YouTube, GitHub).",
  },
  {
    key: "mission",
    label: "Company Mission",
    icon: "sparkles",
    prompt:
      "Extract the company's mission statement, value proposition, and a concise " +
      "description of what the company does.",
  },
  {
    key: "pricing",
    label: "Pricing & Plans",
    icon: "hash",
    prompt:
      "Extract every pricing tier: the plan name, price, billing period, and the " +
      "key features included in each plan.",
  },
];

// Lookup a quick action by its capability key.
export const QUICK_ACTION_BY_KEY = Object.fromEntries(QUICK_ACTIONS.map((a) => [a.key, a]));

// Same-domain subpage keywords worth checking when a capability's data isn't
// on the URL the user actually gave us. "Extract pricing" run against a
// homepage routinely finds nothing — the plans live on /pricing, not /ā€” so
// the server (netlify/functions/extract.js) uses this to pick 1-2 of the
// page's OWN links to also scan before reporting "no data returned". Order
// matters: more specific terms first, since the first match wins per link.
// Shared between client (label lookups) and server (scanning) — see the
// "RELATED_PAGE_HINTS" note in extract.js's header comment.
export const RELATED_PAGE_HINTS = {
  pricing:    ["pricing", "plans", "price"],
  contacts:   ["contact", "support"],
  leadership: ["team", "leadership", "about", "management", "board", "company"],
  mission:    ["about", "mission", "company", "who-we-are", "story"],
  social:     [], // social links are almost always in the header/footer of every page
  custom:     [], // free-text prompts have no reliable subpage signal to key off
};

// Best-effort guess at which RELATED_PAGE_HINTS bucket a free-text prompt
// belongs to, for callers that only have prompt text (no capability key) —
// e.g. a custom prompt typed on Home that happens to ask about pricing.
export function guessRelatedPageHintsKey(prompt) {
  const p = (prompt || "").toLowerCase();
  if (/pric|plan|tier|cost/.test(p)) return "pricing";
  if (/contact|email|phone/.test(p)) return "contacts";
  if (/leader|board|executive|founder|ceo|cfo|cto|management/.test(p)) return "leadership";
  if (/mission|about|value proposition|what.*compan/.test(p)) return "mission";
  return null;
}

// Metadata (key/label/icon) for any enrichment capability key, falling back to a
// generic "Custom extraction" descriptor for free-text prompts run from Home.
export function enrichMeta(key) {
  return (
    QUICK_ACTION_BY_KEY[key] || { key: key || "custom", label: "Custom extraction", icon: "code" }
  );
}

// Combine the optional contacts toggle with any free-text prompt the user typed.
export function resolveCustomPrompt({ customMode, customPrompt, contactsMode }) {
  const typed = customMode && customPrompt ? customPrompt.trim() : "";
  if (contactsMode && typed) return `${CONTACTS_PROMPT}\n\nAlso: ${typed}`;
  if (contactsMode) return CONTACTS_PROMPT;
  return typed || "";
}

// Map an intent and/or prompt → the enrichment-tab metadata so a custom/contacts/pricing run
// from Home/composer persists as a named tab on the Preview screen.
export function enrichMetaForIntent(intent, customPrompt = "") {
  const prompt = (customPrompt || "").trim();
  if (prompt) {
    const matched = QUICK_ACTIONS.find(
      (a) => a.prompt.trim() === prompt || a.label.toLowerCase() === prompt.toLowerCase()
    );
    if (matched) return matched;
  }
  if (intent === "contacts") return enrichMeta("contacts");
  if (intent === "pricing")  return enrichMeta("pricing");
  if (intent === "custom" && prompt) return enrichMeta("custom");
  if (intent === "custom")   return enrichMeta("custom");
  return null;
}

