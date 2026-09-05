// workflowClient.js — reads the end-to-end orchestration view.
//
// Its own authHeaders, matching every other client in this codebase rather than
// reaching into a sibling module for a private helper.
import { supabase } from "../supabaseClient.js";

async function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (!supabase) return headers;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore offline/missing auth */
  }
  return headers;
}

/** @returns {Promise<{nodes, edges, issues, counts}>} */
export async function getWorkflowGraph() {
  const headers = await authHeaders();
  const res = await fetch("/api/workflow-graph", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Could not load your workflow (${res.status}).`);
  }
  return res.json();
}
