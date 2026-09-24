// netlify/__tests__/helpers/engagementDb.js — a real Postgres for engagement tests.
//
// Migrations 0081 + 0082 applied to in-process PGlite, exposed through the
// supabase-js–shaped adapter the store already speaks. Constraints, unique
// indexes, conditional updates and cascades all run for real — a mock would
// agree with the code under test by construction.
//
// Test files using this must run in the node environment:
//   // @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, supabaseOverPglite } from "../../../scripts/lib/pgliteSupabase.mjs";

// Stand-ins for the tables 0081/0082 reference but do not own.
const PREAMBLE = `
create table if not exists public.workspaces (id uuid primary key default gen_random_uuid());
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(), reason text, unit text,
  constraint credit_ledger_reason_chk check (true),
  constraint credit_ledger_unit_chk check (true)
);`;

export async function createEngagementDb() {
  const pg = new PGlite();
  await applyMigrations(pg, { only: ["0081", "0082", "0083"], preamble: PREAMBLE });
  const sb = supabaseOverPglite(pg);

  let n = 0;
  const createUser = async () => {
    n += 1;
    const { rows } = await pg.query("insert into auth.users (email) values ($1) returning id", [`owner${n}-${Date.now()}@test.local`]);
    return rows[0].id;
  };
  const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
  const all = async (sql, params = []) => (await pg.query(sql, params)).rows;

  return { pg, sb, createUser, one, all };
}

/** Env the engagement modules need; spread over process.env in a test. */
export const ENGAGEMENT_TEST_ENV = {
  ENGAGEMENT_ENABLED: "1",
  ENGAGEMENT_ALLOWLIST: "*",
  ENGAGEMENT_SENDER_DOMAINS: "outreach.example.com",
  ENGAGEMENT_UNSUBSCRIBE_SECRET: "test-unsubscribe-secret-0123456789",
  ENGAGEMENT_PUBLIC_URL: "https://app.example.com",
  ENGAGEMENT_RESEND_API_KEY: "re_test_key",
  ENGAGEMENT_RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from("resend-webhook-test-secret").toString("base64")}`,
};

export const SENDER = { from_name: "Priya at Acme", from_email: "priya@outreach.example.com", reply_to: "priya@acme.test" };
