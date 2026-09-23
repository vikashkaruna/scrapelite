#!/usr/bin/env node
// scripts/verify-engagement-p0.mjs — prove each P0 guard in the Prospect
// Engagement Engine can actually fail.
//
//   npm run verify:engagement-p0
//
// The review's rule: every P0 needs a regression test confirmed RED against the
// defective code. The defective code was rewritten in Phase 1, so this re-plants
// each P0 defect into TODAY's code, runs the test written to catch it, and
// requires that test to fail. A guard that stays green with its defect back in
// place is not a guard — this is how a consent test that passed for the wrong
// reason was found during Phase 1.
//
// Safety: it edits real source files. It refuses to start if any of them has
// uncommitted changes, writes the original bytes back after every mutation
// (never `git checkout`, which would also discard work), and restores on
// Ctrl-C. ~2 minutes; deliberately NOT in the pre-push hook.
//
// Exit 0 = every mutant was killed. Exit 1 = at least one survived or a
// mutation no longer applies (the code moved — update the entry, never delete it).

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISP = "netlify/functions/lib/engagement/dispatcher.js";
const SEND = "netlify/functions/lib/engagement/emailSender.js";
const GUARD = "netlify/functions/lib/engagement/engagementGuards.js";
const STORE = "netlify/functions/lib/engagement/engagementStore.js";
const ENGINE = "netlify/functions/engagement-engine.js";
const HOOK = "netlify/functions/engagement-webhook.js";
const T_ENG = "netlify/__tests__/engagement-engine.test.js";
const T_HOOK = "netlify/__tests__/engagement-webhook.test.js";
const T_UNSUB = "netlify/__tests__/engagement-unsubscribe.test.js";

// F-2's original defect: every variant on every channel for one prospect.
const GEN = /const \[v\] = generatePersonalizedVariants\(p, campaign, campaign\.brand_kit, \{\n\s*channels: \[channel\], variants: \[assignVariant\(p\.id\)\],\n\s*\}\);\n(\s*if \(!v\) \{[^\n]*\n)(\s*rows\.push\(\{\n[^}]*\}\);)/m;
const allVariants = (src) => src.replace(GEN, (_m, _skip, push) =>
  'for (const v of generatePersonalizedVariants(p, campaign, campaign.brand_kit, {\n' +
  '        channels: ["email", "whatsapp", "sms"], variants: ["A", "B"],\n      })) {\n' + push + "\n      }");

/** [id, the defect, file, old → new | fn, test file, test-name pattern] */
export const MUTATIONS = [
  ["F-1a", "message never marked sent — re-sent on every dispatch", DISP,
    'status: "sent", sent_at: sentAt,', 'status: "queued", sent_at: sentAt,', T_ENG, "a second send sends nothing"],
  ["F-1b", "claim without its status condition — two workers both send", DISP,
    '.eq("id", msg.id).eq("status", msg.status);', '.eq("id", msg.id);', T_ENG, "racing"],
  ["F-1c", "no Idempotency-Key", SEND,
    '"Idempotency-Key": `engagement-msg-${message.id}`,', "", T_ENG, "idempotency key"],
  ["F-2a", "every variant on every channel for one prospect", ENGINE, allVariants, null, T_ENG, "one email draft"],
  ["F-2b", "a second open draft for the same prospect", ENGINE,
    "if (hasOpen.has(p.id)) {", "if (false) {", T_ENG, "does not draft twice"],
  ["F-3a", "suppression not checked at send", DISP,
    "if (sup && sup.length) return skip(", "if (false) return skip(", T_ENG, "opt-out recorded after approval|email-only opt-out|covers the same person"],
  ["F-3b", "adminOverride accepted from the request body", ENGINE,
    'eventType: "manual_status_change",', '...(body.meta || {}), eventType: "manual_status_change",', T_ENG, "adminOverride"],
  ["F-3c", "spam complaint does not suppress", HOOK,
    '"email.complained": { prospect: PROSPECT_STATUSES.OPTED_OUT, suppress: SUPPRESSION_REASONS.COMPLAINT },',
    '"email.complained": { prospect: PROSPECT_STATUSES.OPTED_OUT },', T_HOOK, "complaint on A"],
  ["F-3d", "permanent bounce does not suppress", HOOK, "if (permanent) {", "if (false) {", T_HOOK, "permanent bounce suppresses"],
  ["F-4a", "missing provider key reported as sent", SEND,
    'if (!key) return { ok: false, code: "email_not_configured", retryable: false };',
    "if (!key) return { ok: true, provider: ENGAGEMENT_EMAIL_PROVIDER, externalId: `fake_${message.id}` };", T_ENG, "without an outreach email key"],
  ["F-4b", "falls back to the transactional RESEND_API_KEY", SEND,
    "const key = env.ENGAGEMENT_RESEND_API_KEY;", "const key = env.ENGAGEMENT_RESEND_API_KEY || env.RESEND_API_KEY;", T_ENG, "does not fall back"],
  ["F-4c", "mock sending allowed in production", SEND,
    'return env.ENGAGEMENT_MOCK_SEND === "1" && !isProductionContext(env);', 'return env.ENGAGEMENT_MOCK_SEND === "1";', T_ENG, "refused in production"],
  ["F-5a", "webhook fails open when the secret is unset", HOOK, "if (!secret) {", "if (false) {", T_HOOK, "503 when the signing secret is unset"],
  ["F-5b", "webhook signature not enforced", HOOK, "if (!verified.ok) {", "if (false) {", T_HOOK, "unsigned request|tampered body|replay"],
  ["F-6", "event matched to a prospect by email across tenants", HOOK,
    '.eq("id", msg.prospect_id).eq("user_id", msg.user_id).maybeSingle();',
    '.eq("email", (await db.from("engagement_prospects").select("email").eq("id", msg.prospect_id).maybeSingle()).data?.email).order("created_at", { ascending: false }).limit(1).maybeSingle();',
    T_HOOK, "complaint on A"],
  ["F-7", "update_campaign mass-assignable (user_id)", STORE,
    ".update(v.fields)\n", ".update({ ...(plainObject(updates) || {}), ...v.fields })\n", T_ENG, "by setting user_id"],
  ["F-8a", "sender domain not restricted", GUARD, "if (!allowed.includes(domain)) {", "if (false) {", T_ENG, "unverified domain"],
  ["F-8b", "no one-click List-Unsubscribe header", SEND,
    '"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",', "", T_ENG, "one-click unsubscribe header"],
  ["F-8c", "unsubscribe token signature not checked", GUARD,
    "if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;", "", T_UNSUB, "tampered or missing token"],
];

function dirtyFiles(files) {
  const out = execFileSync("git", ["status", "--porcelain", "--", ...files], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function main() {
  const files = [...new Set(MUTATIONS.map((m) => m[2]))];
  const dirty = dirtyFiles(files);
  if (dirty.length) {
    console.error("Refusing to run: these files have uncommitted changes, and this script edits them:\n  " + dirty.join("\n  "));
    process.exit(2);
  }

  let pending = null; // [path, original] while a mutation is on disk
  const restore = () => { if (pending) { writeFileSync(join(ROOT, pending[0]), pending[1]); pending = null; } };
  process.on("SIGINT", () => { restore(); process.exit(130); });

  const rows = [];
  for (const [id, what, path, from, to, test, pattern] of MUTATIONS) {
    const full = join(ROOT, path);
    const original = readFileSync(full, "utf8");
    const mutated = typeof from === "function" ? from(original) : original.includes(from) ? original.replace(from, to) : original;
    if (mutated === original) { rows.push([id, "NOT APPLIED", what, "the code moved — update this entry"]); continue; }

    pending = [path, original];
    writeFileSync(full, mutated);
    try {
      const r = spawnSync("npx", ["vitest", "run", test, "-t", pattern], { cwd: ROOT, encoding: "utf8" });
      const out = `${r.stdout}${r.stderr}`;
      const summary = (out.match(/^\s*Tests\s+(\d.*)$/m) || [])[1]?.trim() || "no summary";
      const killed = r.status !== 0 && /\d+ failed/.test(summary) && !/SyntaxError|Transform failed/.test(out);
      rows.push([id, killed ? "RED" : "SURVIVED", what, summary]);
    } finally {
      restore();
    }
  }

  for (const [id, verdict, what, summary] of rows) {
    console.log(`${verdict === "RED" ? "✓" : "✗"} ${id.padEnd(5)} ${verdict.padEnd(11)} ${what}  [${summary}]`);
  }
  if (dirtyFiles(files).length) { console.error("✗ a source file was left modified — inspect git status"); process.exit(1); }
  const bad = rows.filter((r) => r[1] !== "RED");
  console.log(bad.length ? `\n✗ ${bad.length} of ${rows.length} P0 guards did not go RED.` : `\n✓ all ${rows.length} P0 mutants killed; sources restored.`);
  process.exit(bad.length ? 1 : 0);
}

main();
