// report-email.js — POST /api/report-email — email an extraction, batch, or
// discoverability report with the actual file attached (see
// lib/reportEmail.js for the branded HTML/Resend send).
//
// Body: { kind: "extraction"|"batch"|"discoverability", ids: string[] (or
//         auditId for discoverability), format?, brandKit? }
//
// The recipient is NEVER accepted from the request body — it is always
// resolved server-side from the verified session, same anti-open-relay rule
// invoice-email.js and contact-email.js already enforce. A client that could
// name its own recipient could use this endpoint to spam an arbitrary
// address with a DatIQ-branded email.
import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { sendReportEmail } from "./lib/reportEmail.js";
import * as store from "./lib/audit/auditStore.js";
import { rehydrate } from "./discoverability.js";
import { validateBrandKit } from "../../src/lib/brandKitValidation.js";
import { requireCapability } from "./lib/requireEntitlement.js";
import { requireWorkspaceDiscoverabilityAction } from "./lib/workspaceContext.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

const ALLOWED_FORMATS = new Set(["pdf", "csv", "markdown", "json"]);
const ALLOWED_KINDS = new Set(["extraction", "batch", "discoverability"]);

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  const auth = await authenticateBearer(event, { label: "report-email" });
  if (!auth.ok) return respond(auth.status, auth.body);
  const { user, client: supabase } = auth;
  const recipient = user.email;
  if (!recipient) return respond(400, { ok: false, error: "Your account has no email on file." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

  const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return respond(400, { ok: false, error: "kind must be one of extraction, batch, discoverability." });
  const format = ALLOWED_FORMATS.has(body.format) ? body.format : "pdf";
  const ctaUrl = `${process.env.URL || process.env.SITE_URL || "https://datiq.app"}/${kind === "discoverability" ? "discoverability" : "dashboard"}`;

  // The Brand Kit lives in the BROWSER's localStorage (see
  // whiteLabelTemplate.js) — this server function has no access to it, so
  // the client includes its own read of it in the request body. Re-validated
  // here rather than trusted: a malformed or oversized value degrades to no
  // Brand Kit (default DatIQ branding) rather than failing the whole send —
  // a report emailed with the default look is still a correct outcome.
  //
  // Also re-checked against the white_label_pdf entitlement (Business/Agency)
  // server-side: the UI never offers Brand Kit customization below that tier,
  // but a request built by hand could still include one, and this is the one
  // point in the whole feature where honoring it would otherwise bypass the
  // paywall silently. Same "degrade, don't fail the email" posture — a
  // disallowed brandKit is just dropped, not an error the sender ever sees.
  let brandKit = null;
  if (body.brandKit && typeof body.brandKit === "object") {
    const v = validateBrandKit(body.brandKit);
    if (v.ok && Object.keys(v.value).length) {
      const { check } = await requireCapability(event, "white_label_pdf");
      if (check.allowed) brandKit = v.value;
    }
  }

  if (kind === "discoverability") {
    const auditId = body.auditId || (Array.isArray(body.ids) ? body.ids[0] : null);
    if (!auditId) return respond(400, { ok: false, error: "auditId is required." });
    const workspaceId = body.workspace_id || null;
    const full = await store.getAuditFull(user.id, auditId, { workspaceId });
    if (!full) return respond(404, { ok: false, error: "Audit not found." });
    const roleGate = await requireWorkspaceDiscoverabilityAction(user.id, workspaceId, "read");
    if (!roleGate.ok) {
      return respond(403, { ok: false, error: roleGate.refusal.message, code: roleGate.refusal.code });
    }
    const audit = rehydrate(full);
    const result = await sendReportEmail({ kind, recipient, format, audit, ctaUrl, brandKit });
    if (!result.sent) return respond(502, { ok: false, error: "Could not send the email.", reason: result.reason });
    return respond(200, { ok: true, sent: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return respond(400, { ok: false, error: "ids must be a non-empty array." });

  const { data, error } = await supabase
    .from("extractions")
    .select("*")
    .eq("user_id", user.id)
    .in("id", ids);
  if (error) return respond(502, { ok: false, error: "Could not load the extraction(s)." });
  if (!data || !data.length) return respond(404, { ok: false, error: "No matching extraction(s) found." });

  const result = await sendReportEmail({ kind, recipient, format, items: data, ctaUrl, brandKit });
  if (!result.sent) return respond(502, { ok: false, error: "Could not send the email.", reason: result.reason });
  return respond(200, { ok: true, sent: true });
};
