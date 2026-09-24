// netlify/functions/account-brand-kit.js — the account Brand Kit, server copy (0083).
//
//   GET    /api/account-brand-kit   → { ok, allowed, kit | null }
//   PUT    /api/account-brand-kit   { kit } → { ok, kit }   (Business / Agency only)
//   DELETE /api/account-brand-kit   → { ok }
//
// Why it exists: the Brand Kit lived only in one browser's localStorage, so
// Engagement could not reuse it and it did not follow the user to another
// device. Only the validated TEXT fields are stored (brandKitValidation.js);
// the logo stays in the browser.
//
// Plan gate: white_label_pdf (Business, Agency), checked on write — the same
// capability the exports already check. GET answers `allowed` so the UI can
// explain a locked button instead of failing silently. Reading your own saved
// kit is never refused: taking back something a customer already has because
// their plan changed would be removing data, not gating a feature.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { requireCapabilityForUser } from "./lib/requireEntitlement.js";
import { serviceDb } from "./lib/engagement/engagementStore.js";
import { validateBrandKit } from "../../src/lib/brandKitValidation.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
};
const json = (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json", ...CORS }, body: JSON.stringify(body) });

/** The server keeps only these — never the logo data URL. */
export const SERVER_KIT_FIELDS = ["companyName", "tagline", "footerText", "website", "contactEmail", "accentColor"];

async function planAllows(userId) {
  try {
    const { check } = await requireCapabilityForUser(userId, "white_label_pdf");
    return Boolean(check?.allowed);
  } catch {
    // Fail CLOSED here: this gates a paid feature's write, and an unreadable
    // entitlement must not hand it to every plan.
    return false;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  const auth = await authenticateBearer(event, { label: "account-brand-kit" });
  if (!auth.ok) return json(auth.status || 401, auth.body || { ok: false, error: "Sign in to continue." });
  const userId = auth.user.id;

  const db = serviceDb();
  if (!db) return json(503, { ok: false, code: "store_unconfigured", error: "Saving the brand kit isn't available right now." });

  if (event.httpMethod === "GET") {
    const [allowed, row] = await Promise.all([
      planAllows(userId),
      db.from("account_brand_kits").select("kit,updated_at").eq("user_id", userId).maybeSingle(),
    ]);
    if (row.error) return json(500, { ok: false, code: "store_error", error: "Could not load your brand kit." });
    return json(200, { ok: true, allowed, kit: row.data?.kit || null, updated_at: row.data?.updated_at || null });
  }

  if (event.httpMethod === "PUT") {
    if (!(await planAllows(userId))) {
      return json(402, { ok: false, code: "plan_required", error: "A custom brand kit is available on the Business and Agency plans." });
    }
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { ok: false, code: "invalid_json", error: "Invalid request." }); }
    const input = Object.fromEntries(SERVER_KIT_FIELDS.filter((k) => body?.kit?.[k] != null).map((k) => [k, body.kit[k]]));
    const v = validateBrandKit(input);
    if (!v.ok) return json(400, { ok: false, code: v.code || "invalid_kit", error: v.reason || "Check the brand kit fields." });
    const kit = Object.fromEntries(SERVER_KIT_FIELDS.filter((k) => v.value[k]).map((k) => [k, v.value[k]]));
    const { error } = await db.from("account_brand_kits")
      .upsert({ user_id: userId, kit, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return json(500, { ok: false, code: "store_error", error: "Could not save your brand kit." });
    return json(200, { ok: true, kit });
  }

  if (event.httpMethod === "DELETE") {
    const { error } = await db.from("account_brand_kits").delete().eq("user_id", userId);
    if (error) return json(500, { ok: false, code: "store_error", error: "Could not remove your brand kit." });
    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: "Method not allowed" });
};
