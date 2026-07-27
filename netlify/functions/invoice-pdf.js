// invoice-pdf.js — authenticated invoice download.
//
// GET /api/invoice-pdf?id=<uuid>  →  application/pdf
//
// ── AUTHORIZATION RULES THAT MUST NOT BE RELAXED ─────────────────────────────
//
// 1. NEVER gate on session_id. It is a value the browser writes to its own
//    localStorage; anyone who learned or guessed one could pull a stranger's
//    tax document, complete with their name, address and GSTIN. Ownership is
//    auth.uid() and nothing else.
//
// 2. Return 404, not 403, for an invoice belonging to someone else. A 403
//    confirms the id exists, which turns this endpoint into an oracle for
//    enumerating invoice ids.
//
// 3. Defence in depth: the query filters on user_id explicitly even though RLS
//    already restricts it — same belt-and-braces as extractions.js.
//
// The PDF is rendered on demand from the stored invoice + lines. It is
// deterministic (same row in, same bytes out), so this is equivalent to serving
// a stored object while avoiding a Storage dependency for the common case.
import { createClient } from "@supabase/supabase-js";
import { buildInvoiceDoc } from "../../src/lib/invoiceModel.js";
import { invoiceFilename, renderInvoicePdf } from "../../src/lib/invoicePdf.js";

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

function getSupabaseForUser(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const id = event.queryStringParameters?.id;
  if (!id) return json(400, { error: "id query param required" });

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader) return json(401, { error: "Authentication required" });

  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) return json(503, { error: "Supabase not configured" });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return json(401, { error: "Invalid or expired session." });

  try {
    const { data: invoice, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id) // see rule 3
      .maybeSingle();

    // Rule 2: indistinguishable from "does not exist".
    if (error || !invoice) return json(404, { error: "Invoice not found" });

    const { data: lines } = await supabase
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", id)
      .order("line_no", { ascending: true });

    const pdf = renderInvoicePdf(buildInvoiceDoc(invoice, lines || []));
    const body = Buffer.from(pdf.output("arraybuffer")).toString("base64");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoiceFilename(invoice.invoice_no)}"`,
        // A tax document must never sit in a shared cache.
        "Cache-Control": "private, no-store",
        ...CORS,
      },
      body,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[invoice-pdf]", err?.message);
    return json(500, { error: "Could not generate the invoice PDF." });
  }
};
