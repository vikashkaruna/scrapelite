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

