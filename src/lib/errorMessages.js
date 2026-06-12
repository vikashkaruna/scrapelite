// errorMessages.js — maps raw JS/network/API errors to friendly UI copy.
// Each category has a test regex, a user-facing title, and a plain-English message.
// Keeps technical jargon out of the UI while preserving the real error for devs.

const CATEGORIES = [
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

/** Returns { title, message } for a given error, defaulting gracefully. */
export function classifyError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.test.test(msg)) return { title: cat.title, message: cat.message };
  }
  return DEFAULT;
}

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
