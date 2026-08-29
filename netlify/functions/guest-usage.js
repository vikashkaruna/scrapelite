// POST /api/guest-usage — reserve one server-side anonymous batch credit.
// Single extraction credits are reserved inside /api/extract immediately
// before the provider call; batch runs reserve their run credit here.

import { consumeGuestCredit } from "./lib/guestUsage.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event = {}) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  if (event.headers?.authorization || event.headers?.Authorization) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ allowed: true, authenticated: true }) };
  }
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* default to single */ }
  const usage = await consumeGuestCredit(event, body?.kind === "batch" ? "batch" : "single");
  return {
    statusCode: usage.allowed ? 200 : 429,
    headers: { ...CORS, "Set-Cookie": usage.cookie },
    body: JSON.stringify({ allowed: usage.allowed, remaining: usage.remaining, reason: usage.reason || null, degraded: usage.degraded }),
  };
};
