// netlify/functions/engagement-unsubscribe.js — the recipient's side of consent.
//
//   GET  ?t=<token>   a small page: "Stop emails from <sender>", plus — when we
//                     hold a phone for this person — "also stop WhatsApp and SMS".
//   POST ?t=<token>   body `List-Unsubscribe=One-Click` → RFC 8058 one-click
//                     (the mailbox's own Unsubscribe button): the token's
//                     channel only, no page.
//                     form body `also_phone=1` → the token's channel plus
//                     WhatsApp and SMS.
//
// ── WHY GET DOES NOT UNSUBSCRIBE ────────────────────────────────────────────
// Mail security scanners (Microsoft Safe Links, Google) fetch every link in a
// message before a human sees it. If GET unsubscribed, recipients would be
// opted out of mail they never read. The page is a confirmation; POST acts.
// The mailbox's one-click button is a POST by specification, so it still works
// with no page at all.
//
// ── WHAT THE PAGE NEVER SHOWS ───────────────────────────────────────────────
// The token is in a URL, and URLs get forwarded. The page masks the email and
// never shows the phone number — it only says one is on file.

import { verifyUnsubscribeToken } from "./lib/engagement/engagementGuards.js";
import { applyOptOut } from "./lib/engagement/optOut.js";
import { serviceDb } from "./lib/engagement/engagementStore.js";
import { escapeHtml } from "../../src/lib/engagement/aiMessageGenerator.js";
import { addressFor, SUPPRESSION_REASONS } from "../../src/lib/engagement/suppressionModel.js";

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function page(title, bodyHtml, status = 200) {
  return {
    statusCode: status,
    headers: HTML_HEADERS,
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f8;--card:#fff;--text:#111827;--muted:#6b7280;--accent:#4f46e5;--border:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--text:#f3f4f6;--muted:#9ca3af;--accent:#818cf8;--border:#2a2f3a}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:460px;margin:12vh auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted)}
label{display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;color:var(--text)}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer;width:100%}
</style></head><body><main><div class="card">${bodyHtml}</div></main></body></html>`,
  };
}

function maskEmail(address) {
  const [local, domain] = String(address || "").split("@");
  if (!domain) return "your address";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

async function loadContext(tok, env) {
  const db = serviceDb(env);
  let prospect = null;
  let senderName = null;
  if (db && tok.prospectId) {
    const { data } = await db.from("engagement_prospects").select("*")
      .eq("id", tok.prospectId).eq("user_id", tok.userId).maybeSingle();
    prospect = data || null;
    if (prospect) {
      const { data: c } = await db.from("engagement_campaigns").select("sender,brand_kit")
        .eq("id", prospect.campaign_id).eq("user_id", tok.userId).maybeSingle();
      senderName = c?.sender?.from_name || c?.brand_kit?.company_name || null;
    }
  }
  // The prospect may have been deleted since the email was sent; the token's
  // own address is still enough to honour the opt-out on its channel.
  const stub = prospect || { [tok.channel === "email" ? "email" : "phone"]: tok.address };
  return { prospect: stub, senderName, hasPhone: Boolean(prospect && addressFor(prospect, "sms")) };
}

function parseForm(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
  return new URLSearchParams(raw);
}

export const handler = async (event, _ctx, env = process.env) => {
  const token = event.queryStringParameters?.t;
  const tok = verifyUnsubscribeToken(token, env);

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Content-Type": "text/plain" }, body: "Method not allowed" };
  }
  if (!tok) {
    return page("Link not valid", `<h1>This link isn't valid</h1><p>It may be incomplete or it has been changed. If you keep receiving messages you did not ask for, reply to one of them and ask to be removed.</p>`, 400);
  }

  try {
    const ctx = await loadContext(tok, env);
    const from = ctx.senderName ? escapeHtml(ctx.senderName) : "this sender";

    if (event.httpMethod === "GET") {
      const who = tok.channel === "email" ? escapeHtml(maskEmail(tok.address)) : "this number";
      const phoneOption = ctx.hasPhone && tok.channel === "email"
        ? `<label><input type="checkbox" name="also_phone" value="1"> <span>Also stop WhatsApp and SMS messages from ${from}</span></label>`
        : "";
      return page("Unsubscribe", `<h1>Unsubscribe from ${from}</h1>
<p>Stop outreach emails to ${who}.</p>
<form method="post" action="?t=${encodeURIComponent(token)}">${phoneOption}<button type="submit">Unsubscribe</button></form>`);
    }

    // ── POST ──
    const form = parseForm(event);
    const oneClick = form.get("List-Unsubscribe") === "One-Click";
    const channels = [tok.channel];
    if (!oneClick && form.get("also_phone") === "1" && ctx.hasPhone) channels.push("whatsapp", "sms");

    const res = await applyOptOut({
      userId: tok.userId, prospect: ctx.prospect, channels,
      reason: SUPPRESSION_REASONS.UNSUBSCRIBE, source: oneClick ? "one_click_header" : "unsubscribe_page",
    }, env);
    if (!res.ok) throw new Error(res.code || "opt_out_failed");

    if (oneClick) return { statusCode: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }, body: "Unsubscribed" };
    const what = channels.length > 1 ? "emails, WhatsApp or SMS messages" : "emails";
    return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>You won't receive further outreach ${what} from ${from}.</p>`);
  } catch (err) {
    console.error("[engagement-unsubscribe] failed:", err?.message || err);
    return page("Something went wrong", `<h1>We couldn't complete that</h1><p>Please try again in a moment. If it keeps failing, reply to the message and ask to be removed.</p>`, 500);
  }
};
