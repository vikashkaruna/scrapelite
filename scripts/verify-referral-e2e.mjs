// scripts/verify-referral-e2e.mjs
//
// Verifies the referral loop against a REAL Postgres running the REAL
// migrations — no mocked RPC replies. It drives netlify/functions/lib/referrals.js,
// the exact module the Netlify handler calls.
//
// ── Why this exists on top of the two suites that already pass ──────────────
//   * netlify/__tests__/referral.test.js mocks the Supabase REST layer, so it
//     proves the handler's HTTP behaviour — status codes, refusal copy, that
//     the user id comes from the JWT — but it would happily pass if the module
//     sent `p_userId` to a function that expects `p_user_id`.
//   * scripts/db-verify.mjs exercises the SQL directly, so it proves the
//     functions work — but it never sees the handler.
// A parameter-name or shape mismatch between the two falls straight through
// BOTH suites and only breaks in production. This closes that gap.
//
// It lives here rather than in vitest because PGlite loads its WASM through
// fetch, and the suite-wide jsdom environment's Response has no arrayBuffer().
// Same reason db-verify.mjs is a script. Run: npm run verify:referral

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const failures = [];
const group = (t) => console.log(`\n${t}`);
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}\n      got=${JSON.stringify(got)}\n      want=${JSON.stringify(want)}`); console.log(`  ✗ ${label}`); }
}
function ok(label, cond) { eq(label, Boolean(cond), true); }

const db = new PGlite();

// Supabase shims, lifted verbatim from scripts/db-verify.mjs so the two
// cannot drift: PGlite has no GoTrue, no PostgREST and no Supabase roles,
// and several migrations reference all three.
await db.exec(`
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
`);
const dir = "supabase/migrations";
// Same treatment db-verify.mjs applies: PGlite has gen_random_uuid() natively
// but no pgcrypto extension, so the CREATE EXTENSION line has to be dropped.
const PGCRYPTO_LINE = /create\s+extension\s+if\s+not\s+exists\s+["']pgcrypto["']\s*;?/gi;
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of files) {
  const sql = readFileSync(`${dir}/${f}`, "utf8")
    .replace(PGCRYPTO_LINE, "-- pgcrypto skipped: PGlite has gen_random_uuid() natively");
  try {
    await db.exec(sql);
  } catch (err) {
    console.error(`\n✗ ${f} failed to apply — stopping.\n  ${err.message}\n`);
    process.exit(1);
  }
}

const users = {};
for (const name of ["alice", "bob", "carol", "dave", "eve"]) {
  const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@e2e.test`]);
  users[name] = r.rows[0].id;
}

// ── Supabase-REST-over-PGlite shim ─────────────────────────────────────────
// RPCs are invoked with NAMED arguments on purpose: if the handler's parameter
// names don't match the function signature, Postgres errors instead of
// silently doing the right thing — which is the whole point of this script.
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  const path = u.pathname.replace(/^\/rest\/v1\//, "");
  const body = options.body ? JSON.parse(options.body) : null;

  if (path.startsWith("rpc/")) {
    const args = Object.entries(body || {});
    const named = args.map(([k], i) => `${k} => $${i + 1}`).join(", ");
    const res = await db.query(
      `select public.${path.slice(4)}(${named}) as result`, args.map(([, v]) => v));
    return new Response(JSON.stringify(res.rows[0].result), { status: 200 });
  }
  if (path === "referral_redemptions") {
    const referrer = (u.searchParams.get("referrer_user_id") || "").replace(/^eq\./, "");
    const r = await db.query(`select id from public.referral_redemptions where referrer_user_id = $1`, [referrer]);
    return new Response(JSON.stringify(r.rows), { status: 200 });
  }
  if (path === "entitlements") {
    const uid = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    const r = await db.query(`select bonus_extractions from public.entitlements where user_id = $1`, [uid]);
    return new Response(JSON.stringify(r.rows), { status: 200 });
  }
  // 0079 — the referral reward lives in the ledger now. PostgREST's `like`
  // uses `*` as the wildcard where SQL uses `%`; translating it here rather
  // than in the module keeps the module's query the real one.
  if (path === "credit_ledger") {
    const uid = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    const reason = (u.searchParams.get("reason") || "").replace(/^eq\./, "");
    const like = (u.searchParams.get("grant_period") || "").replace(/^like\./, "").replace(/\*/g, "%");
    const r = await db.query(
      `select credits from public.credit_ledger
        where user_id = $1 and reason = $2 and grant_period like $3`,
      [uid, reason, like || "%"]);
    return new Response(JSON.stringify(r.rows), { status: 200 });
  }
  throw new Error(`unhandled REST path in shim: ${path}`);
};

process.env.SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "service-key";

// The module under test: the same code the Netlify handler calls, unmodified.
// Its HTTP layer (status codes, JSON shape, auth) is covered by the mocked
// suite in netlify/__tests__/referral.test.js; what THAT suite cannot see, and
// this script exists for, is whether the RPC names and parameter names it
// sends actually match the functions in 0029_referrals.sql.
const { getOrIssueCode, redeemCode, getReferralStats, REFERRAL_BONUS } =
  await import("../netlify/functions/lib/referrals.js");

const get = async (uid) => {
  const [{ code }, stats] = await Promise.all([getOrIssueCode(uid), getReferralStats(uid)]);
  return { code, ...stats };
};
const redeem = (uid, code) => redeemCode(uid, code);

console.log(`[verify-referral] ${files.length} migrations applied`);

group("code issuance — the real module against real SQL");
{
  const a = await get(users.alice);
  ok("a real 8-char code is issued", /^[A-HJ-NP-Z2-9]{8}$/.test(a.code || ""));
  // The bug this replaces produced an all-identical string for every user.
  ok("the code is NOT the old 'AAAAAAAA'", a.code !== "AAAAAAAA");
  ok("the code is not a single repeated character", new Set((a.code || "").split("")).size > 1);
  const again = await get(users.alice);
  eq("the same account always gets the same code", again.code, a.code);
  const b = await get(users.bob);
  ok("different accounts get different codes", a.code !== b.code);
  eq("a fresh account starts with no referrals", b.referrals, 0);
}

group("redemption — both sides credited as CREDITS in the real ledger");
{
  const alice = await get(users.alice);
  const r = await redeem(users.bob, alice.code);
  eq("redemption succeeds", r.ok, true);
  eq("redemption reports the bonus", r.bonus, REFERRAL_BONUS);

  // Read the LEDGER, not the handler's own claim. 0079 moved the reward off
  // entitlements.bonus_extractions; asserting the old column would have gone
  // green against a programme that pays nobody.
  const rows = await db.query(
    `select public.credit_available(user_id) a from unnest(array[$1::uuid,$2::uuid]) user_id`,
    [users.alice, users.bob]);
  eq("both sides hold the reward as credits", rows.rows.map((x) => x.a).sort(), [25, 25]);

  const after = await get(users.alice);
  eq("the referrer now sees 1 referral", after.referrals, 1);
  eq("the referrer's bonus is reported back", after.bonus, 25);
  // 🔴 Reported from the LEDGER. Reading the retired bonus_extractions column
  // here would have shown every referrer 0 while the reward itself worked.
  eq("...in credits, and named as such", after.unit, "credits");
}

group("refusals — each verdict reported distinctly");
{
  const carol = await get(users.carol);
  const dup = await redeem(users.bob, carol.code);
  eq("an account cannot redeem a second code", dup.reason, "already");

  const self = await redeem(users.carol, carol.code);
  eq("a self-referral is refused", self.reason, "self");

  const unknown = await redeem(users.dave, "ZZZZZZZZ");
  eq("an unknown code is refused", unknown.reason, "invalid");
}

group("real-world input and cache correctness");
{
  const carol = await get(users.carol);
  const pasted = await redeem(users.dave, `  ${carol.code.toLowerCase()}  `);
  eq("a lower-cased, padded code still redeems", pasted.ok, true);

  // 🔴 Without the version bump the invitee is told they have just earned 25
  // credits while the app keeps serving the pre-reward state until the 60s
  // cache expires. The reward moved to the ledger in 0079; the cache
  // generation did NOT move, and dropping it would have been a silent
  // regression with the reward still arriving correctly.
  const before = await db.query(`select version v from public.entitlements where user_id = $1`, [users.alice]);
  const alice = await get(users.alice);
  await redeem(users.eve, alice.code);
  const post = await db.query(`select version v from public.entitlements where user_id = $1`, [users.alice]);
  ok("entitlements.version is bumped so the client cache busts",
     Number(post.rows[0].v) > Number(before.rows[0].v));
  const total = await db.query(`select public.credit_available($1) a`, [users.alice]);
  eq("the referrer accrues across referrals, in credits", total.rows[0].a, 50);
  eq("...and nothing was written to the retired column", (await db.query(
    `select bonus_extractions b from public.entitlements where user_id = $1`,
    [users.alice])).rows[0].b, 0);
}

console.log(`\n${"─".repeat(62)}`);
console.log(`[verify-referral] ${pass} assertions passed · ${fail} failed`);
if (fail) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  - " + f)); }
await db.close();
process.exit(fail ? 1 : 0);
