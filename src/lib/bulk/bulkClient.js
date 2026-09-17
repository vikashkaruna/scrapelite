// src/lib/bulk/bulkClient.js — Client SDK for Bulk Account Intelligence (PRD 3).
//
// Provides typed APIs for List CRUD, CSV/paste domain intake, chunked durable
// execution runner, ICP criteria configuration, and human review queue.

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

export async function listLists() {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment?lists=1", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch lists: ${res.status}`);
  }
  return res.json();
}

export async function getList(listId) {
  const headers = await authHeaders();
  const res = await fetch(`/api/bulk-enrichment?listId=${encodeURIComponent(listId)}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch list: ${res.status}`);
  }
  return res.json();
}

export async function createList({ name, description, domains, persona }) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "create", name, description, domains, persona }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to create list: ${res.status}`);
  }
  return res.json();
}

export async function updateList({ listId, name, description }) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "update_list", listId, name, description }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update list: ${res.status}`);
  }
  return res.json();
}

export async function deleteList(listId) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete_list", listId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete list: ${res.status}`);
  }
  return res.json();
}

export async function updateAccountRecord({ recordId, updates }) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "update_record", recordId, updates }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to update record: ${res.status}`);
  }
  return res.json();
}

export async function deleteAccountRecord(recordId) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "delete_record", recordId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to delete record: ${res.status}`);
  }
  return res.json();
}

export async function processChunk(jobId) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "process_chunk", jobId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to process chunk: ${res.status}`);
  }
  return res.json();
}

export async function startJob(listId) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "start_job", listId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to start enrichment job: ${res.status}`);
  }
  return res.json();
}

/**
 * Executes a bulk enrichment job to completion using durable chunking.
 */
export async function runFullJob(jobId, onProgress = null) {
  let done = false;
  let totalProcessed = 0;
  let maxRetries = 30;

  while (!done && maxRetries > 0) {
    maxRetries--;
    const res = await processChunk(jobId);
    if (!res.ok) throw new Error(res.reason || "Chunk failed");

    totalProcessed += res.processed || 0;
    onProgress?.({
      processed: totalProcessed,
      remaining: res.remaining || 0,
      done: res.done,
    });

    if (res.done) {
      done = true;
      break;
    }
  }

  return { ok: true, processed: totalProcessed };
}

export async function getIcpRules(persona = "default") {
  const headers = await authHeaders();
  const res = await fetch(`/api/bulk-enrichment?rules=1&persona=${encodeURIComponent(persona)}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch ICP rules: ${res.status}`);
  }
  return res.json();
}

export async function saveIcpRules({ persona, name, criteria, threshold }) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "save_rules", persona, name, criteria, threshold }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to save ICP rules: ${res.status}`);
  }
  return res.json();
}

export async function getReviewQueue(listId = null) {
  const headers = await authHeaders();
  const url = listId
    ? `/api/bulk-enrichment?review=1&filterListId=${encodeURIComponent(listId)}`
    : "/api/bulk-enrichment?review=1";
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch review queue: ${res.status}`);
  }
  return res.json();
}

export async function resolveReviewItem({ reviewId, action, resolvedValue }) {
  const headers = await authHeaders();
  const res = await fetch("/api/bulk-enrichment", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "resolve_review",
      reviewId,
      resolveAction: action,
      resolvedValue,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to resolve review item: ${res.status}`);
  }
  return res.json();
}
