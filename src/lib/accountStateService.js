// src/lib/accountStateService.js — the browser's side of /api/account-state.
//
// Never throws by contract, like workspacesService.js: a failure to READ the
// account state must not break the Account page, and a failure to WRITE must
// surface as copy the user can act on rather than as an unhandled rejection in
// a dialog they cannot dismiss.

import { getAuthToken } from "./apiClient.js";

const BASE = "/api/account-state";

function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = getAuthToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** The word a person must type to confirm deletion. Also checked server-side. */
export const DELETE_CONFIRMATION = "DELETE";

async function post(action, payload = {}) {
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "That did not go through.", code: data.code };
    return { ok: true, ...data };
  } catch {
    // A network failure must read as "nothing happened", because nothing did.
    return { ok: false, error: "Could not reach the server. Nothing was changed." };
  }
}

export async function fetchAccountState() {
  try {
    const res = await fetch(BASE, { headers: authHeaders(), credentials: "same-origin" });
    if (!res.ok) return { available: false };
    return (await res.json()).state || { available: false };
  } catch {
    return { available: false };
  }
}

export const freezeAccount = (reason) => post("freeze", { reason });
export const unfreezeAccount = () => post("unfreeze");
/** `confirm` must be the exact DELETE_CONFIRMATION string; the server re-checks. */
export const requestAccountDeletion = (confirm) => post("request_deletion", { confirm });
export const cancelAccountDeletion = () => post("cancel_deletion");
