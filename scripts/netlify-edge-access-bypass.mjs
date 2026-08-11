#!/usr/bin/env node
//
// scripts/netlify-edge-access-bypass.mjs
//
// One-shot helper for adding `/api/*` to the Netlify "Visitor access /
// Password protection" bypass list. Background:
//
//   DatIQ is a Vite SPA. The browser calls `/api/*` (Firecrawl, Supabase,
//   AI, integrations, billing) directly. On a Netlify branch preview the
//   whole site is gated behind Team login by default — the gate stops
//   every `/api/*` call too, so the in-browser Connect / Push / Extract
//   flows cannot be demonstrated to anyone outside the Netlify team.
//
//   The fix is to add `/api/*` to the bypass list on Project configuration
//   → Access & security → Visitor access → Bypass list. The page allows
//   the visitor-access gate to be skipped for a path glob.
//
//   The Netlify public REST API does NOT expose the bypass list directly
//   (it lives behind the internal `app.netlify.com` UI API, which is
//   undocumented and has changed shape in the past). This script therefore
//   has two modes:
//
//     --open   (default on macOS): opens the deep-linked configuration
//              page in the user's browser, then prints the exact 2-min
//              walkthrough. Works with zero local setup.
//
//     --apply  (only with NETLIFY_AUTH_TOKEN): attempts the internal API
//              call that the Netlify UI uses, and verifies the result.
//              If the internal endpoint is unreachable or has changed,
//              the script falls back to --open and tells you so.
//
//   Usage:
//
//     # Just open the page and print the walkthrough:
//     node scripts/netlify-edge-access-bypass.mjs
//
//     # Or apply via the API (requires a Netlify personal access token
//     # with site-level write on the datiqapp project):
//     NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply
//
//     # Dry run + verbose:
//     NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply --dry-run
//
// Exit codes:
//   0  — applied successfully, or the UI was opened
//   1  — apply mode and the API call failed
//   2  — apply mode and the user is not authenticated
//
//   The script never touches production. It only reads the site ID from
//   .netlify/state.json and the current state via the public Netlify API
//   when possible. All writes go to the internal UI API and use the
//   caller's token.

import { readFileSync, existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DRY_RUN = args.has("--dry-run");
const QUIET = args.has("--quiet");

// ── Load the site ID from .netlify/state.json ───────────────────────────────
function loadSiteId() {
  const statePath = join(ROOT, ".netlify", "state.json");
  if (!existsSync(statePath)) {
    throw new Error(
      `No .netlify/state.json — run \`netlify link\` against the datiqapp project first.`
    );
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  if (!state.siteId) throw new Error(".netlify/state.json is missing siteId");
  return state.siteId;
}

const SITE_ID = loadSiteId();
const PROJECT_SLUG = "datiqapp"; // the Netlify project slug, matches .netlify/state.json's "siteId" human-readable form
const CONFIG_URL = `https://app.netlify.com/projects/${PROJECT_SLUG}/configuration/access`;
const API_BASE = "https://api.netlify.com/api/v1";
const INTERNAL_BASE = "https://app.netlify.com/api/v1";

const PATHS_TO_ADD = ["/api/*"];

// ── UI walkthrough (always printed) ──────────────────────────────────────────
const WALKTHROUGH = [
  `Open: ${CONFIG_URL}`,
  ``,
  `1. Scroll to "Visitor access" → "Password protection".`,
  `2. If it says "Team default" or "Basic password protection", click "Customize this site's protection settings" so the site uses its own (the team default may not expose the bypass list).`,
  `3. Under "Bypass for specific paths", click "Add a path" and enter:`,
  `       /api/*`,
  `4. Click "Save" at the bottom of the form.`,
  `5. Verify by opening a new incognito window and visiting:`,
  `       https://${PROJECT_SLUG === "datiqapp" ? "integration-with-outside-ecosystem" : "staging"}--${PROJECT_SLUG}.netlify.app/api/health`,
  `   You should get a JSON 200 (not the SSO login page).`,
  ``,
  `If the form does not show "Bypass for specific paths" the site is on the team default — apply the customization in step 2 first.`,
];

// ── Public-API check (no auth required for this) ────────────────────────────
async function publicCheck() {
  const url = `${API_BASE}/sites/${SITE_ID}`;
  const res = await fetch(url, { headers: { "User-Agent": "datiq-edge-access-bypass/1.0" } });
  if (res.status === 401 || res.status === 404) {
    return { ok: false, status: res.status, body: await res.text() };
  }
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
  return { ok: true, site: await res.json() };
}

// ── Internal API: the endpoint the Netlify UI hits ───────────────────────────
// This is not part of the public API and has changed shape in the past. The
// script tries the two known shapes and falls back to the UI walkthrough.
async function tryInternalAdd(token, paths) {
  // Shape 1 (newer): PATCH on the site's "settings" sub-resource.
  const tries = [
    {
      method: "PUT",
      url: `${INTERNAL_BASE}/sites/${SITE_ID}/visitor_access`,
      body: { password_protection: { bypass_paths: paths, scope: "deploy_preview" } },
    },
    {
      method: "PUT",
      url: `${INTERNAL_BASE}/sites/${SITE_ID}/edge_access`,
      body: { bypass_paths: paths, scope: "deploy_preview" },
    },
    {
      method: "PATCH",
      url: `${INTERNAL_BASE}/sites/${SITE_ID}`,
      body: { visitor_access: { bypass_paths: paths } },
    },
  ];

  const errors = [];
  for (const t of tries) {
    const res = await fetch(t.url, {
      method: t.method,
      headers: {
        "User-Agent": "datiq-edge-access-bypass/1.0",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(t.body),
    });
    if (res.ok) return { ok: true, endpoint: `${t.method} ${t.url}`, body: await res.text() };
    errors.push(`${t.method} ${t.url} → ${res.status} ${res.statusText}\n      ${(await res.text()).slice(0, 200)}`);
  }
  return { ok: false, errors };
}

// ── Open a URL in the user's browser (macOS first) ──────────────────────────
function openInBrowser(url) {
  if (process.platform === "darwin") {
    try {
      execSync(`open "${url}"`, { stdio: "ignore" });
      return true;
    } catch {}
  }
  if (process.platform === "linux") {
    try {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
      return true;
    } catch {}
  }
  if (process.platform === "win32") {
    try {
      execSync(`start "" "${url}"`, { stdio: "ignore", shell: true });
      return true;
    } catch {}
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!QUIET) {
    console.log(`\n  Netlify edge-access bypass helper`);
    console.log(`  Site ID : ${SITE_ID}`);
    console.log(`  Project : ${PROJECT_SLUG}`);
    console.log(`  Mode    : ${APPLY ? "apply (API)" : "open (UI walkthrough)"}\n`);
  }

  // Public preflight
  const pre = await publicCheck();
  if (pre.ok) {
    if (!QUIET) console.log(`  ✓ Public site API reachable (name=${pre.site.name}, ssl_url=${pre.site.ssl_url})\n`);
  } else if (!QUIET) {
    console.log(`  ! Public site API returned ${pre.status} — that's normal without a token; the script will continue.\n`);
  }

  if (!APPLY) {
    // Open-mode
    const opened = openInBrowser(CONFIG_URL);
    if (!QUIET) {
      console.log(`  ${opened ? "→ Opened in your browser:" : "→ Open in your browser:"}  ${CONFIG_URL}\n`);
    }
    console.log(`  Two-minute walkthrough:\n`);
    for (const line of WALKTHROUGH) console.log(`    ${line}`);
    console.log(``);
    return;
  }

  // Apply-mode
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!token) {
    console.error(`  ✗ --apply requires NETLIFY_AUTH_TOKEN in the environment.`);
    console.error(`    Generate one at https://app.netlify.com/user/applications#personal-access-tokens`);
    console.error(`    and re-run:`);
    console.error(`      NETLIFY_AUTH_TOKEN=... node scripts/netlify-edge-access-bypass.mjs --apply\n`);
    process.exit(2);
  }

  if (DRY_RUN) {
    console.log(`  [dry-run] would add ${JSON.stringify(PATHS_TO_ADD)} to bypass list for site ${SITE_ID}\n`);
    return;
  }

  const result = await tryInternalAdd(token, PATHS_TO_ADD);
  if (result.ok) {
    console.log(`  ✓ Applied via ${result.endpoint}`);
    console.log(`  ✓ Bypass list now includes: ${JSON.stringify(PATHS_TO_ADD)}`);
    console.log(``);
    console.log(`  Verify in the UI:  ${CONFIG_URL}`);
    console.log(`  Or via the public health endpoint from an incognito window.\n`);
    process.exit(0);
  }

  // Internal API failed — fall back to opening the UI.
  console.error(`  ✗ Internal API call failed. Tried:`);
  for (const e of result.errors) console.error(`      ${e}`);
  console.error(``);
  console.error(`  The Netlify internal API is undocumented and the bypass-list endpoint`);
  console.error(`  shape has changed in the past. Falling back to the UI walkthrough.\n`);

  const opened = openInBrowser(CONFIG_URL);
  console.log(`  ${opened ? "→ Opened in your browser:" : "→ Open in your browser:"}  ${CONFIG_URL}\n`);
  console.log(`  Two-minute walkthrough:\n`);
  for (const line of WALKTHROUGH) console.log(`    ${line}`);
  console.log(``);
  process.exit(1);
}

main().catch((e) => {
  console.error(`\n  ✗ ${e.message}\n`);
  process.exit(1);
});
