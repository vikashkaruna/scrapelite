// src/lib/watchlist/watchlistClient.js — Client SDK for Competitor Watchlists (PRD 4).
//
// Typed client functions for managing competitor watchlists, inspecting field changes,
// viewing strategic AI interpretations, and sending human relevance feedback.

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

export async function listWatchlists() {
  const headers = await authHeaders();
  const res = await fetch("/api/watchlists", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch watchlists: ${res.status}`);
  }
  return res.json();
}

export async function getWatchlist(watchlistId) {
  const headers = await authHeaders();
  const res = await fetch(`/api/watchlists?watchlistId=${encodeURIComponent(watchlistId)}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch watchlist: ${res.status}`);
  }
  return res.json();
}

export async function createWatchlist({ name, description, cadence, domains }) {
  const headers = await authHeaders();
  const res = await fetch("/api/watchlists", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "create", name, description, cadence, domains }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create watchlist: ${res.status}`);
  }
  return res.json();
}

export async function recordChange({ watchlistId, targetId, targetDomain, field, category, oldValue, newValue }) {
  const headers = await authHeaders();
  const res = await fetch("/api/watchlists", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "record_change",
      watchlistId,
      targetId,
      targetDomain,
      field,
      category,
      oldValue,
      newValue,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to record change: ${res.status}`);
  }
  return res.json();
}

export async function submitFeedback({ fieldChangeId, feedback, notes }) {
  const headers = await authHeaders();
  const res = await fetch("/api/watchlists", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "feedback",
      fieldChangeId,
      feedback,
      notes,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to submit feedback: ${res.status}`);
  }
  return res.json();
}
