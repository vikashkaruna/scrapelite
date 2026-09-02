// extractionSchemas.js — the SHAPE each enrichment capability must return.
//
// PURE. Shared by the server (netlify/functions/extract.js drives the model
// with these) and the client (Preview renders grouped fields from them), so
// what the model is asked for and what the UI knows how to draw cannot drift.
//
// ── WHY SCHEMAS AT ALL ───────────────────────────────────────────────────────
// Enrichment used to be: put the user's sentence in a prompt, say "return
// JSON", then run the reply through a loose parser that tried fences, then
// brace-matching, then key:value lines. Every step of that is a guess, and
// when the guess failed the user was told "the AI read this page but found
// nothing" — a sentence about THEIR page that was actually about our parser.
//
// A schema fixes three things at once:
//   1. The provider enforces the shape natively (Gemini responseSchema,
//      OpenAI json_schema, Anthropic forced tool use) — no parsing guesswork.
//   2. An empty result becomes MEANINGFUL. `{"contacts": []}` is the model
//      saying "I looked and there are none", which is a different and far more
//      trustworthy answer than an unparseable blob.
//   3. The UI can render grouped, labelled sections instead of dumping a bag
//      of unknown keys.
//
// ── THE EVIDENCE RULE ────────────────────────────────────────────────────────
// Every schema carries `evidence[]` — verbatim quotes from the page, tied to
// the field they support. This is not decoration: these extractions get pasted
// into CRMs and pitch decks, and a name with no quote behind it is a claim
// nobody can check. It also feeds provenanceService, which already distinguishes
// "observed" from "inferred" from "ai_generated" but had nothing to populate it.
//
// ── NULL, NEVER GUESS ────────────────────────────────────────────────────────
// Each instruction says so explicitly. A hallucinated founder name is worse
// than a blank field, because a blank field gets filled in and a wrong one
// gets forwarded — the same reasoning the discoverability constructs use for
// emitting `TODO:` instead of inventing an Organization block.

const EVIDENCE = {
  type: "array",
  description:
    "Verbatim supporting quotes from the page. One entry per non-null fact you returned. " +
    "Never paraphrase — quote the page exactly.",
  items: {
    type: "object",
    properties: {
      field: { type: "string", description: "Which returned field this supports, e.g. 'contacts[0].email'." },
      quote: { type: "string", description: "The exact text from the page, at most 240 characters." },
      source_url: { type: "string", description: "The URL this quote came from." },
    },
    required: ["field", "quote"],
  },
};

const NULL_RULE =
  "Return null (or an empty array) for anything the page does not state. " +
  "Never infer, never guess, never fill a field from general knowledge about the company. " +
  "Include an evidence quote for every non-null fact.";

/**
 * Capability schemas. `key` matches QUICK_ACTIONS / RELATED_PAGE_HINTS.
 * `groups` drives the UI's section rendering; `instruction` is the extraction
 * directive that replaces the old one-line prompt.
 */
export const CAPABILITY_SCHEMAS = {
  contacts: {
    label: "Contact information",
    instruction:
      "Extract every way a person could contact this organisation, and every named person listed with " +
      "contact details. Include role/department for generic inboxes (sales@, support@) so the reader " +
      "knows which to use. " + NULL_RULE,
    groups: [
      { key: "people", label: "Named contacts" },
      { key: "general", label: "General contact" },
      { key: "offices", label: "Locations" },
    ],
    schema: {
      type: "object",
      properties: {
        people: {
          type: "array", description: "Named individuals with any contact detail on the page.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              title: { type: ["string", "null"] },
              email: { type: ["string", "null"] },
              phone: { type: ["string", "null"] },
              linkedin_url: { type: ["string", "null"] },
            },
            required: ["name"],
          },
        },
        general: {
          type: "object",
          properties: {
            emails: { type: "array", items: { type: "object", properties: {
              address: { type: "string" }, purpose: { type: ["string", "null"], description: "e.g. sales, support, press" },
            }, required: ["address"] } },
            phones: { type: "array", items: { type: "string" } },
            contact_form_url: { type: ["string", "null"] },
            support_url: { type: ["string", "null"] },
          },
        },
        offices: {
          type: "array",
          items: { type: "object", properties: {
            label: { type: ["string", "null"], description: "e.g. HQ, London office" },
            address: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            country: { type: ["string", "null"] },
          } },
        },
        evidence: EVIDENCE,
      },
    },
  },

  leadership: {
    label: "Leadership & board",
    instruction:
      "Extract the organisation's leadership and board. For each person capture their full name, exact " +
      "title as written, and any bio detail, email or LinkedIn URL shown. Separate executives from board " +
      "members and advisors when the page distinguishes them. " + NULL_RULE,
    groups: [
      { key: "executives", label: "Leadership team" },
      { key: "board", label: "Board" },
      { key: "advisors", label: "Advisors" },
    ],
    schema: {
      type: "object",
      properties: {
        executives: { type: "array", items: { type: "object", properties: {
          name: { type: "string" }, title: { type: ["string", "null"] },
          bio: { type: ["string", "null"], description: "One sentence, from the page only." },
          email: { type: ["string", "null"] }, linkedin_url: { type: ["string", "null"] },
          is_founder: { type: ["boolean", "null"] },
        }, required: ["name"] } },
        board: { type: "array", items: { type: "object", properties: {
          name: { type: "string" }, title: { type: ["string", "null"] },
          affiliation: { type: ["string", "null"], description: "Their other company/fund, if stated." },
          linkedin_url: { type: ["string", "null"] },
        }, required: ["name"] } },
        advisors: { type: "array", items: { type: "object", properties: {
          name: { type: "string" }, title: { type: ["string", "null"] }, affiliation: { type: ["string", "null"] },
        }, required: ["name"] } },
        evidence: EVIDENCE,
      },
    },
  },

  social: {
    label: "Social & external profiles",
    instruction:
      "Extract every official social, community and developer profile URL for this organisation. " +
      "Use the absolute URL exactly as linked. Ignore share/intent links (e.g. a 'tweet this' button) " +
      "and links to other companies. " + NULL_RULE,
    groups: [{ key: "profiles", label: "Profiles" }],
    schema: {
      type: "object",
      properties: {
        profiles: { type: "array", items: { type: "object", properties: {
          platform: { type: "string", description: "linkedin, x, facebook, instagram, youtube, github, discord, slack, tiktok, other" },
          url: { type: "string" },
          handle: { type: ["string", "null"] },
        }, required: ["platform", "url"] } },
        evidence: EVIDENCE,
      },
    },
  },

  mission: {
    label: "Mission & positioning",
    instruction:
      "Extract how this organisation describes itself: its mission or purpose statement, its one-line " +
      "value proposition, who it says it serves, the problem it claims to solve, and its stated values. " +
      "Quote the mission verbatim if the page states one. " + NULL_RULE,
    groups: [
      { key: "positioning", label: "Positioning" },
      { key: "values", label: "Stated values" },
      { key: "proof", label: "Proof points" },
    ],
    schema: {
      type: "object",
      properties: {
        positioning: {
          type: "object",
          properties: {
            mission_statement: { type: ["string", "null"], description: "Verbatim if present." },
            one_liner: { type: ["string", "null"] },
            what_they_do: { type: ["string", "null"], description: "Two sentences maximum, page-supported." },
            target_customer: { type: ["string", "null"] },
            problem_solved: { type: ["string", "null"] },
            category: { type: ["string", "null"], description: "The market category they place themselves in." },
          },
        },
        values: { type: "array", items: { type: "object", properties: {
          name: { type: "string" }, description: { type: ["string", "null"] },
        }, required: ["name"] } },
        proof: {
          type: "object",
          properties: {
            named_customers: { type: "array", items: { type: "string" } },
            metrics: { type: "array", items: { type: "object", properties: {
              claim: { type: "string" }, value: { type: ["string", "null"] },
            }, required: ["claim"] } },
            awards: { type: "array", items: { type: "string" } },
          },
        },
        evidence: EVIDENCE,
      },
    },
  },

  pricing: {
    label: "Pricing & plans",
    instruction:
      "Extract the complete pricing table. For every plan capture its name, price, currency, billing " +
      "period, whether it is free or quote-only, its usage limits, and its listed features. Also capture " +
      "add-ons, discounts (e.g. annual %), free-trial terms, and anything gated behind 'contact sales'. " +
      "Keep feature wording as written. " + NULL_RULE,
    groups: [
      { key: "plans", label: "Plans" },
      { key: "addons", label: "Add-ons" },
      { key: "commercial", label: "Commercial terms" },
    ],
    schema: {
      type: "object",
      properties: {
        plans: { type: "array", items: { type: "object", properties: {
          name: { type: "string" },
          price: { type: ["string", "null"], description: "As displayed, e.g. '$29' or 'Custom'." },
          price_numeric: { type: ["number", "null"] },
          currency: { type: ["string", "null"] },
          billing_period: { type: ["string", "null"], description: "month, year, seat/month, usage, one-time" },
          is_free: { type: ["boolean", "null"] },
          is_quote_only: { type: ["boolean", "null"] },
          tagline: { type: ["string", "null"] },
          best_for: { type: ["string", "null"] },
          limits: { type: "array", items: { type: "object", properties: {
            name: { type: "string" }, value: { type: ["string", "null"] },
          }, required: ["name"] } },
          features: { type: "array", items: { type: "string" } },
          cta: { type: ["string", "null"] },
        }, required: ["name"] } },
        addons: { type: "array", items: { type: "object", properties: {
          name: { type: "string" }, price: { type: ["string", "null"] }, description: { type: ["string", "null"] },
        }, required: ["name"] } },
        commercial: {
          type: "object",
          properties: {
            annual_discount: { type: ["string", "null"] },
            free_trial: { type: ["string", "null"] },
            money_back: { type: ["string", "null"] },
            pricing_model: { type: ["string", "null"], description: "seat-based, usage-based, flat, tiered, freemium" },
            enterprise_available: { type: ["boolean", "null"] },
          },
        },
        evidence: EVIDENCE,
      },
    },
  },
};

/**
 * The fallback schema for a free-text custom prompt. We cannot know the shape
 * the user wants, so we ask for a flat, self-describing record plus the same
 * evidence contract — which is still enormously better than "return JSON",
 * because it forbids prose and forces the model to name what it found.
 */
export const CUSTOM_SCHEMA = {
  type: "object",
  properties: {
    result: {
      type: "object",
      description:
        "The extracted data. Use descriptive snake_case keys that reflect what the user asked for. " +
        "Nest objects and arrays freely. Omit keys the page does not support rather than nulling them out.",
    },
    items: {
      type: "array",
      description:
        "When the page lists MANY instances of the requested thing (products, jobs, articles, rows), " +
        "return them here — one object per instance, all with the same keys — instead of collapsing " +
        "them into a single record in `result`.",
      items: { type: "object" },
    },
    not_found: {
      type: "array",
      description: "Fields the user asked for that this page genuinely does not contain.",
      items: { type: "string" },
    },
    evidence: EVIDENCE,
  },
};

export const CUSTOM_INSTRUCTION_PREFIX =
  "Apply the user's extraction instruction to the page content below.\n\n" +
  "If the page lists many instances of what was asked for, return EVERY instance in `items` — " +
  "a listing page must not collapse into one record. " + NULL_RULE + "\n\n" +
  "USER INSTRUCTION:\n";

/** Capability keys that have a first-class schema (everything else is custom). */
export const SCHEMA_KEYS = Object.keys(CAPABILITY_SCHEMAS);

/** Resolve the schema + instruction for a capability key and optional free-text prompt. */
export function resolveExtractionPlan(enrichKey, customPrompt) {
  const cap = enrichKey ? CAPABILITY_SCHEMAS[enrichKey] : null;
  if (cap) {
    // A user who typed extra wording on top of a capability gets both: the
    // capability's schema (so the UI can still render it) plus their addendum.
    const extra = (customPrompt || "").trim();
    const isPreset = !extra || extra.length < 24;
    return {
      key: enrichKey,
      schema: cap.schema,
      groups: cap.groups,
      label: cap.label,
      instruction: isPreset ? cap.instruction : `${cap.instruction}\n\nAlso honour this specific request: ${extra}`,
      structured: true,
    };
  }
  return {
    key: enrichKey || "custom",
    schema: CUSTOM_SCHEMA,
    groups: null,
    label: "Custom extraction",
    instruction: CUSTOM_INSTRUCTION_PREFIX + (customPrompt || "").trim(),
    structured: false,
  };
}

/**
 * Is a schema-shaped extraction actually empty? A capability result is a
 * container of arrays/objects, so `Object.keys(v).length > 0` is NOT enough —
 * `{contacts:[], general:{}, evidence:[]}` has three keys and zero facts, and
 * treating that as a hit is how a blank tab used to render as a success.
 * `evidence` never counts as content on its own.
 */
export function isSchemaResultEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== "object") return String(value).trim() === "";
  let hasContent = false;
  for (const [k, v] of Object.entries(value)) {
    if (k === "evidence" || k === "not_found") continue;
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) hasContent = true; }
    else if (typeof v === "object") { if (!isSchemaResultEmpty(v)) hasContent = true; }
    else if (String(v).trim() !== "") hasContent = true;
    if (hasContent) return false;
  }
  return true;
}

/** Count the extracted facts in a schema result — drives the "N found" UI chip. */
export function countSchemaFacts(value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.reduce((n, v) => n + (typeof v === "object" ? countSchemaFacts(v) : 1), 0);
  if (typeof value !== "object") return String(value).trim() ? 1 : 0;
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (k === "evidence" || k === "not_found") continue;
    n += countSchemaFacts(v);
  }
  return n;
}
