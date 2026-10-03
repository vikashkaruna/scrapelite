#!/usr/bin/env node
// deployment/scripts/mint-supabase-keys.mjs — mint an anon + service_role JWT
// pair from JWT_SECRET, the same HS256 shape the local stack already uses
// (gen-local-config.mjs mintKey). The staging DB cutover needs this: it
// generates a FRESH JWT secret (owner decision 2026-09-30), and every key must
// be minted from that same secret or the self-hosted GoTrue/PostgREST rejects
// it. The hosted project's old anon/service keys die with the old secret BY
// DESIGN — the cutover runbook tells users to log in again.
//
//   JWT_SECRET=<secret> node deployment/scripts/mint-supabase-keys.mjs \
//       [--ref <sql-instance-name>] [--exp-years 10]
//   → prints:
//       ANON_KEY=eyJhbGciOi…
//       SERVICE_KEY=eyJhbGciOi…
//
// Never writes anything — the caller owns where the values land. The anon key
// is public by design (it ships in the browser bundle); the service key is a
// server credential and goes to Secret Manager, never a VITE_ name.

import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const argOf = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};

const secret = process.env.JWT_SECRET || argOf("secret", "");
if (!secret || secret.length < 32) {
  console.error("✗ mint-supabase-keys: JWT_SECRET env (≥32 chars) required");
  process.exit(1);
}
const ref = argOf("ref", "datiq-local") || "datiq-local";
const years = Math.max(1, Math.min(10, Number(argOf("exp-years", "10")) || 10));

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// Identical shape to gen-local-config.mjs mintKey (alg HS256, iss supabase,
// role claim) — the proven format the local GoTrue/PostgREST already accept.
function mintKey(role) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(
    JSON.stringify({ iss: "supabase", ref, role, iat: now, exp: now + years * 365 * 24 * 3600 }),
  );
  const sig = b64u(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

console.log(`ANON_KEY=${mintKey("anon")}`);
console.log(`SERVICE_KEY=${mintKey("service_role")}`);
