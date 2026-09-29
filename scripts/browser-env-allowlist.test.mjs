// scripts/browser-env-allowlist.test.mjs — a VITE_-prefixed var is a PUBLIC var.
//
// ── THE INCIDENT THIS EXISTS FOR ─────────────────────────────────────────────
//
// `npm run build` is `vite build`, and Vite reads `.env` / `.env.local` from
// the project root. On the developer's machine those files held
// `VITE_AI_API_KEY` (a live `sk-ant-api03-…`) and `VITE_FIRECRAWL_API_KEY`.
// The local Docker stack ships `dist/` straight into nginx, so the result was a
// public bundle containing a live LLM credential and a scraping key.
//
// The bundle ALSO baked the developer's `VITE_SUPABASE_URL` — the hosted dev
// project — which is what broke sign-up: the browser authenticated against a
// foreign project whose SMTP returns 500, while the api/jobs containers talked
// to the local database. Two halves of one app, pointed at two different
// projects, failing independently.
//
// A guard that only says "don't commit secrets" cannot catch this: none of
// these files are committed, and the exposure happened on a machine where
// nothing was pushed anywhere. The thing to assert is the RULE — which names
// are allowed to reach a public bundle — not the contents of one developer's
// untracked files.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Names that may NEVER be baked into a browser bundle, whatever the reason. */
const NEVER_PUBLIC = [
  /^VITE_(AI|FIRECRAWL|OPENAI|ANTHROPIC|GEMINI|RESEND|SPIDER|JINA|PERPLEXITY|FIREBASE|GOOGLE)_.*(KEY|TOKEN|SECRET|PASSWORD)$/,
  /^VITE_.*(SECRET|PRIVATE_KEY|PASSWORD)$/,
  /^VITE_SUPABASE_SERVICE_KEY$/,
  /^VITE_ADMIN_(PIN|TOKEN)/,
  /^VITE_RAZORPAY_KEY_SECRET$/,
  /^VITE_STRIPE_SECRET/,
];

const ALLOWLISTED = (() => {
  // The list is the single declaration in gen-local-config.mjs; parse it rather
  // than restating it, so a second hand-written copy cannot drift out of step
  // with the generator.
  const src = read("deployment/scripts/gen-local-config.mjs");
  const block = /const VITE_ALLOWLIST = \[([\s\S]*?)\];/.exec(src);
  expect(block, "VITE_ALLOWLIST not found in gen-local-config.mjs").toBeTruthy();
  return [...block[1].matchAll(/"([A-Z_][A-Z0-9_]*)"/g)].map((m) => m[1]);
})();

describe("the browser-baked allowlist contains no credential", () => {
  it("parses a non-trivial list (a broken regex must not silently pass)", () => {
    expect(ALLOWLISTED.length).toBeGreaterThan(8);
  });

  it.each(ALLOWLISTED)("%s is a name that is safe in public", (name) => {
    for (const re of NEVER_PUBLIC) expect(re.test(name), `${name} must never be publicly baked`).toBe(false);
  });

  it("declares no server key as a VITE_ name anywhere in the registry", () => {
    // The other half of the fix: a server provider must not READ a VITE_ name
    // either, because the same name in the same env file is browser-inlined.
    const registry = read("src/lib/providerRegistry.js");
    const keyEnvLines = [...registry.matchAll(/keyEnv(?:List)?:\s*(\[[^\]]*\]|"[A-Z_]+"|null)/g)].map((m) => m[1]);
    for (const line of keyEnvLines) {
      expect(/VITE_/.test(line), `a server key may not be read from ${line}`).toBe(false);
    }
    expect(registry).not.toMatch(/keyEnvFallback:\s*"VITE_AI_API_KEY"/);
  });
});

describe("gen-local-config REFUSES a VITE_ var that is not on the list", () => {
  const minimal = [
    "DATA_MODE=local-db",
    "JWT_SECRET=not-a-real-secret-but-long-enough",
    "PUBLIC_BASE_URL=http://localhost:8080",
    "COMPOSE_PROJECT_NAME=datiq-local",
    "SUPABASE_SERVICE_KEY=service-role-placeholder",
  ].join("\n");

  function runGen(extraLines) {
    const dir = mkdtempSync(join(tmpdir(), "datiq-allowlist-"));
    const file = join(dir, ".env.local");
    writeFileSync(file, `${minimal}\n${extraLines.join("\n")}\n`);
    try {
      execFileSync(process.execPath, [
        join(ROOT, "deployment", "scripts", "gen-local-config.mjs"),
        "--env", file,
        "--out", join(dir, "out"),
      ], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      return { code: 0, out: "" };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout || ""}${e.stderr || ""}` };
    }
  }

  it("accepts an allowlisted publishable var", () => {
    const r = runGen(['VITE_STRIPE_PUBLISHABLE_KEY=pk_test_x', "VITE_LINK_ABOUT=https://datiq.ai/about"]);
    expect(r.code, r.out).toBe(0);
  });

  it("REFUSES an unlisted VITE_ var and names it", () => {
    const r = runGen(["VITE_SOME_NEW_FLAG=1"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("VITE_SOME_NEW_FLAG");
  });

  it("REFUSES an unlisted VITE_ var that LOOKS like a credential, and does not echo the value", () => {
    // The error has to help whoever tripped it, so it names the var — but it
    // must not print the secret into a CI log on the way to doing so.
    const r = runGen(["VITE_AI_API_KEY=sk-ant-api03-THISMUSTNOTBEPRINTED"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("VITE_AI_API_KEY");
    expect(r.out).not.toContain("sk-ant-api03-THISMUSTNOTBEPRINTED");
  });

  it("in local-db mode the baked Supabase pair comes from the resolved pair, never the env file", () => {
    // Even with a dev-project URL sitting in the env file, the browser must be
    // told about the local stack — that disagreement is the whole incident.
    const dir = mkdtempSync(join(tmpdir(), "datiq-mode-"));
    const file = join(dir, ".env.local");
    writeFileSync(file, `${minimal}\nVITE_SUPABASE_URL=https://dev-project.supabase.co\nVITE_SUPABASE_ANON_KEY=dev-anon\n`);
    const out = join(dir, "out");
    execFileSync(process.execPath, [
      join(ROOT, "deployment", "scripts", "gen-local-config.mjs"),
      "--env", file, "--out", out,
    ], { cwd: ROOT, stdio: "pipe" });
    const baked = readFileSync(join(out, "web-build.env"), "utf8");
    expect(baked).toContain("VITE_SUPABASE_URL=http://localhost:8080");
    expect(baked).not.toContain("dev-project.supabase.co");
    // …and the served runtime config must agree with it, value for value.
    const runtime = readFileSync(join(out, "runtime-config.js"), "utf8");
    const key = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(baked)[1];
    expect(runtime).toContain(`supabaseAnonKey: "${key}"`);
  });
});

describe("the docker web build cannot be pointed at the repo-root env", () => {
  it("build-docker-web exists and isolates envDir", () => {
    expect(existsSync(join(ROOT, "scripts", "build-docker-web.mjs"))).toBe(true);
    const src = read("scripts/build-docker-web.mjs");
    // The isolation is the point; if it is removed the bug returns silently.
    expect(src).toContain("envDir");
    expect(src).toMatch(/FORBIDDEN/);
  });

  it("the build script refuses to fall back to the repo-root .env", () => {
    const src = read("scripts/build-docker-web.mjs");
    expect(src).toMatch(/Refusing to fall back to the repo-root \.env/);
  });

  it("up.sh builds the payload instead of shipping whatever dist/ is lying around", () => {
    const src = read("deployment/scripts/up.sh");
    expect(src).toContain("build-docker-web.mjs");
  });
});
