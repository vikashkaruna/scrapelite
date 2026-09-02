// src/lib/reports/reportsClient.js — the browser side of PRD 2.

import { getAuthToken } from "../apiClient.js";

const BASE = "/api/reports";

async function call(path = "", { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers, credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.reason = data?.reason;
    throw err;
  }
  return data;
}

/** Public read. Works signed out — that is the point of a shared link. */
export function readReport(slug) {
  return call(`?slug=${encodeURIComponent(slug)}`);
}

export function listMyReports() {
  return call();
}

export function createReport({ title, runId, sourceUrl, templateKey, data, branding, workspaceId }) {
  return call("", { method: "POST", body: {
    action: "create", title, runId, sourceUrl, templateKey, data, branding, workspaceId,
  } });
}

export function publishReport(reportId, visibility = "link", expiresAt = null) {
  return call("", { method: "POST", body: { action: "publish", reportId, visibility, expiresAt } });
}

export function unpublishReport(reportId) {
  return call("", { method: "POST", body: { action: "unpublish", reportId } });
}

/** Terminal. The slug is burned and can never be reissued. */
export function revokeReport(reportId, reason = null) {
  return call("", { method: "POST", body: { action: "revoke", reportId, reason } });
}

export function grantAccess(reportId, email, remove = false) {
  return call("", { method: "POST", body: { action: "grant", reportId, email, remove } });
}

export function reportUrl(slug) {
  if (!slug) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://datiq.app";
  return `${origin}/r/${slug}`;
}
