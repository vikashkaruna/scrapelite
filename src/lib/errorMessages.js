// errorMessages.js — maps raw JS/network/API errors to friendly UI copy.
// Each category has a test regex, a user-facing title, and a plain-English message.
// Keeps technical jargon out of the UI while preserving the real error for devs.

export const CATEGORIES = [
  // FIRST on purpose. A robots.txt refusal is not a fault — it is DatIQ doing
  // what it says on the tin — and it must never fall through to the generic
  // "Something went wrong. An unexpected error occurred." that every unmatched
  // message lands on. That is exactly what users saw for every LinkedIn URL:
  // the server refused deliberately, and the UI reported a crash.
  {
    test: /robots\.txt disallows|not on the operator-configured permitted-hosts/i,
    title: "This site doesn't allow automated access",
    message:
      "This website's robots.txt asks automated tools to stay away, and DatIQ " +
      "honours that. Nothing went wrong on your side. Sites like LinkedIn, " +
      "Facebook and X block all crawlers this way — try the company's own " +
      "website, or a public page that isn't behind a login.",
  },
  {
    test: /failed to fetch dynamically imported module|dynamically imported/i,
    title: "App update available",
    message:
      "DatIQ was updated since you last loaded this page. " +
      "Please refresh the page and try again.",
  },
  {
    test: /failed to fetch|network error|net::err|load failed|fetch error|networkrequesterror/i,
    title: "Couldn't reach the page",
    message:
      "Your internet connection may be down, or the website isn't responding. " +
      "Check your connection and try again.",
  },
  {
    test: /cors|blocked by.*policy|access.control|cross.origin/i,
    title: "This page blocked the request",
    message:
      "The website is preventing external tools from accessing its content. " +
      "This is common on apps that require a login. Try a different URL.",
  },
  {
    test: /401|unauthorized|authentication required/i,
    title: "Login required",
    message:
      "This page is behind a login or paywall. DatIQ can only extract " +
      "publicly accessible pages — try a public URL instead.",
  },
  {
    test: /403|forbidden/i,
    title: "Access forbidden",
    message:
      "The website is actively blocking automated access. " +
      "Try a different page or a publicly available URL.",
  },
  {
    test: /404|not found/i,
    title: "Page not found",
    message:
      "The URL you entered doesn't seem to exist. " +
      "Double-check for typos and try again.",
  },
  {
    test: /429|too many requests|rate.?limit/i,
    title: "Slow down a moment",
    message:
      "Too many requests in a short time. " +
      "Wait a few seconds and try again.",
  },
  {
    test: /5[0-9]{2}|server error|internal error|bad gateway|service unavailable/i,
    title: "Service temporarily unavailable",
    message:
      "The extraction service hit a snag on its end — this isn't your fault. " +
      "Wait a moment and try again.",
  },
  {
    test: /timeout|timed.?out|request timed/i,
    title: "Request timed out",
    message:
      "The page took too long to respond. It may be slow or temporarily down. " +
      "Try again or use a different URL.",
  },
  {
    test: /invalid url|not a valid url|invalid.*url/i,
    title: "Invalid URL",
    message:
      "That doesn't look like a valid web address. " +
      "Check for typos — it should start with https://",
  },
  {
    test: /supabase|postgre|database|relation.*does not exist|permission denied for table/i,
    title: "Database error",
    message:
      "There was a problem connecting to the database. " +
      "Your data is safe — check the Supabase connection settings and try again.",
  },
];

const DEFAULT = {
  title: "Something went wrong",
  message:
    "An unexpected error occurred. Try again — if the problem continues, " +
    "check the technical details below.",
};

/**
 * Returns { title, message } for a given error, defaulting gracefully.
 *
 * Matches on the message first, then falls back to the structured `code` and
 * `status` that apiClient now carries. The structured pass matters: an HTTP
 * status lives on `err.status`, NOT in the prose, so a 403 whose body was a
 * sentence with no digits in it used to skip the "Access forbidden" category
 * and land on the generic default. Text is what servers happen to say; status
 * and code are what they mean.
 */
export function classifyError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.test.test(msg)) return { title: cat.title, message: cat.message };
  }

  if (isComplianceError(error)) return COMPLIANCE_ERROR;

  const status = Number(error?.status);
  if (Number.isFinite(status) && status >= 400) {
    for (const cat of CATEGORIES) {
      if (cat.test.test(String(status))) return { title: cat.title, message: cat.message };
    }
  }
  return DEFAULT;
}

// ── Compliance refusals ───────────────────────────────────────────────────────
// A refusal is a product decision, not a failure, and the two need different
// affordances: a failure gets "Try again", a refusal must not — retrying a
// policy decision cannot change it, and offering the button teaches people to
// hammer a wall. Callers use this predicate to decide.

/** Codes the server sends for a deliberate compliance refusal. */
export const COMPLIANCE_CODES = new Set(["robots_disallowed", "host_not_permitted"]);

/** True when this error is a deliberate compliance refusal, not a fault. */
export function isComplianceError(error) {
  if (!error) return false;
  if (error.complianceBlocked === true) return true;
  if (COMPLIANCE_CODES.has(error.code)) return true;
  return /robots\.txt disallows|not on the operator-configured permitted-hosts/i
    .test(String(error?.message || ""));
}

/** Friendly copy for a compliance refusal. Mirrors the CATEGORIES entry above
 *  so a caller can apply it directly without re-running the classifier. */
export const COMPLIANCE_ERROR = {
  title: "This site doesn't allow automated access",
  message:
    "This website's robots.txt asks automated tools to stay away, and DatIQ " +
    "honours that. Nothing went wrong on your side. Sites like LinkedIn, " +
    "Facebook and X block all crawlers this way — try the company's own " +
    "website, or a public page that isn't behind a login.",
};

/** Shown to a signed-OUT user, for whom the attestation override is not
 *  available: an anonymous cookie is nobody to attribute a permission claim to. */
export const COMPLIANCE_GUEST_ERROR = {
  title: "This site doesn't allow automated access",
  message:
    "This website's robots.txt asks automated tools to stay away, and DatIQ " +
    "honours that. If you have permission to extract this site — it's your own, " +
    "or you have written consent — sign in and DatIQ can record that and " +
    "continue.",
};

// ── Context-specific overrides ────────────────────────────────────────────────
// Use these when the error happened in a specific action so the friendly text
// is more accurate than the generic classifier output.

export const SAVE_ERROR = {
  title: "Couldn't save your extraction",
  message:
    "Something went wrong while saving. Your extracted data is still here — " +
    "try saving again.",
};

export const LOAD_ERROR = {
  title: "Couldn't load your history",
  message:
    "There was a problem fetching your saved extractions. " +
    "Refresh the page to try again.",
};

export const DELETE_ERROR = {
  title: "Couldn't delete this extraction",
  message: "Something went wrong while deleting. Please try again.",
};

/** Format an error into a readable technical detail string for developers. */
export function formatDetail(error) {
  if (!error) return null;
  const parts = [];
  const name = error.name && error.name !== "Error" ? error.name : null;
  const msg = error.message || String(error);
  parts.push(name ? `${name}: ${msg}` : msg);
  if (error.stack) {
    const trace = error.stack
      .split("\n")
      .slice(1, 6)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (trace) parts.push("\n\n" + trace);
  }
  return parts.join("");
}
