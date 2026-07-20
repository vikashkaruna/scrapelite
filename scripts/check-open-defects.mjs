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
//                             vikashkaruna/scrapelite)
//   DEFECT_LABELS           — comma list (default: bug,defect,vulnerability,regression)

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

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${path}: ${await res.text()}`);
  }
  return res.json();
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
