// invoice-email.js — re-send an invoice to the account's own email.
//
// POST /api/invoice-email  { invoiceId }
//
// ── OPEN-RELAY GUARD ─────────────────────────────────────────────────────────
// The request body carries an invoice id and NOTHING ELSE. The recipient is
// resolved server-side from the authenticated user, never from the request.
// A caller must not be able to mail somebody's tax document — with their name,
// address and GSTIN on it — to an address of their choosing. This mirrors the
// server-authoritative routing already used by contact-email.js, which takes an
// enquiry *type* rather than a destination for the same reason.
import { sendInvoiceEmail } from "./lib/invoiceEmail.js";
import { authenticateBearer } from "./lib/supabaseServerClient.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const invoiceId = body.invoiceId;
  if (!invoiceId) return json(400, { error: "invoiceId is required" });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) return json(401, { error: "Authentication required" });

  // See extractions.js — `getUser()` with no argument 401s on every request
  // under supabase-js v2.108+, so this endpoint could never email an invoice.
  const auth = await authenticateBearer(event, { label: "invoice-email" });
  if (!auth.ok) return json(auth.status, auth.body);
  const supabase = auth.client;
  const user = auth.user;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();

  // 404 rather than 403 — do not confirm that an id exists to a non-owner.
  if (error || !invoice) return json(404, { error: "Invoice not found" });

  // The recipient comes from the VERIFIED session, overriding whatever the
  // invoice snapshot happens to hold, and can never come from the request body.
  const result = await sendInvoiceEmail(
    { ...invoice, email: user.email },
    { kind: `resend:${Date.now()}` }, // a resend is intentionally not deduped
  );

  if (!result.sent && result.reason === "no_key") {
    return json(503, { error: "Email delivery is not configured." });
  }
  if (!result.sent) return json(502, { error: "Could not send the invoice." });

  return json(200, { sent: true });
};
