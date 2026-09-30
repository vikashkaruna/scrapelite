#!/usr/bin/env node
// scripts/build-docker-web.mjs — build the SPA for the LOCAL DOCKER stack with
// an env the developer's repo-root .env cannot influence.
//
// ── WHY THIS IS NOT JUST `npm run build` ─────────────────────────────────────
//
// `npm run build` is `vite build`, and Vite loads `.env` / `.env.local` from the
// project root. On a developer machine those files are the developer's own —
// pointed at the hosted dev Supabase project, and holding whatever `VITE_*`
// names happen to be in them. The local Docker stack then ships a public bundle
// that authenticates against a DIFFERENT SUPABASE PROJECT than the api/jobs
// containers it is talking to. Nothing warns you: runtime-config.js is served
// correctly, says http://localhost:8080, and is read and then discarded by
// config.js's precedence rule.
//
// The two halves also fail independently, which is what makes it confusing:
//   - The browser signs up in the dev cloud project. That project's SMTP is
//     broken, so sign-up returns HTTP 500 "Error sending confirmation email",
//     which matches no rule in authErrors.js and surfaces as the generic
//     "Something went wrong while creating your account".
//   - The api/jobs containers wrote to the LOCAL database. So even a session
//     that somehow worked would see an empty account, and every authenticated
//     call to local PostgREST 401s — the two halves are signed by different JWT
//     secrets.
//
// The fix is to stop reading the repo-root env for this build. Vite's `envDir`
// is pointed at a directory containing exactly one file, web-build.env, which
// deployment/scripts/gen-local-config.mjs wrote from deployment/env/.env.<env>
// and which carries the SAME Supabase URL + anon key the served runtime config
// carries. One input, one output, nothing to drift.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = join(ROOT, "deployment", "generated");
const SOURCE = join(GENERATED, "web-build.env");
// A directory of its own, so Vite reads ONE env file and cannot also pick up a
// `.env.local` that happens to sit next to the project root. Gitignored with
// the rest of deployment/generated/.
const STAGE = join(GENERATED, "vite-env");

const args = process.argv.slice(2);
const passthrough = args.filter((a) => a !== "--force-regen");

if (!existsSync(SOURCE)) {
  console.error(
    `✗ build-docker-web: ${SOURCE} is missing.\n` +
    `  It is written by deployment/scripts/gen-local-config.mjs, which\n` +
    `  deployment/scripts/up.sh runs before this. To build standalone:\n` +
    `    node deployment/scripts/gen-local-config.mjs --env local --out deployment/generated\n` +
    `  Refusing to fall back to the repo-root .env — that fallback is the bug.`,
  );
  process.exit(1);
}

const baked = readFileSync(SOURCE, "utf8");
const keys = [...baked.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]);

// Belt and braces. gen-local-config already refuses an unlisted VITE_* var, but
// this is the last point before a credential becomes a public string literal, so
// the assertion belongs here too — and a guard that only exists in the generator
// stops guarding the moment someone runs the build by hand.
const FORBIDDEN = [
  "VITE_AI_API_KEY", "VITE_FIRECRAWL_API_KEY", "VITE_OPENAI_API_KEY", "VITE_ANTHROPIC_API_KEY",
  "VITE_GEMINI_API_KEY", "VITE_RESEND_API_KEY", "VITE_SPIDER_API_KEY", "VITE_JINA_API_KEY",
  "VITE_SUPABASE_SERVICE_KEY", "VITE_ADMIN_PIN", "VITE_JWT_SECRET", "VITE_RAZORPAY_KEY_SECRET",
  "VITE_STRIPE_SECRET_KEY", "VITE_PERPLEXITY_API_KEY", "VITE_FIREBASE_API_KEY",
];
const leaked = keys.filter((k) => FORBIDDEN.includes(k));
if (leaked.length) {
  console.error(
    `✗ build-docker-web: refusing to bake server credential(s): ${leaked.join(", ")}.\n` +
    `  A VITE_-prefixed var is inlined into the PUBLIC bundle by definition.`,
  );
  process.exit(1);
}

// ── Pre-flight: ensure project dependencies are installed ───────────────────
//
// `npx vite` downloads a STANDALONE vite binary into a temp cache dir. That
// binary can execute, but when it loads the project's vite.config.js (which
// `import`s from `@vitejs/plugin-react`, `vitest/config`, etc.) those packages
// are resolved from the PROJECT's node_modules — which must exist. If someone
// ran `up.sh` without ever running `npm install`, node_modules is empty and
// every import fails with ERR_MODULE_NOT_FOUND.
//
// The same applies across environments: a CI runner, a fresh git clone, or a
// git worktree all need `npm install` before the build can succeed. Detecting
// it early and printing a clear message saves 30 seconds of cryptic stack.
const VITE_BIN = join(ROOT, "node_modules", ".bin", "vite");
if (!existsSync(VITE_BIN)) {
  // Check if node_modules itself is missing or just empty
  const NM = join(ROOT, "node_modules");
  const nmExists = existsSync(NM);
  console.error(
    `✗ build-docker-web: cannot find the local vite binary at ${VITE_BIN}.\n` +
    (nmExists
      ? `  node_modules/ exists but appears incomplete — run \`npm install\` first.\n`
      : `  node_modules/ is missing — run \`npm install\` first.\n`) +
    `  The build requires project dependencies (vite, @vitejs/plugin-react, etc.)\n` +
    `  to be installed locally. \`npx vite\` downloads a standalone binary that\n` +
    `  cannot resolve the project's own dependencies.`,
  );
  process.exit(1);
}

mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, ".env"), baked);

// ⚠️ `envDir` is a CONFIG option — vite's CLI has no `--envDir` flag and fails
// with "Unknown option" (checked against Vite 8). So the isolation is expressed
// as a wrapper config that imports the real one and overrides exactly two
// fields: `root` (so `dist/` still lands in the repo, not in this staging dir)
// and `envDir` (so the repo-root .env/.env.local are never read).
//
// Wrapping rather than editing vite.config.js matters: the base config carries
// the netlify-like routing plugins, the define block, resolve.dedupe and the
// Vitest block. A copy would drift from it on the next edit, and a drift here
// is invisible — the build would still succeed, just differently.
//
// The wrapper strips the `test` block — it references `vitest/config` which is
// a devDependency and irrelevant for a production `vite build`. Vite itself
// ignores the test block during build, but the top-level
// `import { configDefaults } from "vitest/config"` in vite.config.js fires at
// module-evaluation time regardless, so vitest must be installed. Stripping
// `test` here cannot help with the import (it is top-level), but documents the
// intent: the wrapper cares about plugins + define + resolve, not test config.
const wrapper = `// GENERATED by scripts/build-docker-web.mjs — do not edit, do not commit.
import base from ${JSON.stringify(join(ROOT, "vite.config.js"))};
const { test: _test, ...buildConfig } = base;
export default { ...buildConfig, root: ${JSON.stringify(ROOT)}, envDir: ${JSON.stringify(STAGE)} };
`;
writeFileSync(join(STAGE, "vite.docker.config.mjs"), wrapper);

console.log(`→ building the web payload from ${keys.length} baked var(s): ${keys.join(", ")}`);

const run = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`✗ build-docker-web: \`${cmd} ${cmdArgs.join(" ")}\` exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
};

try {
  // Use the project-local vite binary, NOT `npx vite`. `npx vite` downloads a
  // standalone copy into a temp cache that has no visibility into the project's
  // node_modules — @vitejs/plugin-react, vitest/config, and any other import
  // in vite.config.js resolves from node_modules relative to the config file,
  // not relative to the running binary. The local binary shares the same
  // resolution tree, so everything works.
  run(VITE_BIN, ["build", "--config", join(STAGE, "vite.docker.config.mjs"), ...passthrough]);
  // Same second half as `npm run build` — the prerendered/help assets are
  // synced into dist/ by their own step, not by vite.
  run(process.execPath, [join(ROOT, "scripts", "sync-prerender-assets.mjs")]);
  // The admin surface mounts at /admin (hosting rewrite /admin/** → the admin
  // container). A root-absolute /assets/… reference in its HTML would be
  // answered from HOSTING's dist — a different build whose entry hash need not
  // match — so the browser got SPA-fallback HTML for a JS file and /admin
  // rendered blank white (the 2026-09-30 stg incident). base=/admin/ keeps
  // every admin asset URL under the /admin/** rewrite, so the admin container
  // serves its own always-consistent bundle. Pure SPA — no prerender pass.
  run(VITE_BIN, [
    "build", "--config", join(STAGE, "vite.docker.config.mjs"),
    "--base=/admin/", "--outDir=dist-admin", ...passthrough,
  ]);
} finally {
  // The staged env holds publishable values, but it is derived from a file that
  // holds live credentials — do not leave a copy lying around in the tree.
  rmSync(STAGE, { recursive: true, force: true });
}

console.log("✓ build-docker-web: dist/ built against deployment/env (not the repo-root .env)");
