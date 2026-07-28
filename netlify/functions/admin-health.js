// admin-health.js — service, host and database health for /admin/health.
//
//   GET /api/admin-health            → probe everything now, classify, return
//   GET /api/admin-health?record=1   → …and store the observations as samples
//   GET /api/admin-health?window=6   → uptime window in hours (default 24)
//
// Token-gated: this response names internal components, deploy ids and the
// exact set of services that are unconfigured — a map of where the platform is
// weakest. It is not public.
//
// Classification is NOT done here. Probes produce raw observations and
// src/lib/healthModel.js turns them into statuses, so the admin page and this
// endpoint cannot disagree about what "degraded" means.

import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";
import { runAllProbes } from "./lib/healthProbes.js";
import {
  classifyProbe, summarizeHealth, uptimeByComponent,
  HEALTH_COMPONENTS, HEALTH_GROUPS, HEALTH_STATUS,
} from "../../src/lib/healthModel.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Health that is 60 seconds old is not health. Never cache this.
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

function db() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Persist this round of observations. Best effort — never fails the request. */
async function recordSamples(components) {
  const d = db();
  if (!d) return false;
  const rows = components.map((c) => ({
    component: c.id,
    status: c.status,
    latency_ms: Number.isFinite(c.latencyMs) ? Math.round(c.latencyMs) : null,
    observed_at: c.checkedAt || new Date().toISOString(),
    detail: c.note ? { note: String(c.note).slice(0, 300) } : {},
  }));
  try {
    const res = await fetchWithTimeout(`${d.base}/health_samples`, {
      method: "POST",
      headers: { ...d.headers, Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Read back the sample window that uptime is computed from. */
async function loadSamples(windowHours) {
  const d = db();
  if (!d) return [];
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  try {
    const res = await fetchWithTimeout(
      `${d.base}/health_samples?select=component,status,latency_ms,observed_at` +
        `&observed_at=gte.${encodeURIComponent(since)}` +
        `&order=observed_at.desc&limit=5000`,
      { headers: d.headers },
    );
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export const handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod && event.httpMethod !== "GET") {
    return respond(405, { ok: false, error: "Method not allowed." });
  }

  const auth = verifyAdminToken(bearerFromEvent(event));
  if (!auth.ok) return respond(401, { ok: false, error: auth.reason });

  const params = event.queryStringParameters || {};
  const windowHours = Math.max(1, Math.min(720, Number(params.window) || 24));
  const shouldRecord = params.record === "1" || params.record === "true";

  const raw = await runAllProbes();
  const components = raw.map(classifyProbe);

  // Fire-and-forget-ish: recording is useful but must not delay or break the
  // read. Awaited only so the serverless container is not frozen mid-write.
  let recorded = false;
  if (shouldRecord) recorded = await recordSamples(components);

  const samples = await loadSamples(windowHours);
  const uptime = uptimeByComponent(samples, { windowMs: windowHours * 3600_000 });

  const summary = summarizeHealth(components);

  return respond(200, {
    ok: true,
    generatedAt: new Date().toISOString(),
    overall: summary.overall,
    summary,
    components,
    uptime,
    uptimeWindowHours: windowHours,
    // Distinguishes "no samples yet" (fresh deploy) from "history is off"
    // (no Supabase) — the UI says something different for each.
    historyAvailable: !!db(),
    samplesInWindow: samples.length,
    recorded,
    groups: HEALTH_GROUPS,
    demo: auth.demo === true,
  });
};

export const _internal = { recordSamples, loadSamples, HEALTH_COMPONENTS, HEALTH_STATUS };
