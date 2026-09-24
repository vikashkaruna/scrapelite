// src/lib/accountBrandKitClient.js — the account Brand Kit's server copy (0083).
//
// The browser copy (whiteLabelTemplate.js, localStorage) stays the one every
// export reads synchronously, logo included. This keeps the TEXT fields on the
// server too, so the kit follows the account to another device and Engagement
// can reuse it. Every call throws an Error carrying `status`/`code`.

import { supabase } from "./supabaseClient.js";

const ENDPOINT = "/api/account-brand-kit";

async function call(method, body) {
  let token = null;
  try { token = (await supabase?.auth.getSession())?.data?.session?.access_token || null; } catch { /* signed out */ }
  if (!token) { const e = new Error("Sign in to use your account brand kit."); e.status = 401; e.code = "signed_out"; throw e; }
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error("Could not reach DatIQ. Check your connection and try again."); e.code = "network_error"; throw e;
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; e.code = data.code || null; throw e;
  }
  return data;
}

export const getAccountBrandKit = () => call("GET");
export const saveAccountBrandKit = (kit) => call("PUT", { kit });
export const deleteAccountBrandKit = () => call("DELETE");

/** Account Brand Kit → Engagement brand kit + sender fields (fills a form; never saves). */
export function mapAccountKitToEngagement(kit = {}) {
  const out = { brandKit: {}, sender: {} };
  if (kit.companyName) out.brandKit.company_name = kit.companyName;
  if (kit.tagline) out.brandKit.value_prop = kit.tagline;
  if (kit.website) out.brandKit.cta_url = kit.website;
  if (kit.footerText) out.brandKit.signoff_name = kit.footerText;
  if (kit.contactEmail) out.sender.reply_to = kit.contactEmail;
  return out;
}
