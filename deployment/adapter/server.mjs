#!/usr/bin/env node
// deployment/adapter/server.mjs — Netlify-event ⇄ HTTP compatibility layer.
//
// One image, two modes (same artifact Cloud Run would reuse — doc 05 §3a):
//   node server.mjs api   → mounts every NON-scheduled function on /api/*
//   node server.mjs jobs  → mounts ONLY the 13 scheduled functions behind a
//                           token check (Netlify's schedule block is what keeps
//                           them off the public internet — this reproduces it).
//
// Translation contract (mirrors what the Netlify edge delivers to v1 handlers):
//   event.httpMethod, event.path = "/.netlify/functions/<fn>[/<splat>]"
//     (handlers like discoverability.js and integrations-router.js parse splats
//      off that shape — see their header comments),
//   event.headers (single-valued, comma-joined) + multiValueHeaders,
//   event.queryStringParameters / multiValueQueryStringParameters,
//   event.body as the RAW string (payment-webhook.js verifies Stripe/Razorpay
//     signatures over the unparsed body — never parse before handing it over),
//   event.isBase64Encoded, event.rawUrl, event.rawQuery.
// Response: { statusCode, headers, multiValueHeaders, body, isBase64Encoded }.

import http from "node:http";
import https from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = process.argv[2] === "jobs" ? "jobs" : "api";
const PORT = Number(process.env.PORT || 8080);
const JOBS_TOKEN = process.env.JOBS_TOKEN || "";

const manifestPath = join(HERE, "routes.manifest.json");
if (!existsSync(manifestPath)) {
  console.error("✗ adapter: routes.manifest.json missing — run gen-routes-manifest.mjs (api image build does this)");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const scheduled = new Set(manifest.scheduled);

const fnUrl = (name) => pathToFileURL(resolve(HERE, "..", "netlify", "functions", `${name}.js`));
const names = MODE === "jobs" ? manifest.scheduled : manifest.functions.filter((n) => !scheduled.has(n));

const handlers = {};
const v2handlers = {}; // v2-style: `export default async (req) => Response` (razorpay-sdk is the repo's only one)
for (const name of names) {
  const mod = await import(fnUrl(name).href);
  if (typeof mod.handler === "function") handlers[name] = mod.handler;
  else if (typeof mod.default === "function") v2handlers[name] = mod.default;
  else {
    console.error(`✗ adapter: netlify/functions/${name}.js exports neither handler nor default`);
    process.exit(1);
  }
}
const mounted = Object.keys(handlers).length + Object.keys(v2handlers).length;
console.log(`✓ adapter[${MODE}]: mounted ${mounted} handlers (v1: ${Object.keys(handlers).length}, v2: ${Object.keys(v2handlers).length})`);

// ── request → Netlify event ───────────────────────────────────────────────────
const TEXTUAL = /^(text\/|application\/(json|x-www-form-urlencoded|javascript|xml))/i;

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", rejectBody);
  });
}

function toMulti(rawHeaders) {
  const mv = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const k = rawHeaders[i].toLowerCase();
    (mv[k] = mv[k] || []).push(rawHeaders[i + 1]);
  }
  return mv;
}

// ── /auth/v1/** and /rest/v1/** — PREFIX-STRIPPING PROXY ─────────────────────
// On hosted Supabase, Kong strips /auth/v1 and /rest/v1 before the services
// see the request; the local stack's gateway does the same (gen-gateway-conf
// rewrites ^/auth/v1(/.*)$ $1). Firebase Hosting has no rewrite-transform, so
// it forwards the FULL path — and GoTrue/PostgREST serve at the root, so a
// direct rewrite answers their own 404/401 and sign-in is dead at the edge.
// The api service is already the public, ingress-fronted surface (the same
// role the local gateway plays), so it strips the prefix and proxies onward.
// This is only active when the targets are configured (cloud-sql mode).
const PROXY_TARGETS = [
  { prefix: "/auth/v1", target: process.env.AUTH_PROXY_URL || "" },
  { prefix: "/rest/v1", target: process.env.REST_PROXY_URL || "" },
];

function proxyTo(target, req, res, pathname, search) {
  let upstream;
  try { upstream = new URL(target); } catch { return false; }
  const stripped = pathname.replace(/^(\/auth\/v1|\/rest\/v1)(?=\/|$)/, "") || "/";
  const isHttps = upstream.protocol === "https:";
  const headers = { ...req.headers, host: upstream.host };
  // ⚠️ THE USER'S Authorization HEADER MUST SURVIVE: it carries their
  // Supabase access token, which is what GoTrue/PostgREST authorize against.
  // Cloud Run's platform check reads X-Serverless-Authorization instead, so
  // the OIDC token rides there and never touches the app-facing header. The
  // targets are public today (--allow-unauthenticated); the token is minted
  // best-effort so a future switch to private keeps working. A metadata
  // failure (local runs) simply proxies without it.
  const carryOver = (token) => {
    if (token) headers["x-serverless-authorization"] = `Bearer ${token}`;
    const outReq = (isHttps ? https : http).request({
      hostname: upstream.hostname,
      port: upstream.port || (isHttps ? 443 : 80),
      path: `${stripped}${search}`,
      method: req.method,
      headers,
    }, (up) => {
      res.statusCode = up.statusCode || 502;
      for (const [k, v] of Object.entries(up.headers)) {
        if (k === "transfer-encoding") continue;   // hop-by-hop
        res.setHeader(k, v);
      }
      up.pipe(res);
    });
    outReq.on("error", (err) => {
      console.error(`[adapter] proxy ${pathname} → ${target}: ${err?.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "upstream_unreachable" }));
      }
    });
    req.pipe(outReq);
  };
  // Audience = the upstream origin (Cloud Run validates aud against the service URL).
  fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(upstream.origin)}`, {
    headers: { "Metadata-Flavor": "Google" },
  }).then((r) => (r.ok ? r.text() : ""))
    .catch(() => "")
    .then(carryOver);
  return true;
}

// Resolve /api/... (or legacy /.netlify/functions/...) to { fn, fnPath } using
// the manifest's netlify.toml-derived routes; fall back to <seg0> as the
// function name so newly added functions work without regenerating.
function resolveFunction(pathname) {
  if (pathname === "/api" || pathname === "/api/") return null;
  let m = pathname.match(/^\/\.netlify\/functions\/([^/]+)(\/.*)?$/);
  if (m) return { fn: m[1], fnPath: pathname };
  if (!(m = pathname.match(/^\/api(\/.*)$/))) return null;
  const rest = m[1]; // "/resolve-company", "/v1/keys/123", ...
  for (const r of manifest.routes) {
    const base = r.from.endsWith("/*") ? r.from.slice(0, -2) : r.from; // "/api/v1/*" → "/api/v1"
    if (!r.splat) {
      if (pathname === base) return { fn: r.fn, fnPath: `/.netlify/functions/${r.fn}` };
      continue;
    }
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      const tail = pathname.slice(base.length); // "" or "/keys/123"
      return { fn: r.fn, fnPath: `/.netlify/functions/${r.fn}${tail}` };
    }
  }
  const seg = rest.split("/").filter(Boolean);
  if (!seg.length) return null;
  return { fn: seg[0], fnPath: `/.netlify/functions/${rest.replace(/\/+$/, "")}` };
}

async function invoke(fnName, event) {
  const v1 = handlers[fnName];
  if (v1) {
    const out = await v1(event);
    if (!out || typeof out !== "object") return { statusCode: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "handler returned no response" }) };
    return out;
  }
  const v2 = v2handlers[fnName];
  if (v2) {
    // v2-style: standard Request in, Response out (razorpay-sdk.js). Preserve
    // the raw body exactly — the SDK proxy must not re-encode payloads.
    const url = `${process.env.URL || process.env.PUBLIC_BASE_URL || "http://localhost"}${event.rawUrl?.split(/^https?:\/\/[^/]+/).slice(1).join("") || event.path}`;
    const hasBody = event.body != null;
    const req = new Request(url, {
      method: event.httpMethod,
      headers: event.headers,
      body: hasBody ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body) : undefined,
      ...(hasBody ? { duplex: "half" } : {}),
    });
    const res = await v2(req);
    const buf = Buffer.from(await res.arrayBuffer());
    return { statusCode: res.status, headers: Object.fromEntries(res.headers), body: buf.toString("base64"), isBase64Encoded: true };
  }
  return { statusCode: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: `unknown function "${fnName}"` }) };
}

function applyHeaders(res, out) {
  const put = (k, v) => res.setHeader(k, v);
  for (const [k, v] of Object.entries(out.headers || {})) put(k, v);
  for (const [k, vs] of Object.entries(out.multiValueHeaders || {})) put(k, vs);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (pathname === "/healthz") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ ok: true, mode: MODE, handlers: Object.keys(handlers).length }));
    }
    if (pathname === "/_adapter/info") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ mode: MODE, handlers: Object.keys(handlers).sort(), scheduled: manifest.scheduled }));
    }

    // Jobs mode: every dispatch is token-gated (OIDC stands in for this on GCP).
    // Fail-closed: a jobs service without JOBS_TOKEN refuses to dispatch rather
    // than expose the 13 scheduled functions unauthenticated.
    if (MODE === "jobs" && !JOBS_TOKEN) {
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: "jobs mode requires JOBS_TOKEN — refusing dispatch" }));
    }
    if (MODE === "jobs") {
      const got = req.headers["x-datiq-cron-token"] || String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (got !== JOBS_TOKEN) {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ error: "unauthorized — cron token required" }));
      }
    }

    // Auth/PostgREST prefix-stripping proxy (api mode, cloud-sql wiring only —
    // see PROXY_TARGETS). 503 not 404 when the target env is missing: a
    // misconfigured cutover must look like an outage, not like a route that
    // never existed.
    if (MODE === "api") {
      const hit = PROXY_TARGETS.find((p) => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`));
      if (hit) {
        if (!hit.target) {
          res.statusCode = 503;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify({ error: `${hit.prefix} proxy is not configured (AUTH_PROXY_URL/REST_PROXY_URL unset)` }));
        }
        return proxyTo(hit.target, req, res, pathname, url.search);
      }
    }

    // Cloud Scheduler stand-in route: POST /run/<name> (jobs mode only).
    let target = resolveFunction(pathname);
    const runMatch = MODE === "jobs" ? pathname.match(/^\/run\/([^/]+)$/) : null;
    if (runMatch) {
      const name = runMatch[1];
      if (!handlers[name] && !v2handlers[name]) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ error: `no scheduled function "${name}"` }));
      }
      target = { fn: name, fnPath: `/.netlify/functions/${name}` };
    }

    if (!target || (!handlers[target.fn] && !v2handlers[target.fn])) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: `no function for ${pathname}` }));
    }
    if (MODE === "api" && scheduled.has(target.fn)) {
      // Parity: on Netlify, scheduled functions are not publicly invokable.
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ error: "scheduled function — invoke via the jobs service" }));
    }

    const raw = await readBody(req);
    const ct = req.headers["content-type"] || "";
    const isText = !ct || TEXTUAL.test(ct);
    const mvHeaders = toMulti(req.rawHeaders);
    const headers = {};
    for (const [k, vs] of Object.entries(mvHeaders)) headers[k] = vs.join(", ");
    const multiQuery = {};
    for (const [k, v] of url.searchParams) (multiQuery[k] = multiQuery[k] || []).push(v);
    const singleQuery = {};
    for (const [k, v] of Object.entries(multiQuery)) singleQuery[k] = v[v.length - 1];

    const event = {
      httpMethod: req.method,
      path: target.fnPath,
      headers,
      multiValueHeaders: mvHeaders,
      queryStringParameters: singleQuery,
      multiValueQueryStringParameters: multiQuery,
      rawQuery: url.search.replace(/^\?/, ""),
      rawUrl: `${process.env.URL || process.env.PUBLIC_BASE_URL || "http://localhost"}${req.url}`,
      body: raw.length ? (isText ? raw.toString("utf8") : raw.toString("base64")) : null,
      isBase64Encoded: raw.length > 0 && !isText,
    };

    const out = await invoke(target.fn, event);
    res.statusCode = out.statusCode || 200;
    applyHeaders(res, out);
    const body = out.body == null ? "" : out.isBase64Encoded ? Buffer.from(out.body, "base64") : String(out.body);
    return res.end(body);
  } catch (err) {
    console.error(`[adapter] ${req.method} ${pathname} → 500:`, err?.stack || err);
    if (!res.headersSent) res.statusCode = 500;
    if (!res.writableEnded) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "internal_error", detail: String(err?.message || err) }));
    }
  }
});

server.requestTimeout = 0; // extractions run long locally; Lambda caps do not apply here
server.headersTimeout = 60_000;
server.keepAliveTimeout = 75_000;
server.listen(PORT, () => console.log(`✓ adapter[${MODE}] listening on :${PORT}`));

process.on("unhandledRejection", (err) => console.error("[adapter] unhandledRejection:", err?.stack || err));
