#!/usr/bin/env node
// scripts/check-open-defects.mjs — open issues / defects gate
//
// Queries the GitHub Issues API and FAILS the gate when any OPEN issue
// labeled as a defect (bug / defect / vulnerability / regression) exists,
// unless that issue has been manually bypassed:
//
//   - the issue carries the label  `gate-bypass`
//   - AND the issue body contains a future "TODO" note explaining when /
//     how it will be resolved (release policy: no silent bypasses)
//
// Usage (CI):  GH_TOKEN=$GITHUB_TOKEN node scripts/check-open-defects.mjs
// Env:
//   GH_TOKEN / GITHUB_TOKEN — token with issues:read on the repo
//   GATE_REPO               — owner/repo (default: GITHUB_REPOSITORY or
//                             <owner>/<repo>)
//   DEFECT_LABELS           — comma list (default: bug,defect,vulnerability,regression)

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repo =
  process.env.GATE_REPO || process.env.GITHUB_REPOSITORY || "vikashkaruna/scrapelite";
const labels = (process.env.DEFECT_LABELS || "bug,defect,vulnerability,regression")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!token) {
  console.error("[defect-gate] no GH_TOKEN/GITHUB_TOKEN — cannot query issues");
  process.exit(1);
}

// ── fetch wrapper ──────────────────────────────────────────────────────────
//
// 2026-08-12 hardening: the previous version called `fetch()` once per
// label and gave up on the first failure. A single transient TLS blip
// (DEPTH_ZERO_SELF_SIGNED_CERT, ECONNRESET, ETIMEDOUT, …) — which the
// GitHub-hosted `ubuntu-latest` runner does occasionally surface —
// then turned into a hard gate failure with no retry. We now retry up
// to 3 times with exponential backoff, and on persistent network/TLS
// failure we fall back to the `gh` CLI (pre-installed on every GitHub
// Actions runner). The CLI uses its own TLS stack, which is more
// battle-tested than Node's undici for this and is unaffected by the
// transient cert-chain blips the runner occasionally serves.
//
// Order of preference:
//   1. fetch with retry (3 attempts, 0/2/4s backoff)
//   2. `gh api` with the same retry — uses Go's net/http TLS stack
//
// HTTP 4xx/5xx from the GitHub API are NOT retried — they are real
// responses and retrying would just delay the eventual failure.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryableNetworkError(err) {
  if (!err) return false;
  const code = err?.cause?.code || err?.code;
  // Node's fetch surfaces network errors via the `cause` chain. The
  // shapes we want to retry:
  //   - DEPTH_ZERO_SELF_SIGNED_CERT — bad cert chain from the runner
  //   - ECONNRESET, ETIMEDOUT, ECONNREFUSED, EAI_AGAIN — transient
  //   - UND_ERR_SOCKET — generic undici socket error
  // Anything else is a bug in the request itself, not a network blip.
  const RETRYABLE = new Set([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ECONNRESET",
    "ETIMEDOUT",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
  ]);
  return RETRYABLE.has(code);
}

async function ghFetch(path, { attempts = 3 } = {}) {
  const url = `https://api.github.com${path}`;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) {
        // Real API error — don't retry, surface immediately.
        const body = await res.text();
        throw new Error(`GitHub API ${res.status} on ${path}: ${body}`);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      if (!isRetryableNetworkError(err)) throw err;
      const backoff = 2 ** i * 1000; // 1s, 2s, 4s
      console.warn(
        `[defect-gate] fetch attempt ${i + 1}/${attempts} failed (${err.cause?.code || err.code || err.message}); retrying in ${backoff}ms`
      );
      if (i < attempts - 1) await sleep(backoff);
    }
  }
  // All attempts failed with retryable errors — re-throw the last one
  // so the fallback below can try `gh api`.
  throw lastErr;
}

function ghCliAvailable() {
  // The `gh` CLI is pre-installed on github-hosted ubuntu-latest runners
  // (/usr/bin/gh). On self-hosted runners it MAY be missing, in which
  // case we just surface the original fetch error.
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghCliApi(path) {
  // `gh api` is authenticated automatically when GITHUB_TOKEN is set,
  // which it is in this gate. Headers must be passed via -H. The
  // response is the raw JSON body, exactly what we need.
  const args = [
    "api",
    path,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
  ];
  const stdout = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function gh(path, { attempts = 3 } = {}) {
  try {
    return await ghFetch(path, { attempts });
  } catch (fetchErr) {
    // Only fall back to the CLI when the failure looks like a network
    // issue, NOT when it's a real API error (4xx/5xx). Real API
    // errors are not retryable and not a transport problem.
    if (!isRetryableNetworkError(fetchErr) || !ghCliAvailable()) {
      throw fetchErr;
    }
    console.warn(
      `[defect-gate] fetch repeatedly failed (${fetchErr.cause?.code || fetchErr.code || fetchErr.message}); falling back to \`gh api\``
    );
    // Retry `gh api` too — even the CLI can transiently fail, and the
    // alternative here is "fail the whole gate", which is the worst
    // possible outcome for a transport blip.
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return ghCliApi(path);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(2 ** i * 1000);
      }
    }
    throw new Error(
      `Both fetch and \`gh api\` failed for ${path}. ` +
        `Last error: ${lastErr?.message || String(lastErr)}. ` +
        `This is likely a GitHub Actions runner network/TLS issue, not a defect in this repo. ` +
        `If it persists, check the runner's outbound connectivity to api.github.com.`
    );
  }
}

const seen = new Map();
for (const label of labels) {
  const issues = await gh(
    `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`
  );
  for (const issue of issues) {
    if (issue.pull_request) continue; // PRs are not defects
    seen.set(issue.number, issue);
  }
}

const blocking = [];
const bypassed = [];
for (const issue of seen.values()) {
  const issueLabels = (issue.labels || []).map((l) =>
    typeof l === "string" ? l : l.name
  );
  const hasBypass = issueLabels.includes("gate-bypass");
  const hasTodo = /todo/i.test(issue.body || "");
  if (hasBypass && hasTodo) {
    bypassed.push(issue);
  } else if (hasBypass && !hasTodo) {
    console.error(
      `[defect-gate] #${issue.number} has gate-bypass label but NO "TODO" note in the body — bypass rejected`
    );
    blocking.push(issue);
  } else {
    blocking.push(issue);
  }
}

if (bypassed.length) {
  console.log(`[defect-gate] ${bypassed.length} issue(s) bypassed with TODO:`);
  for (const i of bypassed) console.log(`  ⚠ #${i.number} ${i.title}`);
}

if (blocking.length) {
  console.error(
    `[defect-gate] ✗ ${blocking.length} open defect(s) block this release:`
  );
  for (const i of blocking) {
    console.error(`  ✗ #${i.number} ${i.title}  ${i.html_url}`);
  }
  console.error(
    `[defect-gate] Close them, or add the "gate-bypass" label AND a TODO note in the issue body.`
  );
  process.exit(1);
}

console.log(
  `[defect-gate] ✓ no open blocking defects (labels checked: ${labels.join(", ")}; bypassed: ${bypassed.length})`
);
