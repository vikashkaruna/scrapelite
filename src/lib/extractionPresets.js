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

// Combine the optional contacts toggle with any free-text prompt the user typed.
export function resolveCustomPrompt({ customMode, customPrompt, contactsMode }) {
  const typed = customMode && customPrompt ? customPrompt.trim() : "";
  if (contactsMode && typed) return `${CONTACTS_PROMPT}\n\nAlso: ${typed}`;
  if (contactsMode) return CONTACTS_PROMPT;
  return typed || "";
}
