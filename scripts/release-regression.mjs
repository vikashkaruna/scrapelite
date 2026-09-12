#!/usr/bin/env node
// scripts/release-regression.mjs
//
// One parameterised release gate for branch previews, staging and production.
// It deliberately separates safe, read-only deployment verification from the
// authenticated path that creates a real Discoverability audit.  The latter
// can consume a quota and touch a real database, so it is impossible to run
// by accident: a disposable test-account token AND --allow-live-write are
// both required, and the test audit is deleted in a finally block.
//
// Examples:
//   npm run test:release -- --base-url https://preview.example.net
//   npm run test:release -- --base-url https://staging--datiqapp.netlify.app \
//     --environment staging --with-local --verify-rls
//   DATIQ_TEST_BEARER_TOKEN=... npm run test:release -- --full \
//     --environment staging --base-url https://staging--datiqapp.netlify.app \
//     --discover-url https://staging.datiq.app --allow-live-write \
//     --report artifacts/staging-regression.json
//
// The bearer token must belong to a dedicated test user. Never pass it on the
// command line: command histories and process listings are not secret stores.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fetchWithRetry, runSmoke } from "./smoke-prod.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;
const ENVIRONMENTS = new Set(["branch", "staging", "production"]);

export function usage() {
  return `Usage:
  npm run test:release -- --base-url <https://deploy-url> [options]

Read-only deploy checks run by default:
  - deployment smoke (routes, prerendered content, assets, /api/stats)
  - public API health and Discoverability route contracts
  - deployed Chromium smoke suite with deterministic API fixtures

Options:
  --environment <branch|staging|production>  Label for the report (default: branch)
  --with-local                               Run the complete local gate, including visual tests
  --verify-rls                               Run the live anonymous-RLS check (staging/production only)
  --skip-ui                                  Do not run the deployed Playwright smoke suite
  --allow-live-write                         Authorise one disposable Discoverability audit and cleanup
  --discover-url <https://owned-test-site>   Target for the live audit; required with --allow-live-write
  --full                                     Local gate + deployed UI + RLS + live audit flow
  --report <path.json>                       Write the machine-readable result to this path
  --timeout-ms <number>                      Per HTTP request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --retries <number>                         Transport retries per HTTP request (default: ${DEFAULT_RETRIES})
  --admin-pin-from-env                       Include the optional smoke admin probe (SMOKE_ADMIN_PIN only)
  --help                                     Show this help

Environment:
  DATIQ_TEST_BEARER_TOKEN  Supabase JWT for a disposable DatIQ test account.
                           Required only for --allow-live-write / --full.
  SMOKE_ADMIN_PIN          Optional; only read when --admin-pin-from-env is supplied.

Safety:
  The runner never creates records by default. A live audit requires BOTH
  --allow-live-write and DATIQ_TEST_BEARER_TOKEN, then deletes the audit it
  created even if a later assertion fails. Use an owned, crawl-permitted test
  URL so the regression check never tests a customer or a third party.`;
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive number.`);
  return value;
}

/** Parse flags without reading or printing a secret. Exported for unit tests. */
export function parseCliArgs(argv, env = process.env) {
  const options = {
    baseUrl: "",
    environment: "branch",
    withLocal: false,
    withUi: true,
    verifyRls: false,
    allowLiveWrite: false,
    discoverUrl: "",
    full: false,
    reportPath: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: DEFAULT_RETRIES,
    adminPin: "",
    token: env.DATIQ_TEST_BEARER_TOKEN || "",
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--base-url": options.baseUrl = requiredValue(argv, i, flag); i += 1; break;
      case "--environment": options.environment = requiredValue(argv, i, flag); i += 1; break;
      case "--discover-url": options.discoverUrl = requiredValue(argv, i, flag); i += 1; break;
      case "--report": options.reportPath = requiredValue(argv, i, flag); i += 1; break;
      case "--timeout-ms": options.timeoutMs = positiveNumber(requiredValue(argv, i, flag), flag); i += 1; break;
      case "--retries": options.retries = Math.floor(positiveNumber(requiredValue(argv, i, flag), flag)); i += 1; break;
      case "--with-local": options.withLocal = true; break;
      case "--skip-ui": options.withUi = false; break;
      case "--verify-rls": options.verifyRls = true; break;
      case "--allow-live-write": options.allowLiveWrite = true; break;
      case "--full": options.full = true; break;
      case "--admin-pin-from-env": options.adminPin = env.SMOKE_ADMIN_PIN || ""; break;
      case "--help": case "-h": options.help = true; break;
      default: throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (options.full) {
    options.withLocal = true;
    options.withUi = true;
    options.verifyRls = true;
    options.allowLiveWrite = true;
  }
  return options;
}

function asAbsoluteUrl(value, name) {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("not http");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
}

/** Validate execution intent before any external request is made. */
export function validateOptions(options) {
  if (options.help) return { ...options };
  if (!ENVIRONMENTS.has(options.environment)) {
    throw new Error(`--environment must be one of: ${[...ENVIRONMENTS].join(", ")}.`);
  }
  options.baseUrl = asAbsoluteUrl(options.baseUrl, "--base-url");
  if (options.discoverUrl) options.discoverUrl = asAbsoluteUrl(options.discoverUrl, "--discover-url");

  if (options.verifyRls && options.environment === "branch") {
    throw new Error("--verify-rls needs --environment staging or production; a branch preview has no distinct database target.");
  }
  if (options.allowLiveWrite) {
    if (!options.discoverUrl) throw new Error("--allow-live-write requires --discover-url for an owned test target.");
    if (!options.token) throw new Error("--allow-live-write requires DATIQ_TEST_BEARER_TOKEN for a disposable test account.");
  }
  return options;
}

function elapsedSince(startedAt) {
  return Math.round(performance.now() - startedAt);
}

function publicOptions(options) {
  return {
    baseUrl: options.baseUrl,
    environment: options.environment,
    withLocal: options.withLocal,
    withUi: options.withUi,
    verifyRls: options.verifyRls,
    allowLiveWrite: options.allowLiveWrite,
    discoverUrl: options.discoverUrl || null,
    full: options.full,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    // Deliberately represent secret use without serialising the secret.
    usedTestBearerToken: Boolean(options.token),
    usedAdminPin: Boolean(options.adminPin),
  };
}

async function responseJson(res, label) {
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    throw new Error(`${label} returned ${contentType || "no content-type"}; expected application/json.`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

function assertStatus(res, wanted, label) {
  const allowed = Array.isArray(wanted) ? wanted : [wanted];
  if (!allowed.includes(res.status)) {
    throw new Error(`${label} returned HTTP ${res.status}; expected ${allowed.join(" or ")}.`);
  }
}

function makeRequest(options, fetcher = fetch) {
  const retryOpts = {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    backoffMs: 500,
    fetcher,
  };
  return (path, init = {}) => fetchWithRetry(new URL(path, `${options.baseUrl}/`).toString(), init, retryOpts);
}

/**
 * Read-only API contracts that catch redirect, function, and response-shape
 * regressions in a deployed environment.  This intentionally contains no
 * account state and can run against every branch preview.
 */
export async function runDeploymentContracts(options, { fetcher = fetch } = {}) {
  const request = makeRequest(options, fetcher);
  const checks = [];
  const check = async (name, fn) => {
    const startedAt = performance.now();
    try {
      await fn();
      checks.push({ name, status: "passed", durationMs: elapsedSince(startedAt) });
    } catch (error) {
      checks.push({ name, status: "failed", durationMs: elapsedSince(startedAt), detail: error.message });
    }
  };

  await check("Public API health", async () => {
    const res = await request("/api/v1/_health");
    assertStatus(res, 200, "GET /api/v1/_health");
    const body = await responseJson(res, "GET /api/v1/_health");
    if (body?.ok !== true || body?.version !== "v1") {
      throw new Error("GET /api/v1/_health returned an unexpected health payload.");
    }
  });

  await check("Discoverability profiles endpoint", async () => {
    const res = await request("/api/discoverability/profiles");
    assertStatus(res, 200, "GET /api/discoverability/profiles");
    const body = await responseJson(res, "GET /api/discoverability/profiles");
    if (!body?.profiles?.balanced) {
      throw new Error("Discoverability profiles did not include the balanced profile.");
    }
  });

  await check("Discoverability protects account history", async () => {
    const res = await request("/api/discoverability/audits?limit=1");
    assertStatus(res, 401, "Anonymous GET /api/discoverability/audits");
    const body = await responseJson(res, "Anonymous GET /api/discoverability/audits");
    if (body?.code !== "AUTH_REQUIRED") {
      throw new Error("Anonymous audit history response did not preserve AUTH_REQUIRED semantics.");
    }
  });

  return checks;
}

async function requestLiveJson(request, path, init, label, expectedStatus = 200) {
  const res = await request(path, init);
  assertStatus(res, expectedStatus, label);
  return responseJson(res, label);
}

/**
 * Exercises the real Discoverability persistence flow on a dedicated test
 * account.  It tests creation, persisted retrieval, all evidence endpoints,
 * all three portable report formats, and cleanup.  No connected CRM, payment,
 * email, or webhook is touched; those need provider-specific sandbox secrets.
 */
export async function runLiveDiscoverabilityFlow(options, { fetcher = fetch, uuid = randomUUID } = {}) {
  const request = makeRequest(options, fetcher);
  const checks = [];
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "Content-Type": "application/json",
  };
  const idempotencyKey = `release-regression-${options.environment}-${uuid()}`;
  let auditId = null;

  const check = async (name, fn) => {
    const startedAt = performance.now();
    try {
      await fn();
      checks.push({ name, status: "passed", durationMs: elapsedSince(startedAt) });
    } catch (error) {
      checks.push({ name, status: "failed", durationMs: elapsedSince(startedAt), detail: error.message });
      throw error;
    }
  };

  try {
    await check("Authenticated Discoverability history", async () => {
      const body = await requestLiveJson(
        request,
        "/api/discoverability/audits?limit=1",
        { headers },
        "Authenticated GET /api/discoverability/audits",
      );
      if (!Array.isArray(body?.audits)) throw new Error("Authenticated audit history was not an array.");
    });

    await check("Create disposable Discoverability audit", async () => {
      const body = await requestLiveJson(
        request,
        "/api/discoverability/audits",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            target_url: options.discoverUrl,
            audit_profile: "balanced",
            device_profile: "desktop",
            source: "api",
            tags: ["release-regression"],
            label: "Release regression disposable audit",
            idempotency_key: idempotencyKey,
          }),
        },
        "POST /api/discoverability/audits",
        [200, 201],
      );
      auditId = body?.auditId || body?.audit?.id || null;
      if (!auditId || body?.persisted !== true) {
        throw new Error("Audit completed without a persisted audit id; cannot safely verify or clean it up.");
      }
    });

    await check("Retrieve persisted audit and evidence", async () => {
      const details = await requestLiveJson(request, `/api/discoverability/audits/${encodeURIComponent(auditId)}`, { headers }, "GET audit");
      if (!details?.audit || !details?.result) throw new Error("Persisted audit did not include audit metadata and result.");

      for (const endpoint of ["results", "headings", "schema", "answers", "entities", "technical", "recommendations"]) {
        await requestLiveJson(
          request,
          `/api/discoverability/audits/${encodeURIComponent(auditId)}/${endpoint}`,
          { headers },
          `GET audit ${endpoint}`,
        );
      }
    });

    await check("Export complete audit in JSON, CSV, and Markdown", async () => {
      for (const format of ["json", "csv", "markdown"]) {
        const res = await request(
          `/api/discoverability/audits/${encodeURIComponent(auditId)}/report?format=${format}`,
          { headers },
        );
        assertStatus(res, 200, `GET report ${format}`);
        const body = await res.text();
        if (!body.trim()) throw new Error(`GET report ${format} returned an empty report.`);
        if (format === "json") {
          try { JSON.parse(body); } catch { throw new Error("GET report json returned invalid JSON."); }
        }
      }
    });
  } catch (error) {
    // The structured result below preserves the specific failure; cleanup in
    // finally gets its own explicit result rather than being mistaken for it.
  } finally {
    if (auditId) {
      const startedAt = performance.now();
      try {
        const body = await requestLiveJson(
          request,
          `/api/discoverability/audits/${encodeURIComponent(auditId)}`,
          { method: "DELETE", headers },
          "DELETE disposable audit",
        );
        if (body?.deleted !== true) throw new Error("Delete endpoint did not confirm cleanup.");
        checks.push({ name: "Delete disposable Discoverability audit", status: "passed", durationMs: elapsedSince(startedAt) });
      } catch (error) {
        checks.push({ name: "Delete disposable Discoverability audit", status: "failed", durationMs: elapsedSince(startedAt), detail: error.message });
      }
    }
  }

  return checks;
}

function runCommand(name, command, args, env) {
  const startedAt = performance.now();
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env, FORCE_COLOR: "1" },
    });
    child.on("error", (error) => resolvePromise({
      name, status: "failed", durationMs: elapsedSince(startedAt), detail: error.message,
    }));
    child.on("close", (code) => resolvePromise({
      name,
      status: code === 0 ? "passed" : "failed",
      durationMs: elapsedSince(startedAt),
      ...(code === 0 ? {} : { detail: `${command} exited with code ${code}` }),
    }));
  });
}

function printCheck(check) {
  const icon = check.status === "passed" ? "✓" : check.status === "skipped" ? "–" : "✗";
  const suffix = check.durationMs == null ? "" : ` (${(check.durationMs / 1000).toFixed(1)}s)`;
  console.log(`  ${icon} ${check.name}${suffix}${check.detail ? ` — ${check.detail}` : ""}`);
}

function actionableDeviation(check) {
  if (check.status === "skipped") return `${check.name}: ${check.detail}`;
  if (check.status === "failed") return `${check.name}: ${check.detail || "inspect the command output and deployed logs"}`;
  return null;
}

export function summarize(options, checks, startedAt, startedPerformance = performance.now()) {
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const skipped = checks.filter((check) => check.status === "skipped").length;
  return {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedPerformance),
    options: publicOptions(options),
    counts: { passed, failed, skipped, total: checks.length },
    checks,
    deviations: checks.map(actionableDeviation).filter(Boolean),
    verdict: failed > 0 ? "failed" : skipped > 0 ? "passed_with_deviations" : "passed",
  };
}

async function writeReport(path, summary) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`\nMachine-readable report: ${absolute}`);
}

export async function runReleaseRegression(options, dependencies = {}) {
  const checks = [];
  const startedAt = new Date().toISOString();
  const startedPerformance = performance.now();
  const logGroup = (title) => console.log(`\n${title}`);

  if (options.withLocal) {
    logGroup("[1/5] Local regression gate");
    const local = await runCommand(
      "Complete local regression gate (including visual)",
      "npm",
      ["run", "test:all", "--", "--visual"],
      {},
    );
    checks.push(local);
  } else {
    checks.push({ name: "Complete local regression gate", status: "skipped", detail: "Use --with-local or --full to run source, migration, build, security, and visual gates." });
  }

  logGroup("[2/5] Deployed smoke checks");
  const smokeStarted = performance.now();
  try {
    const smoke = await (dependencies.runSmokeFn || runSmoke)(options.baseUrl, {
      adminPin: options.adminPin,
      timeoutMs: options.timeoutMs,
      retries: options.retries,
    });
    checks.push({
      name: "Deployed smoke checks",
      status: smoke.failed === 0 ? "passed" : "failed",
      durationMs: elapsedSince(smokeStarted),
      ...(smoke.failed === 0 ? {} : { detail: smoke.failures.join(" | ") }),
    });
  } catch (error) {
    checks.push({ name: "Deployed smoke checks", status: "failed", durationMs: elapsedSince(smokeStarted), detail: error.message });
  }

  logGroup("[3/5] Read-only deployed API contracts");
  const contracts = await runDeploymentContracts(options, { fetcher: dependencies.fetcher || fetch });
  checks.push(...contracts);

  if (options.withUi) {
    logGroup("[4/5] Deployed browser smoke suite");
    checks.push(await runCommand(
      "Deployed Chromium smoke suite",
      "npm",
      ["run", "test:e2e:deploy"],
      { PW_BASE_URL: options.baseUrl },
    ));
  } else {
    checks.push({ name: "Deployed Chromium smoke suite", status: "skipped", detail: "Skipped by --skip-ui." });
  }

  logGroup("[5/5] Database security and live logical flow");
  if (options.verifyRls) {
    checks.push(await runCommand(
      `Anonymous RLS verification (${options.environment})`,
      "node",
      ["scripts/verify-workflow-rls.mjs", ...(options.environment === "production" ? ["--prod"] : [])],
      {},
    ));
  } else {
    checks.push({ name: "Anonymous RLS verification", status: "skipped", detail: "Use --verify-rls for staging/production." });
  }

  if (options.allowLiveWrite) {
    console.log("  Running one disposable authenticated audit; it will be deleted after verification.");
    const liveChecks = await runLiveDiscoverabilityFlow(options, { fetcher: dependencies.fetcher || fetch });
    checks.push(...liveChecks);
  } else {
    checks.push({ name: "Authenticated Discoverability persistence and export flow", status: "skipped", detail: "Requires --allow-live-write, --discover-url, and DATIQ_TEST_BEARER_TOKEN." });
  }

  const summary = summarize(options, checks, startedAt, startedPerformance);
  console.log("\nRelease regression summary");
  for (const check of checks) printCheck(check);
  console.log(`\nVerdict: ${summary.verdict} · ${summary.counts.passed} passed, ${summary.counts.failed} failed, ${summary.counts.skipped} skipped.`);
  if (summary.deviations.length) {
    console.log("\nFixes / deviations to address:");
    for (const deviation of summary.deviations) console.log(`  - ${deviation}`);
  }
  return summary;
}

async function main() {
  let options;
  try {
    options = validateOptions(parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`\n${error.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const summary = await runReleaseRegression(options);
  if (options.reportPath) await writeReport(options.reportPath, summary);
  if (summary.counts.failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
