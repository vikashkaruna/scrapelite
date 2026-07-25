#!/usr/bin/env node
// audit.mjs — deterministic release-readiness audit for DatIQ.
//
//   node .claude/skills/production-readiness/scripts/audit.mjs [--json] [--fix-emails]
//
// Turns "review everything for production" into a concrete PASS/WARN/FAIL
// worklist that is identical on every model. Zero dependencies (Node built-ins).
// Exit code is non-zero if any check FAILs, so it can gate CI directly.
//
// ── Reusing on another project ──────────────────────────────────────────────
// Everything project-specific lives in the CONFIG block below. Edit it (paths,
// the canonical support email, the confidential/admin term list, personas,
// competitors) and the rest of the skill carries over unchanged.

import {
  readFileSync, readdirSync, existsSync, statSync, writeFileSync,
} from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..", ".."); // repo root

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — the only project-specific part.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // DatIQ runs exactly two customer-facing inboxes. Anything else is deprecated.
  //   hello@ — product support, bugs, features, billing, general
  //   admin@ — enterprise/agency, legal & terms, privacy & DPDP
  supportEmail: "hello@datiq.app",
  adminEmail: "admin@datiq.app",
  customerEmails: ["hello@datiq.app", "admin@datiq.app"],
  // Deprecated address → the inbox it now belongs to (used by --fix-emails).
  deprecatedEmailMap: {
    "support@datiq.app": "hello@datiq.app",
    "legal@datiq.app":   "admin@datiq.app",
    "privacy@datiq.app": "admin@datiq.app",
  },
  // Senders that are system-only (not a customer contact) — never flagged.
  ignoreEmails: ["alerts@datiq.app", "noreply@datiq.app"],

  // Tokens that must NEVER appear on a customer-facing surface. These are
  // unambiguous internal/admin markers — kept specific to avoid false positives
  // (e.g. "administrator" in a privacy policy is fine; "admin console" is not).
  confidentialTerms: [
    "admin console", "admin panel", "admin dashboard", "admin module",
    "/admin", "ADMIN_PIN", "ADMIN_TOKEN", "HMAC", "SUPABASE_SERVICE",
    "service_role", "SERVICE_KEY", "pricing_config", "app_config",
    "RLS policy", "row level security", "PIN-gated", "PIN gate",
  ],

  // Customer-facing surfaces. Walked recursively; only these files are scanned
  // for confidential leakage.
  externalGlobs: [
    "public/help",              // generated help center
    "public/vs",                // comparison pages
    "public/llms.txt",
    "public/dmca.html",
    "public/index.html",
    "docs/DatIQ-User-Guide.md", // public help source
    "docs/DatIQ-Developer-API.md",
  ],
  // Individual React page files that render public pages (admin dir excluded).
  externalPages: [
    "src/pages/Home.jsx", "src/pages/Blog.jsx", "src/pages/Changelog.jsx",
    "src/pages/About.jsx", "src/pages/Pricing.jsx", "src/pages/Contact.jsx",
    "src/pages/Privacy.jsx", "src/pages/Terms.jsx", "src/pages/Integrations.jsx",
    "src/pages/UseCases.jsx", "src/pages/UseCaseLead.jsx",
    "src/pages/UseCaseCompetitor.jsx", "src/pages/UseCaseSEO.jsx",
    "src/pages/UseCaseResearch.jsx", "src/pages/VsBrowseAI.jsx",
    "src/pages/VsClay.jsx", "src/pages/Gallery.jsx", "src/pages/PublicReport.jsx",
    "src/components/PricingMatrix.jsx", "src/components/TrustStrip.jsx",
  ],
  // Where customer emails may appear and get --fix-emails treatment. Includes
  // netlify functions because their error strings are shown to customers.
  emailFixRoots: ["src", "public", "netlify"],
  // Individual customer-facing files outside those roots (the SEO JSON-LD block
  // in index.html and the published API doc both print a contact address).
  emailFixFiles: ["index.html", "docs/DatIQ-Developer-API.md", "docs/DatIQ-User-Guide.md"],

  // Source of truth + derived surfaces for other checks.
  pricingSource: "src/lib/pricingConfig.js",
  personaSource: "src/lib/personaConfig.js",
  changelogSource: "src/pages/Changelog.jsx",
  blogSource: "src/pages/Blog.jsx",
  helpBillingPage: "public/help/11-plans-usage-and-billing.html",
  helpIndex: "public/help/index.html",
  helpMarkdown: ["docs/DatIQ-User-Guide.md", "docs/DatIQ-Developer-API.md"],
  screenshotsDir: "docs/assets/screenshots",
  uiSourceDirs: ["src/pages", "src/components"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const FIX_EMAILS = args.includes("--fix-emails");
const abs = (p) => join(ROOT, p);
const read = (p) => readFileSync(abs(p), "utf8");
const rel = (p) => relative(ROOT, p);

function walk(dir, exts = null) {
  const out = [];
  const full = abs(dir);
  if (!existsSync(full)) return out;
  if (statSync(full).isFile()) return [full];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(full, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel(p), exts));
    else if (!exts || exts.includes(extname(entry.name))) out.push(p);
  }
  return out;
}

function gitCommitTime(path) {
  try {
    const t = execSync(`git log -1 --format=%ct -- "${path}"`, {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return t ? Number(t) * 1000 : null;
  } catch { return null; }
}
function newestCommitTime(paths) {
  let newest = 0;
  for (const p of paths) {
    const t = gitCommitTime(rel(p));
    if (t && t > newest) newest = t;
  }
  return newest || null;
}

const results = [];
const record = (name, status, details) => results.push({ name, status, details });

// ─────────────────────────────────────────────────────────────────────────────
// Check 1 — Admin / confidential leakage on external surfaces (FAIL)
// ─────────────────────────────────────────────────────────────────────────────
function checkConfidentialLeakage() {
  const files = [
    ...CONFIG.externalGlobs.flatMap((g) => walk(g, [".html", ".md", ".txt"])),
    ...CONFIG.externalPages.map(abs).filter(existsSync),
  ];
  const hits = [];
  const lowerTerms = CONFIG.confidentialTerms.map((t) => t.toLowerCase());
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const low = line.toLowerCase();
      for (let t = 0; t < lowerTerms.length; t++) {
        if (low.includes(lowerTerms[t])) {
          hits.push(`${rel(f)}:${i + 1}  →  "${CONFIG.confidentialTerms[t]}"`);
        }
      }
    });
  }
  if (hits.length) {
    record("Admin/confidential leakage", "FAIL",
      `Internal-only terms found on customer-facing surfaces (remove them):\n    ` +
      hits.join("\n    "));
  } else {
    record("Admin/confidential leakage", "PASS",
      `No confidential terms on ${files.length} external surfaces.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 2 — Customer email consolidation (FAIL, --fix-emails auto-resolves)
// ─────────────────────────────────────────────────────────────────────────────
// Test files legitimately name the retired addresses — that is how they assert
// the addresses are gone. They never ship, so they are not a customer surface.
const isTestFile = (f) => /\.(test|spec)\.[jt]sx?$/.test(f) || /__tests__/.test(f);

function scanEmails() {
  const files = [
    ...CONFIG.emailFixRoots.flatMap((r) =>
      walk(r, [".js", ".jsx", ".ts", ".tsx", ".html", ".txt", ".md"])),
    ...CONFIG.emailFixFiles.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
  ].filter((f) => !isTestFile(f));
  const deprecated = Object.keys(CONFIG.deprecatedEmailMap);
  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const dep of deprecated) {
      if (text.includes(dep)) hits.push({ file: f, email: dep });
    }
  }
  return { files, hits };
}
function checkEmails() {
  const inboxes = CONFIG.customerEmails.join(" + ");
  let { hits } = scanEmails();
  if (FIX_EMAILS && hits.length) {
    const touched = new Set();
    for (const { file } of hits) {
      if (touched.has(file)) continue;
      touched.add(file);
      let text = readFileSync(file, "utf8");
      // Each deprecated address maps to the inbox that now owns it, so legal@
      // and privacy@ land on admin@ rather than being flattened into hello@.
      for (const [dep, replacement] of Object.entries(CONFIG.deprecatedEmailMap)) {
        text = text.split(dep).join(replacement);
      }
      writeFileSync(file, text);
    }
    hits = scanEmails().hits; // re-scan
    record("Customer email consolidation", hits.length ? "FAIL" : "PASS",
      hits.length
        ? `Still found after fix: ${hits.map((h) => rel(h.file)).join(", ")}`
        : `Fixed ${touched.size} file(s); all customer emails are ${inboxes}.`);
    return;
  }
  if (hits.length) {
    const byFile = [...new Set(hits.map((h) => rel(h.file)))];
    record("Customer email consolidation", "FAIL",
      `Deprecated support addresses still present (run with --fix-emails):\n    ` +
      byFile.join("\n    "));
  } else {
    record("Customer email consolidation", "PASS",
      `All customer contact points use ${inboxes}.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3 — Help build drift (WARN)
// ─────────────────────────────────────────────────────────────────────────────
function checkHelpDrift() {
  if (!existsSync(abs(CONFIG.helpIndex))) {
    record("Help build freshness", "WARN", "public/help not generated yet — run node docs/build-help.mjs.");
    return;
  }
  const srcT = newestCommitTime(CONFIG.helpMarkdown.map(abs).filter(existsSync));
  const outT = newestCommitTime(walk("public/help", [".html"]));
  if (srcT && outT && srcT > outT) {
    record("Help build freshness", "WARN",
      "Help markdown changed after the last help build. Run: node docs/build-help.mjs");
  } else {
    record("Help build freshness", "PASS", "public/help is at or newer than its markdown sources.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4 — Screenshot integrity (FAIL on broken ref, WARN on staleness)
// ─────────────────────────────────────────────────────────────────────────────
function checkScreenshots() {
  const refFiles = [...walk("public/help", [".html"]), ...CONFIG.helpMarkdown.map(abs).filter(existsSync)];
  const missing = [];
  const re = /(?:src=["']|\]\()([^"')]*(?:screenshots|assets)\/[^"')]+\.(?:png|jpg|jpeg|webp))/gi;
  for (const f of refFiles) {
    const text = readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(text))) {
      const refPath = m[1].split(/[?#]/)[0];
      const candidate = refPath.startsWith("/")
        ? join(ROOT, "public", refPath)
        : join(dirname(f), refPath);
      if (!existsSync(candidate)) missing.push(`${rel(f)}  →  ${refPath}`);
    }
  }
  if (missing.length) {
    record("Screenshot integrity", "FAIL",
      "Referenced screenshots do not resolve:\n    " + missing.join("\n    "));
    return;
  }
  const shotsT = newestCommitTime(walk(CONFIG.screenshotsDir, [".png", ".jpg", ".jpeg", ".webp"]));
  const uiT = newestCommitTime(CONFIG.uiSourceDirs.flatMap((d) => walk(d, [".jsx", ".tsx", ".css"])));
  if (shotsT && uiT && uiT > shotsT) {
    record("Screenshot integrity", "WARN",
      "UI source changed after the newest screenshot — regenerate: node docs/capture-screenshots.mjs");
  } else {
    record("Screenshot integrity", "PASS", "All referenced screenshots exist and are current.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 5 — Version coherence (WARN)
// ─────────────────────────────────────────────────────────────────────────────
function checkVersion() {
  let version = null;
  try {
    const m = read(CONFIG.changelogSource).match(/const\s+VERSION\s*=\s*["'`]([^"'`]+)/);
    version = m && m[1];
  } catch { /* ignore */ }
  if (!version) {
    record("Version coherence", "WARN", "Could not read VERSION from the changelog.");
    return;
  }
  const needle = version.toLowerCase();
  const inDocs = CONFIG.helpMarkdown.some((p) => existsSync(abs(p)) && read(p).toLowerCase().includes(needle));
  record("Version coherence", inDocs ? "PASS" : "WARN",
    inDocs
      ? `Changelog VERSION ${version} is referenced in the public docs.`
      : `Changelog VERSION ${version} is not referenced in the public docs/help — confirm the release version is consistent everywhere.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 6 — Pricing coherence (WARN)
// ─────────────────────────────────────────────────────────────────────────────
function checkPricing() {
  if (!existsSync(abs(CONFIG.pricingSource)) || !existsSync(abs(CONFIG.helpBillingPage))) {
    record("Pricing coherence", "WARN", "Pricing source or help billing page missing — verify manually.");
    return;
  }
  const src = read(CONFIG.pricingSource);
  // Only sellable, single-word plan names. Skip coming-soon plans (not expected
  // on the billing page yet) and the Free tier.
  const names = [...src.matchAll(/name:\s*["'`]([A-Z][a-zA-Z]+)["'`]/g)]
    .filter((m) => !/comingSoon:\s*true/.test(src.slice(m.index, m.index + 400)))
    .map((m) => m[1]);
  const uniq = [...new Set(names)].filter((n) => !["Free"].includes(n));
  const billing = read(CONFIG.helpBillingPage);
  const missing = uniq.filter((n) => !billing.includes(n));
  record("Pricing coherence", missing.length ? "WARN" : "PASS",
    missing.length
      ? `Plan(s) not mentioned on the help billing page: ${missing.join(", ")} — confirm pricing surfaces agree with ${CONFIG.pricingSource}.`
      : `Plan names on the help billing page match ${CONFIG.pricingSource}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 7 — Gallery / persona coverage (WARN — advisory, not statically provable)
// ─────────────────────────────────────────────────────────────────────────────
function checkPersonaGallery() {
  let personaCount = 0;
  try {
    const p = read(CONFIG.personaSource);
    personaCount = (p.match(/id:\s*["'`]/g) || []).length;
  } catch { /* ignore */ }
  record("Gallery / persona coverage", "WARN",
    `${personaCount || "?"} personas defined. The public gallery is populated at ` +
    `runtime (Supabase public_reports), so coverage can't be proven from source. ` +
    `Manually confirm the gallery has ≥1 curated sample per persona and per ` +
    `headline feature — see references/content-playbooks.md § Gallery.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
checkConfidentialLeakage();
checkEmails();
checkHelpDrift();
checkScreenshots();
checkVersion();
checkPricing();
checkPersonaGallery();

const fails = results.filter((r) => r.status === "FAIL");
const warns = results.filter((r) => r.status === "WARN");

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: fails.length === 0,
    summary: { pass: results.length - fails.length - warns.length, warn: warns.length, fail: fails.length },
    results,
  }, null, 2));
} else {
  const icon = { PASS: "✅", WARN: "⚠️ ", FAIL: "❌" };
  console.log("\n  DatIQ release-readiness audit\n  " + "─".repeat(50));
  for (const r of results) {
    console.log(`\n  ${icon[r.status]} ${r.name}`);
    console.log("     " + r.details.replace(/\n/g, "\n     "));
  }
  console.log("\n  " + "─".repeat(50));
  console.log(`  ${results.length - fails.length - warns.length} pass · ${warns.length} warn · ${fails.length} fail`);
  console.log(fails.length
    ? "  ❌ NOT release-ready — resolve every FAIL before promoting.\n"
    : "  ✅ No blockers. Resolve/annotate WARNs, then promote per merge-and-deploy.md.\n");
}

process.exit(fails.length ? 1 : 0);
