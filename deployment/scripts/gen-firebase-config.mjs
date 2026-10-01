// gen-firebase-config.mjs — renders firebase.json + .firebaserc from the repo's
// routing sources of truth. Zero site-specific literals (doc 06 §1): every
// project id, site id, service name and region comes from the .env file.
//
//   node gen-firebase-config.mjs \
//     --toml  netlify.toml \
//     --env   deployment/env/.env.staging \
//     --out   deployment/generated/gcp
//
// Sources of truth and what is taken from each:
//   netlify.toml [[redirects]]  → 301/302 redirects (exact + single-segment
//                                 splats map 1:1 to Firebase redirect globs);
//                                 the status-200 rules become Hosting rewrites.
//   netlify.toml [[headers]]    → response header rules (glob-mapped).
//   .env.<env>                  → GCP_PROJECT_ID, FHS_SITE_ID, CLOUD_RUN_*,
//                                 GCP_REGION, DATA_MODE.
//
// The static/dynamic split (doc 05 §3a): dist/ deploys to Firebase Hosting as
// static files; only /api/** gets a Cloud Run rewrite. While DATA_MODE is
// hosted-supabase the frontend calls the hosted Supabase project URL directly
// (public/runtime-config.js), so NO /auth/v1 or /rest/v1 rewrites are emitted —
// they appear only in cloud-sql mode (post-cutover), pointing at the Cloud Run
// GoTrue/PostgREST services.
//
// The homepage: the deploy payload REPLACES dist/index.html with the
// prerendered home (deploy-hosting.sh) and ships the SPA shell as
// /__shell/index.html — so `/` is served as a real file (netlify.toml's forced
// `/` rule outcome) and /__shell/index.html backs the SPA fallback rewrite.
// Firebase rewrites never override a real file, which is why the swap happens
// in the payload rather than as a rewrite.

import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

// The repo's routing source of truth — provides the full page list so every
// extensionless URL gets an explicit rewrite (Firebase would otherwise 301
// directory-form URLs to a trailing slash, which Netlify never did).
const { REACT_OWNED, STATIC_OWNED, HELP_INDEX, generatedFileFor } = await import(
  `file://${process.env.SITE_ROUTES_FILE || resolve(REPO, "scripts", "site-routes.mjs")}`
);

function argOf(k, d) {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
}

/** Minimal .env parser: KEY=VALUE lines, # comments, ${VAR} interpolation. */
export function parseEnvFile(text) {
  const raw = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in raw)) raw[key] = val; // first definition wins (matches bash sourcing)
  }
  // ${VAR} references resolve against values defined earlier in the file.
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v.replace(/\$\{([A-Z_0-9]+)\}/g, (_, ref) => out[ref] ?? raw[ref] ?? "");
  }
  return out;
}

/** Parse netlify.toml's [[redirects]] and [[headers]] blocks. */
export function parseNetlifyToml(toml) {
  const redirects = [];
  for (const block of toml.split(/\[\[redirects\]\]/).slice(1)) {
    const pick = (key) => {
      const m = new RegExp(`^\\s*${key}\\s*=\\s*(?:"([^"]*)"|([^\\s#\\[]+))`, "m").exec(block);
      return m ? (m[1] ?? m[2] ?? "").trim() : "";
    };
    const from = pick("from");
    const to = pick("to");
    const status = Number(pick("status") || "301");
    if (from && to) redirects.push({ from, to, status });
  }

  const headers = [];
  for (const block of toml.split(/\[\[headers\]\]/).slice(1)) {
    const forMatch = /^\s*for\s*=\s*"([^"]+)"/m.exec(block);
    if (!forMatch) continue;
    const values = {};
    const valuesBlock = /\[headers\.values\]([\s\S]*?)(\n\[\[|\n# ──|$)/.exec(block);
    const body = valuesBlock ? valuesBlock[1] : block;
    for (const m of body.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
      values[m[1]] = m[2];
    }
    if (Object.keys(values).length) headers.push({ for: forMatch[1], values });
  }
  return { redirects, headers };
}

/**
 * Build the firebase.json hosting object from parsed netlify.toml + env values.
 * Exported pure so the unit tests can drive it without touching the CLI flags.
 */
export function buildHosting({ redirects, headers }, env) {
  const required = [
    "GCP_PROJECT_ID", "FHS_SITE_ID", "GCP_REGION",
    "CLOUD_RUN_API", "CLOUD_RUN_ADMIN", "DATA_MODE",
  ];
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`gen-firebase-config: missing env vars: ${missing.join(", ")}`);

  const run = (serviceId) => ({ run: { serviceId, region: env.GCP_REGION } });

  // ── redirects: keep 3xx rules only. Netlify status-200 rules either target
  // /.netlify/functions/* (subsumed by the /api/** Cloud Run rewrite) or are the
  // two structural rewrites (/ and /*) handled below.
  const fbRedirects = redirects
    .filter((r) => r.status !== 200)
    .map((r) => ({ source: r.from, destination: r.to, type: r.status }));

  // ── rewrites, in precedence order ──────────────────────────────────────────
  const rewrites = [
    // The entire dynamic API surface → one Cloud Run service (doc 05 §3a).
    { source: "/api/**", ...run(env.CLOUD_RUN_API) },
  ];
  if (env.DATA_MODE === "cloud-sql") {
    // Post-cutover only: the self-hosted trio moves behind the same origin.
    // While DATA_MODE=hosted-supabase the frontend talks to the hosted project
    // URL directly (public/runtime-config.js), so these must NOT exist yet.
    //
    // ⚠️ BOTH PREFIXES ROUTE TO THE **API** SERVICE, NOT AUTH/REST DIRECTLY.
    // Firebase rewrites pass the FULL path through (no transform), but GoTrue
    // and PostgREST serve at the root — Kong/hosted strips /auth/v1 before
    // they see it, and the local gateway mirrors that with `rewrite ^/auth/v1`.
    // A direct rewrite therefore answers GoTrue's own 404 and sign-in dies at
    // the edge (found live 2026-10-01). The api adapter now performs the
    // strip-and-proxy, so Hosting only needs one hop it already supports.
    rewrites.push(
      { source: "/auth/v1/**", ...run(env.CLOUD_RUN_API || "UNSET_CLOUD_RUN_API") },
      { source: "/rest/v1/**", ...run(env.CLOUD_RUN_API || "UNSET_CLOUD_RUN_API") },
    );
  }
  // ── static pages, extensionless form → their document ─────────────────────
  // One exact rewrite per route (belt-and-suspenders: Hosting resolves
  // directory indexes natively, but an explicit rewrite documents the intent
  // and guards against resolution differences). "/" is NOT here: the deploy
  // payload REPLACES dist/index.html with the prerendered home
  // (deploy-hosting.sh), so `/` is served as a real file — the same outcome
  // netlify.toml's forced rewrite produced, without relying on rewrite
  // precedence.
  for (const route of [...REACT_OWNED, ...STATIC_OWNED, HELP_INDEX]) {
    if (route.path === "/") continue;
    const source = route.path.replace(/\/+$/, "") || "/";
    rewrites.push({ source, destination: `/${route.file || generatedFileFor(route.path)}` });
  }
  // Admin surface keeps its own container (doc 05 §3a); assets still resolve to
  // the static payload because /assets/** has real files.
  rewrites.push({ source: "/admin", ...run(env.CLOUD_RUN_ADMIN) });
  rewrites.push({ source: "/admin/**", ...run(env.CLOUD_RUN_ADMIN) });
  // SPA fallback (netlify.toml's non-forced `/*` → /index.html): real files
  // always win on Firebase, matching Netlify's no-force behaviour. The shell
  // ships at /__shell/index.html because dist/index.html IS the prerendered
  // home (see above).
  rewrites.push({ source: "/**", destination: "/__shell/index.html" });

  // ── headers: netlify `for` globs → Firebase globs (`/x/*` → `/x/**`) ───────
  const byGlob = new Map();
  for (const h of headers) {
    const glob = h.for === "/*" ? "/**" : h.for.replace(/\/\*$/, "/**");
    const bucket = byGlob.get(glob) ?? {};
    byGlob.set(glob, { ...bucket, ...h.values });
  }
  const fbHeaders = [...byGlob.entries()].map(([source, values]) => ({
    source,
    headers: Object.entries(values).map(([key, value]) => ({ key, value })),
  }));

  return {
    hosting: {
      site: env.FHS_SITE_ID,
      public: "dist",
      // Netlify parity for URL form: Netlify served extensionless URLs
      // (/pricing) with 200 and never forced a slash. Firebase's DEFAULT
      // behaviour 301s /pricing → /pricing/ when pricing/index.html exists —
      // and that redirect fires BEFORE rewrites, so no rewrite can prevent
      // it. trailingSlash:false removes the slash-adding redirect (the
      // slash-form 301s back to the extensionless form, one canonical per
      // page — stricter than Netlify, which served both 200).
      trailingSlash: false,
      // dist/index.html is REPLACED by the prerendered home before upload
      // (deploy-hosting.sh) so `/` serves real content; the SPA shell ships
      // as /__shell/index.html and backs the /** rewrite.
      ignore: ["firebase.json", "**/.*", "**/node_modules/**"],
      redirects: fbRedirects,
      rewrites,
      headers: fbHeaders,
    },
  };
}

export function buildFirebaserc(env) {
  if (!env.GCP_PROJECT_ID) throw new Error("gen-firebase-config: missing GCP_PROJECT_ID");
  return { projects: { default: env.GCP_PROJECT_ID } };
}

const main = () => {
  const tomlPath = resolve(argOf("--toml", resolve(REPO, "netlify.toml")));
  const envPath = resolve(argOf("--env", resolve(REPO, "deployment/env/.env.staging")));
  const outDir = resolve(argOf("--out", resolve(REPO, "deployment/generated/gcp")));

  const parsed = parseNetlifyToml(readFileSync(tomlPath, "utf8"));
  const env = parseEnvFile(readFileSync(envPath, "utf8"));

  const config = buildHosting(parsed, env);
  // "public" resolves relative to the directory holding firebase.json — point
  // it at the repo's dist/ from wherever --out lands.
  const distDir = resolve(argOf("--dist", resolve(REPO, "dist")));
  config.hosting.public = relative(outDir, distDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "firebase.json"), JSON.stringify(config, null, 2) + "\n");
  writeFileSync(resolve(outDir, ".firebaserc"), JSON.stringify(buildFirebaserc(env), null, 2) + "\n");

  const h = config.hosting;
  console.log(
    `✓ gen-firebase-config: ${h.redirects.length} redirects, ${h.rewrites.length} rewrites, ` +
    `${h.headers.length} header rules, site ${h.site}, DATA_MODE=${env.DATA_MODE} → ${outDir}`,
  );
};

// Only run when invoked directly (tests import the pure builders).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
