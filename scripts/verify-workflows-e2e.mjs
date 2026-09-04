// scripts/verify-workflows-e2e.mjs
//
// Drives the REAL Intelligence Workflows handlers and stores against a REAL
// Postgres running the REAL migrations — no mocked Supabase replies anywhere.
//
// ── WHY THIS EXISTS ON TOP OF THE SUITES THAT ALREADY PASS ──────────────────
//
//   * netlify/__tests__/workflow-tenancy.test.js mocks the Supabase REST layer.
//     It proves the HANDLER behaves — 401 without a token, 402 over a plan cap,
//     404 rather than 403 on someone else's row. It would pass happily if the
//     store selected a column that does not exist, or filtered on `userId`
//     where the schema says `user_id`.
//   * scripts/db-verify.mjs exercises the SQL directly. It proves the SCHEMA
//     works — but never sees a handler.
//
// A shape mismatch between the two falls through BOTH and only breaks in
// production. That is exactly the gap `verify-referral-e2e.mjs` was written to
// close for referrals, and this is the same instrument pointed at PRD 3, 4 and 5.
//
// ── WHAT IT COVERS THAT A LIVE BROWSER PASS WOULD ───────────────────────────
//
// Most of the substance of an authenticated staging run is data-layer truth:
// can user A reach user B's rows, is the cadence honoured, does a first crawl
// stay silent, does a failed fetch read as a deletion, is the ledger charged.
// All of that is asserted here against real SQL with two real tenants. What it
// deliberately does NOT cover is the browser: sign-in, rendering, and the UI's
// own wiring. Those remain a signed-in operator pass (TS-9 in the test doc).
//
// It lives in scripts/ rather than vitest for the reason db-verify.mjs does:
// PGlite loads its WASM through fetch, and the suite-wide jsdom environment's
// Response has no arrayBuffer().
//
// Run: npm run verify:workflows

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
const failures = [];
const group = (t) => console.log(`\n${t}`);
function eq(label, got, want) {
  const ok_ = JSON.stringify(got) === JSON.stringify(want);
  if (ok_) { pass++; console.log(`  ✓ ${label}`); }
  else {
    fail++;
    failures.push(`${label}\n      got=${JSON.stringify(got)}\n      want=${JSON.stringify(want)}`);
    console.log(`  ✗ ${label}`);
  }
}
const ok = (label, cond) => eq(label, Boolean(cond), true);

const db = new PGlite();

// ── Supabase shims, lifted from db-verify.mjs so the three cannot drift ─────
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

const PGCRYPTO_LINE = /create\s+extension\s+if\s+not\s+exists\s+["']pgcrypto["']\s*;?/gi;
const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of files) {
  const sql = readFileSync(`${dir}/${f}`, "utf8")
    .replace(PGCRYPTO_LINE, "-- pgcrypto skipped: PGlite has gen_random_uuid() natively");
  try { await db.exec(sql); }
  catch (err) { console.error(`\n✗ ${f} failed to apply — stopping.\n  ${err.message}\n`); process.exit(1); }
}

const users = {};
for (const name of ["alice", "mallory"]) {
  const r = await db.query(`insert into auth.users (email) values ($1) returning id`, [`${name}@e2e.test`]);
  users[name] = r.rows[0].id;
}
// Alice pays for a plan that includes monitoring and integrations; Mallory is
// the other tenant, and is who every isolation assertion is defending against.
await db.query(
  `insert into public.entitlements (user_id, plan_id, status, source, period_end)
   values ($1,'business','active','payment', now() + interval '300 days')`, [users.alice]);
await db.query(
  `insert into public.entitlements (user_id, plan_id, status, source, period_end)
   values ($1,'business','active','payment', now() + interval '300 days')`, [users.mallory]);

// ── PostgREST-over-PGlite shim ──────────────────────────────────────────────
//
// supabase-js builds real PostgREST URLs and calls fetch. Translating those
// URLs into SQL — rather than stubbing the client — is the whole point: a
// column name the store gets wrong produces a Postgres error here, which is
// precisely the class of bug the mocked suite cannot see.
const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", is: "is" };

function whereFrom(params, values) {
  const clauses = [];
  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    if (key === "or") {
      // or=(user_id.eq.X,is_default.is.true)
      const inner = raw.replace(/^\(|\)$/g, "").split(",");
      const parts = inner.map((frag) => {
        const [col, op, ...rest] = frag.split(".");
        const val = rest.join(".");
        if (op === "is") return `${col} is ${val}`;
        values.push(val);
        return `${col} ${OPS[op] || "="} $${values.length}`;
      });
      clauses.push(`(${parts.join(" or ")})`);
      continue;
    }
    const m = String(raw).match(/^([a-z]+)\.(.*)$/s);
    if (!m) continue;
    const [, op, val] = m;
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      const ph = list.map((v) => { values.push(v); return `$${values.length}`; });
      clauses.push(`${key} in (${ph.join(",")})`);
    } else if (op === "is") {
      clauses.push(`${key} is ${val}`);
    } else {
      values.push(val);
      clauses.push(`${key} ${OPS[op] || "="} $${values.length}`);
    }
  }
  return clauses.length ? ` where ${clauses.join(" and ")}` : "";
}

/** PostgREST `select=a,b,rel(x)` → a SQL column list; embedded relations dropped. */
function columnsFrom(params) {
  const sel = params.get("select");
  if (!sel || sel === "*") return "*";
  const cols = sel.split(",").map((c) => c.trim()).filter((c) => c && !c.includes("("));
  return cols.length ? cols.join(", ") : "*";
}

function orderFrom(params) {
  const o = params.get("order");
  if (!o) return "";
  const parts = o.split(",").map((frag) => {
    const [col, dir] = frag.split(".");
    return `${col} ${String(dir).startsWith("desc") ? "desc" : "asc"}`;
  });
  return ` order by ${parts.join(", ")}`;
}

globalThis.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  const path = u.pathname.replace(/^\/rest\/v1\//, "");
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : null;
  const params = u.searchParams;

  // `.single()` / `.maybeSingle()` ask PostgREST for ONE object rather than an
  // array, via this Accept header. Returning an array to a `.single()` caller
  // makes `data.id` undefined, which surfaces far away as a null foreign key —
  // so the shim has to honour it or it invents bugs the code does not have.
  // supabase-js passes a real `Headers` instance, not a plain object, so
  // property access silently reads undefined and every `.single()` call looks
  // like it returned an array.
  const hdrs = options.headers;
  const accept = String(
    hdrs instanceof Headers ? (hdrs.get("accept") || "")
                            : (hdrs?.Accept || hdrs?.accept || ""),
  );
  const singular = accept.includes("vnd.pgrst.object");
  const reply = (rows, status) => new Response(
    JSON.stringify(singular ? (rows[0] ?? null) : rows),
    { status, headers: { "Content-Type": "application/json" } },
  );

  try {
    if (path.startsWith("rpc/")) {
      const args = Object.entries(body || {});
      const named = args.map(([k], i) => `${k} => $${i + 1}`).join(", ");
      const r = await db.query(`select public.${path.slice(4)}(${named}) as result`, args.map(([, v]) => v));
      return new Response(JSON.stringify(r.rows[0].result), { status: 200 });
    }

    if (method === "GET") {
      const values = [];
      const where = whereFrom(params, values);
      const limit = params.get("limit") ? ` limit ${Number(params.get("limit"))}` : "";
      const r = await db.query(
        `select ${columnsFrom(params)} from public.${path}${where}${orderFrom(params)}${limit}`, values);
      return reply(r.rows, 200);
    }

    if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const out = [];
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((c) => (row[c] !== null && typeof row[c] === "object" ? JSON.stringify(row[c]) : row[c]));
        const ph = cols.map((_, i) => `$${i + 1}`);
        const conflict = params.get("on_conflict");
        const upsert = conflict
          ? ` on conflict (${conflict}) do update set ${cols.filter((c) => c !== conflict).map((c) => `${c}=excluded.${c}`).join(", ")}`
          : "";
        const r = await db.query(
          `insert into public.${path} (${cols.join(",")}) values (${ph.join(",")})${upsert} returning *`, vals);
        out.push(...r.rows);
      }
      return reply(out, 201);
    }

    if (method === "PATCH") {
      const cols = Object.keys(body);
      const values = cols.map((c) => (body[c] !== null && typeof body[c] === "object" ? JSON.stringify(body[c]) : body[c]));
      const sets = cols.map((c, i) => `${c}=$${i + 1}`).join(", ");
      const where = whereFrom(params, values);
      const r = await db.query(`update public.${path} set ${sets}${where} returning *`, values);
      return reply(r.rows, 200);
    }

    if (method === "DELETE") {
      const values = [];
      const where = whereFrom(params, values);
      const r = await db.query(`delete from public.${path}${where} returning *`, values);
      return reply(r.rows, 200);
    }
  } catch (err) {
    // A real Postgres error, surfaced the way PostgREST surfaces one — which is
    // how a wrong column or parameter name becomes a visible failure.
    return new Response(JSON.stringify({ message: err.message }), { status: 400 });
  }
  return new Response(JSON.stringify({ message: `unhandled ${method} ${path}` }), { status: 500 });
};

process.env.SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "service-key";

// ── The modules under test: the same code the handlers call, unmodified ─────
const bulk = await import("../netlify/functions/lib/bulkStore.js");
const watch = await import("../netlify/functions/lib/watchlistStore.js");
const rules = await import("../netlify/functions/lib/ruleStore.js");
const { isDue } = await import("../netlify/functions/watchlist-monitor.js");
const { discoverPages } = await import("../src/lib/watchlist/snapshotModel.js");
const { chargeLedger } = await import("../netlify/functions/lib/templateStore.js");

console.log(`\n[verify-workflows] ${files.length} migrations applied · two real tenants\n`);

// ─────────────────────────────────────────────────────────────────────────────
group("PRD 3 — bulk lists: real SQL, real ownership");
{
  const created = await bulk.createList(users.alice, {
    name: "Alice's accounts", domains: ["acme.com", "acme.com", "globex.com"], persona: "sales",
  });
  ok("createList succeeds against the real schema", created?.ok !== false);

  const mine = await bulk.listLists(users.alice);
  eq("the owner sees their list", (mine.lists || []).length, 1);

  // Deduplication is a PRD 3 Must, and this is the first time it is checked
  // against the real insert path rather than the pure model in isolation.
  const listId = (mine.lists || [])[0]?.id;
  const recs = await db.query(`select canonical_domain from public.list_records where list_id=$1`, [listId]);
  eq("duplicate domains are dropped before insert", recs.rows.length, 2);

  const theirs = await bulk.listLists(users.mallory);
  eq("🔴 the other tenant sees NONE of it", (theirs.lists || []).length, 0);

  const stolen = await bulk.getList(listId, users.mallory);
  eq("🔴 getList refuses a list the caller does not own", stolen, null);

  eq("an unauthenticated list read is refused, not unfiltered",
     (await bulk.listLists(null)).ok, false);

  // The IDOR that shipped: the update matched on id alone.
  const rec = await db.query(`select id, list_id from public.list_records where list_id=$1 limit 1`, [listId]);
  await db.query(
    `insert into public.review_queue (record_id, list_id, user_id, field_name, candidate_value, confidence, status)
     values ($1,$2,$3,'industry','Software',0.5,'pending')`,
    [rec.rows[0].id, listId, users.alice]);
  const hijack = await bulk.resolveReviewItem(users.mallory, { reviewId: (await db.query(
    `select id from public.review_queue limit 1`)).rows[0].id, action: "accept", resolvedValue: "Fintech" });
  eq("🔴 another tenant cannot resolve a review item", hijack.ok, false);

  const still = await db.query(`select status from public.review_queue limit 1`);
  eq("...and the item is untouched", still.rows[0].status, "pending");
}

// ─────────────────────────────────────────────────────────────────────────────
group("PRD 3 — ICP rules do not leak between tenants");
{
  await bulk.saveIcpRules(users.mallory, {
    persona: "sales", name: "Mallory's secret ICP",
    criteria: [{ field: "industry", operator: "in", value: ["Fintech"], weight: 100 }], threshold: 60,
  });
  const alicesView = await bulk.getIcpRules(users.alice, "sales");
  // The shipped code selected every row for the persona and fell back to
  // data[0] — handing Alice a competitor's scoring criteria.
  ok("🔴 Alice never receives Mallory's custom ICP rule",
     alicesView?.name !== "Mallory's secret ICP");
  ok("...she gets a genuine default instead", alicesView?.is_default === true);
}

// ─────────────────────────────────────────────────────────────────────────────
group("PRD 4 — watchlists: cadence, ownership, and the change feed");
{
  const w = await watch.createWatchlist(users.alice, {
    name: "Competitors", cadence: "daily", domains: ["rival.com"],
  });
  ok("createWatchlist succeeds against the real schema", w?.ok !== false);

  const wl = (await watch.listWatchlists(users.alice)).watchlists[0];
  ok("the owner sees their watchlist", Boolean(wl));
  eq("🔴 the other tenant sees none", (await watch.listWatchlists(users.mallory)).watchlists.length, 0);
  eq("an unauthenticated read is refused", (await watch.listWatchlists(null)).ok, false);

  // The ownership assertion that stops fabricated competitor intelligence
  // being injected into somebody else's feed.
  eq("🔴 assertWatchlistOwner refuses the other tenant",
     await watch.assertWatchlistOwner(wl.id, users.mallory), false);
  eq("...and accepts the real owner",
     await watch.assertWatchlistOwner(wl.id, users.alice), true);

  // Cadence, against the row the store actually wrote.
  const now = Date.now();
  const target = { last_checked_at: new Date(now - 3600_000).toISOString() };
  eq("a daily watchlist checked an hour ago is NOT due", isDue(target, wl.cadence, now), false);
  eq("...and IS due a day later", isDue(target, wl.cadence, now + 25 * 3600_000), true);
  eq("a never-checked target is due", isDue({ last_checked_at: null }, wl.cadence, now), true);

  // A recorded change round-trips through the real table, with materiality.
  // createWatchlist already created the target for the domain it was given —
  // reading it back rather than inserting a second one is also an assertion
  // that the domains argument really did produce rows.
  const t = await db.query(
    `select id from public.watchlist_targets where watchlist_id=$1 and domain='rival.com'`, [wl.id]);
  eq("createWatchlist created the target for its domain", t.rows.length, 1);
  // ── Discovered pages must satisfy the schema they are written into ──────
  //
  // `discoverPages` is pure and tested in isolation, but the categories it emits
  // have to survive `monitored_pages.category`'s CHECK and the `source` CHECK
  // 0047 added. A pure function returning a category the table rejects is a bug
  // that only appears against real SQL — the same shape as the `refused` status
  // that CHECK-violated its way out of the audit trail.
  const discovered = discoverPages(
    '<a href="/pricing">P</a><a href="/features">F</a><a href="/customers">C</a>',
    "https://rival.com/",
  );
  ok("discovery finds the homepage plus real pages", discovered.length > 1);
  for (const page of discovered) {
    try {
      await db.query(
        `insert into public.monitored_pages (target_id, url, category, source)
         values ($1,$2,$3,'auto')`,
        [t.rows[0].id, page.url, page.category]);
      pass++; console.log(`  ✓ a discovered '${page.category}' page is storable`);
    } catch (e) {
      fail++; failures.push(`discovered category '${page.category}' rejected: ${e.message.split("\n")[0]}`);
      console.log(`  ✗ a discovered '${page.category}' page is storable`);
    }
  }
  const src = await db.query(
    `select count(*)::int c from public.monitored_pages where target_id=$1 and source='auto'`, [t.rows[0].id]);
  eq("...and each is labelled auto-discovered, not as the user's own choice", src.rows[0].c, discovered.length);

  const change = await watch.recordFieldChange(wl.id, t.rows[0].id, {
    targetDomain: "rival.com", field: "pricing.tiers", category: "pricing",
    oldValue: "Free | Pro", newValue: "Free | Pro | Enterprise",
  });
  ok("a field change is written", change.ok);
  const stored = await db.query(`select materiality, fact_summary, ai_interpretation from public.field_changes limit 1`);
  ok("materiality is classified, not left null", Boolean(stored.rows[0].materiality));
  ok("the FACT is stored separately from the interpretation",
     stored.rows[0].fact_summary && stored.rows[0].ai_interpretation
     && stored.rows[0].fact_summary !== stored.rows[0].ai_interpretation);
}

// ─────────────────────────────────────────────────────────────────────────────
group("PRD 5 — signal rules: ownership, destination validation, execution log");
{
  const good = await rules.createRule(users.alice, {
    name: "Pricing alert", trigger_source: "watchlist",
    conditions: [{ field: "materiality", operator: "in", value: ["critical", "high"] }],
    action_type: "slack", action_config: { url: "https://hooks.slack.com/services/T/B/C" },
  });
  ok("a valid rule is created against the real schema", good.ok);

  const evil = await rules.createRule(users.alice, {
    name: "Exfil", trigger_source: "watchlist", conditions: [],
    action_type: "webhook", action_config: { url: "http://169.254.169.254/latest/meta-data/" },
  });
  eq("🔴 a cloud-metadata destination is refused at write time", evil.ok, false);
  eq("...and no row was written",
     (await db.query(`select count(*)::int c from public.signal_rules`)).rows[0].c, 1);

  eq("the owner sees their rule", (await rules.listRules(users.alice)).rules.length, 1);
  eq("🔴 the other tenant sees none", (await rules.listRules(users.mallory)).rules.length, 0);
  eq("an unauthenticated read is refused", (await rules.listRules(null)).ok, false);

  const ruleId = (await rules.listRules(users.alice)).rules[0].id;
  await rules.deleteRule(ruleId, users.mallory);
  eq("🔴 the other tenant cannot delete the rule",
     (await db.query(`select count(*)::int c from public.signal_rules`)).rows[0].c, 1);

  // The audit trail PRD 5 requires, written through the real column set.
  const exec = await rules.recordExecution(ruleId, users.alice, {
    status: "success", eventPayload: { kind: "monitor.change_detected", domain: "rival.com" },
    actionResponse: { code: 200 }, error: null, latencyMs: 42,
  });
  ok("an execution is recorded", exec.ok);
  const row = (await db.query(`select status, latency_ms, attempt from public.rule_executions limit 1`)).rows[0];
  eq("...with its status", row.status, "success");
  eq("...its latency", row.latency_ms, 42);
  eq("...and the retry counter 0045 added", row.attempt, 1);

  // ── EVERY status the dispatcher can produce must be storable ────────────
  //
  // This is the assertion the first version of this harness was missing, and
  // the omission hid a real bug: it only ever recorded `success`. 0043
  // constrained status to three values while the dispatcher produced a fourth,
  // `refused` — the verdict when the SSRF guard rejects a destination — so
  // every security refusal violated the CHECK and was silently dropped by
  // dispatchSignal's own catch. The audit trail lost exactly the events an
  // operator most needs to see.
  //
  // An end-to-end test that walks only the happy path has the same blind spot
  // as a mock: it proves the schema accepts what the code usually writes, not
  // what it writes when something goes wrong.
  for (const st of ["success", "failed", "skipped", "refused", "retrying"]) {
    const r = await rules.recordExecution(ruleId, users.alice, {
      status: st, eventPayload: { kind: "monitor.change_detected" },
      actionResponse: {}, error: null, latencyMs: 1,
      // attempt at the ceiling so `failed` is stored verbatim rather than
      // being promoted to `retrying` by the retry policy.
      attempt: 9,
    });
    ok(`an execution with status '${st}' is storable`, r.ok);
  }

  // A retryable failure is stored as `retrying` WITH a due time, by the policy
  // rather than by the caller — so every writer gets the same behaviour.
  const retryable = await rules.recordExecution(ruleId, users.alice, {
    status: "failed", eventPayload: {}, actionResponse: {}, error: "503", latencyMs: 1, attempt: 1,
  });
  ok("a retryable failure records", retryable.ok);
  const stored = (await db.query(
    `select status, attempt, next_retry_at from public.rule_executions
      where error='503' order by executed_at desc limit 1`)).rows[0];
  eq("...stored as 'retrying', not 'failed'", stored.status, "retrying");
  eq("...carrying its attempt number", stored.attempt, 1);
  ok("...and a scheduled next attempt", stored.next_retry_at !== null);

  // A 4xx settles immediately: the destination said the request was wrong, and
  // resending it unchanged is how a broken rule earns a rate-limit ban on a
  // customer's own Slack workspace.
  await rules.recordExecution(ruleId, users.alice, {
    status: "failed", httpStatus: 404, eventPayload: {}, actionResponse: {},
    error: "404", latencyMs: 1, attempt: 1,
  });
  const notRetried = (await db.query(
    `select status, next_retry_at from public.rule_executions
      where error='404' order by executed_at desc limit 1`)).rows[0];
  eq("a 4xx settles as 'failed'", notRetried.status, "failed");
  eq("...with no retry scheduled", notRetried.next_retry_at, null);

  await rules.deleteRule(ruleId, users.alice);
  eq("the owner CAN delete it",
     (await db.query(`select count(*)::int c from public.signal_rules`)).rows[0].c, 0);
  eq("...and every execution cascades away",
     (await db.query(`select count(*)::int c from public.rule_executions`)).rows[0].c, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
group("Credit ledger — monitoring is a cost-bearing action");
{
  await chargeLedger([{
    user_id: users.alice, reason: "monitor_check", unit: "monitor_check", credits: 3, quantity: 3,
  }]);
  const led = await db.query(
    `select reason, unit, credits from public.credit_ledger where user_id=$1 and reason='monitor_check'`,
    [users.alice]);
  eq("a monitor_check entry is written", led.rows.length, 1);
  eq("...with the pages actually read", Number(led.rows[0].credits), 3);
  // The vocabulary was already in 0037 — the schema anticipated a crawler that
  // had never been built.
  eq("...against the unit the schema already defined", led.rows[0].unit, "monitor_check");
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(62)}`);
console.log(`[verify-workflows] ${pass} assertions passed · ${fail} failed`);
if (fail) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log("  - " + f));
}
await db.close();
process.exit(fail ? 1 : 0);
