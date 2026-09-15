// authErrors.js — maps Supabase auth errors to friendly UI copy.
// Keeps raw error text like "Email link is invalid or has expired" out of
// the user-facing surface and provides actionable next steps instead.
//
// Pattern matches the raw Supabase error message OR a known error code
// from the supabase-js v2 client (AuthError / AuthApiError).

const RULES = [
  {
    // Most common: user clicks an old/broken confirmation or recovery link.
    // Root cause is almost always a Supabase dashboard misconfig (Site URL
    // or redirect allowlist missing the app origin), NOT a user mistake.
    test: /email link is invalid or has expired|otp.*expired|token.*expired|invalid.*token/i,
    title: "This link is no longer valid",
    message:
      "The link may have already been used, or the configured app URL doesn't match. " +
      "If you already have an account, you can sign in below with your email and password. " +
      "Or request a new link from the sign-in screen.",
    cta: { label: "Back to sign in", action: "back-to-signin" },
  },
  {
    // Sign-in before the user has clicked the confirmation link. Common when
    // "Confirm email" is on in the Supabase project.
    test: /email not confirmed/i,
    title: "Please confirm your email first",
    message:
      "Check your inbox for a confirmation link. If you didn't get one, you can " +
      "request a new one from the sign-in screen.",
    cta: { label: "Resend confirmation", action: "resend-confirmation" },
  },
  {
    test: /user already registered|already been registered|already exists/i,
    title: "Account already exists",
    message:
      "An account with that email already exists. Try signing in instead, or " +
      "use the forgot-password link to reset your password.",
    cta: { label: "Back to sign in", action: "back-to-signin" },
  },
  {
    test: /invalid login credentials|invalid credentials|invalid email or password/i,
    title: "Email or password is incorrect",
    message:
      "Double-check the email address and password. If you signed up with Google, " +
      "use the Google button instead — passwords aren't set for OAuth accounts.",
    cta: { label: "Reset password", action: "open-forgot" },
  },
  {
    test: /password.*at least|min.*characters|password.*too short/i,
    title: "Password is too short",
    message: "Pick a password with at least 6 characters.",
  },
  {
    test: /rate limit|too many requests|email rate limit/i,
    title: "Too many attempts",
    message:
      "Wait a minute and try again. If you keep hitting this, try the " +
      "forgot-password flow to reset.",
  },
  {
    test: /signups not allowed|signup.*disabled|signups disabled/i,
    title: "Sign-up is currently closed",
    message:
      "New account creation is disabled in this environment. " +
      "Try again later or contact support.",
  },
  {
    // GoTrue deliberately returns this generic message when an Auth database
    // hook or trigger rejects a new user. It is not a bad password and a
    // reset link cannot resolve it.
    test: /database error saving new user|unexpected_failure|unexpected failure/i,
    title: "We couldn't create your account",
    message:
      "The sign-up service couldn't save this account. Please try again in a " +
      "few minutes. If it keeps happening, contact support so we can check the " +
      "staging authentication service.",
  },
  {
    test: /invalid api key|apikey.*invalid|jwt.*invalid/i,
    title: "Sign-in service configuration error",
    message:
      "This environment is using an invalid sign-in configuration. Please try " +
      "again shortly while we correct it.",
  },
  {
    test: /unable to validate email|validation_failed|email.*invalid format/i,
    title: "Enter a valid email address",
    message: "Check the email address and try again.",
  },
  {
    test: /network|fetch|failed to fetch/i,
    title: "Couldn't reach the auth server",
    message:
      "Your internet connection may be down. Check the connection and try again.",
  },
];

function defaultError(operation) {
  if (operation === "signup") {
    return {
      title: "We couldn't create your account",
      message:
        "Something went wrong while creating your account. Please try again. " +
        "If it continues, contact support so we can investigate the sign-up service.",
    };
  }
  return {
    title: "Authentication failed",
    message:
      "Something went wrong while signing you in. Try again — if the problem " +
      "continues, use the forgot-password link to reset your password.",
    cta: { label: "Reset password", action: "open-forgot" },
  };
}

/**
 * Classify a Supabase auth error into { title, message, cta? }.
 * Accepts either an Error object, a string, or a { code, message } shape.
 * `operation` prevents a failed sign-up from being presented as a failed sign-in.
 */
export function classifyAuthError(error, { operation } = {}) {
  if (!error) return defaultError(operation);
  const raw =
    typeof error === "string"
      ? error
      : String(error?.message || error?.error_description || error || "");
  const code = String(error?.code || error?.error_code || "").toLowerCase();
  const haystack = `${code} ${raw}`.toLowerCase();
  for (const rule of RULES) {
    if (rule.test.test(haystack)) {
      return { title: rule.title, message: rule.message, cta: rule.cta || null };
    }
  }
  return defaultError(operation);
}
