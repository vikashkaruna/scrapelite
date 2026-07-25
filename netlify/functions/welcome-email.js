// netlify/functions/welcome-email.js — F49 (welcome email trigger).
//
// Fires once per user on first sign-in. Sends a one-shot welcome email
// via Resend, marks the user metadata so we never email them again.
//
// Called from the browser after AuthProvider detects a new sign-in.
// The function is idempotent: if the user already has the
// `welcomeEmailSent: true` flag in their auth metadata, it returns 200
// without sending.

import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.CONTACT_EMAIL_FROM || "DatIQ <hello@datiq.app>";
  const SITE_URL = process.env.URL || process.env.SITE_URL || "https://datiq.app";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 200, body: "skipped (no supabase service key)" };
  }
  if (!RESEND_KEY) {
    return { statusCode: 200, body: "skipped (no Resend key)" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400, body: "invalid JSON" }; }
  const { userId, email, name, planLabel } = body;
  if (!userId || !email) return { statusCode: 400, body: "userId and email required" };

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotency: read the user metadata first.
  let user;
  try {
    const { data, error } = await sb.auth.admin.getUserById(userId);
    if (error || !data?.user) return { statusCode: 404, body: "user not found" };
    user = data.user;
  } catch (err) {
    return { statusCode: 502, body: `supabase error: ${err.message}` };
  }

  const alreadySent = user.user_metadata?.welcomeEmailSent === true;
  if (alreadySent) return { statusCode: 200, body: "already sent" };

  // Compose the email.
  const greeting = name || email.split("@")[0];
  const html = welcomeHtml({ greeting, planLabel, siteUrl: SITE_URL });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: "Welcome to DatIQ — let's set up your first extraction",
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { statusCode: 502, body: `resend ${res.status}: ${t}` };
    }
  } catch (err) {
    return { statusCode: 502, body: `resend error: ${err.message}` };
  }

  // Mark the flag in user metadata so we don't send again.
  try {
    await sb.auth.admin.updateUserById(userId, {
      user_metadata: { ...(user.user_metadata || {}), welcomeEmailSent: true },
    });
  } catch (err) {
    // Email was sent; log and continue.
    console.warn("[DatIQ] welcome-email: failed to set flag:", err.message);
  }

  return { statusCode: 200, body: "welcome email sent" };
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function welcomeHtml({ greeting, planLabel, siteUrl }) {
  const plan = planLabel || "Free";
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto">` +
    `<div style="background:#4f46e5;color:#fff;padding:20px 22px;border-radius:12px 12px 0 0">` +
    `<div style="font-size:13px;letter-spacing:.04em;opacity:.85;text-transform:uppercase">DatIQ</div>` +
    `<div style="font-size:22px;font-weight:800;margin-top:4px">Welcome, ${escapeHtml(greeting)}!</div></div>` +
    `<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:22px;background:#fff">` +
    `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.55">You&apos;re on the <strong>${escapeHtml(plan)}</strong> plan. Here are three quick ways to get value from DatIQ today:</p>` +
    `<ol style="margin:0 0 18px;padding-left:22px;color:#374151;font-size:14px;line-height:1.7">` +
    `<li><strong>Extract a single page</strong> — paste a URL, get headings, links, and an AI summary in seconds.</li>` +
    `<li><strong>Run a batch</strong> — drop a CSV of 10–500 URLs, get them all at once.</li>` +
    `<li><strong>Set up a schedule</strong> — track a page for changes; we&apos;ll email or Slack you when content shifts.</li>` +
    `</ol>` +
    `<a href="${siteUrl}/" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;margin-right:8px">Extract a page →</a>` +
    `<a href="${siteUrl}/batch" style="display:inline-block;background:#fff;color:#4f46e5;border:1px solid #4f46e5;text-decoration:none;font-weight:700;font-size:14px;padding:10px 18px;border-radius:9px">Try a batch</a>` +
    `<p style="margin:18px 0 0;color:#9ca3af;font-size:12px;line-height:1.5">Manage notification preferences anytime on the Account page.</p>` +
    `</div></div>`
  );
}
