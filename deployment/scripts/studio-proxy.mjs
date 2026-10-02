#!/usr/bin/env node
// deployment/scripts/studio-proxy.mjs — authenticated local gateway for the
// PRIVATE Cloud Run Studio service.
//
// WHY THIS EXISTS (2026-10-01): `gcloud run services proxy` does not work for
// operators here, two different ways, both verified live:
//   • plain user credentials → the proxy forwards a user ID token whose `aud`
//     is the gcloud OAuth client id; Cloud Run's IAM wants an audience-scoped
//     ID token and answers 401 "The request was not authorized to invoke this
//     service. The access token could not be verified."
//   • --impersonate-service-account → gcloud hard-fails before listening:
//     "failed to get idtoken source: idtoken: unsupported credentials type"
//     (and gcloud beta adds an interactive confirm prompt).
// What DOES work: `gcloud auth print-identity-token
// --impersonate-service-account=<sa> --audiences=<service-url>` produces
// exactly the token Cloud Run accepts (verified: Studio's UI shell and the
// pg-meta API answer 200 through it). This script is a ~120-line forwarding
// proxy that mints that token, keeps it fresh, and serves Studio on
// localhost — the same shape `gcloud run services proxy` was supposed to give.
//
//   node deployment/scripts/studio-proxy.mjs \
//     --service <studio-service> --project <gcp-project> \
//     --region <region> --sa <deploy-sa>@<gcp-project>.iam.gserviceaccount.com \
//     --port 54328
//
// The token is minted once and refreshed 5 min before its 1h expiry. The
// service URL is resolved once at startup via gcloud. No secrets on disk.

import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const service = arg("service");
const project = arg("project");
const region = arg("region");
const sa = arg("sa");
const port = Number(arg("port", "54328"));
if (!service || !project || !region || !sa) {
  console.error("usage: studio-proxy.mjs --service <name> --project <id> --region <r> --sa <email> [--port 54328]");
  process.exit(1);
}

const gcloud = (...args) => execFileSync("gcloud", args, { encoding: "utf8" }).trim();

console.log(`→ resolving ${service} …`);
const serviceUrl = gcloud("run", "services", "describe", service,
  `--project=${project}`, `--region=${region}`, "--format=value(status.url)");
if (!/^https:\/\//.test(serviceUrl)) {
  console.error(`✗ could not resolve the service URL (got: ${serviceUrl || "empty"})`);
  process.exit(1);
}
console.log(`  service: ${serviceUrl}`);

// ID token cache. `--audiences` is what changes the token's aud to the service
// URL — the exact piece the plain proxy path gets wrong.
let cached = { token: "", mintedAt: 0 };
const TOKEN_TTL_MS = 55 * 60 * 1000;   // refresh before the 60-min expiry
function idToken() {
  if (cached.token && Date.now() - cached.mintedAt < TOKEN_TTL_MS) return cached.token;
  const raw = gcloud("auth", "print-identity-token",
    `--impersonate-service-account=${sa}`, `--audiences=${serviceUrl}`);
  // gcloud may print impersonation WARNINGS to stdout; the JWT is the last line.
  const token = raw.split("\n").map((l) => l.trim()).filter((l) => /^eyJ/.test(l)).pop();
  if (!token) {
    console.error("✗ could not mint an identity token — check roles/iam.serviceAccountTokenCreator on " + sa);
    process.exit(1);
  }
  cached = { token, mintedAt: Date.now() };
  return token;
}

const upstream = new URL(serviceUrl);
const server = http.createServer((req, res) => {
  let token;
  try { token = idToken(); }
  catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "token_mint_failed", detail: String(err?.message || err).slice(0, 300) }));
  }
  const headers = { ...req.headers, host: upstream.host, authorization: `Bearer ${token}` };
  // Cloud Run also honors this header for platform auth; setting both is
  // harmless and keeps the user's own Authorization (none here) out of the way.
  headers["x-serverless-authorization"] = `Bearer ${token}`;
  const upReq = https.request({
    hostname: upstream.hostname, port: 443, method: req.method,
    path: req.url, headers,
  }, (up) => {
    res.statusCode = up.statusCode || 502;
    for (const [k, v] of Object.entries(up.headers)) {
      if (k === "transfer-encoding") continue;
      res.setHeader(k, v);
    }
    up.pipe(res);
  });
  upReq.on("error", (err) => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "upstream_unreachable", detail: String(err?.message || err) }));
    }
  });
  req.pipe(upReq);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`✓ Studio proxied at http://localhost:${port}  (Ctrl+C to stop)`);
  console.log(`  token: impersonating ${sa}, refreshed every ~55 min`);
});
