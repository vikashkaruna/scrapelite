// scripts/lib/pgliteSupabase.mjs — run a real store against real Postgres.
//
// A deliberately small subset of the supabase-js query builder, executed as
// SQL against an in-process PGlite. It exists so a store can be tested with
// its constraints, unique indexes, triggers and cascades actually firing —
// the things a hand-written mock agrees with by construction and a database
// does not.
//
// ⚠️ IT IS A SUBSET, AND THAT IS THE CONTRACT. A store under test must restrict
// itself to what is implemented here; an unsupported method throws loudly
// rather than returning something plausible. Supported:
//
//   from(t).select(cols?, { count? })     insert(row|rows)   update(obj)   delete()
//   upsert(rows, { onConflict, ignoreDuplicates })
//   .eq .neq .in .is .lt .lte .gt .gte .ilike .or("a.ilike.x,b.eq.y")
//   .order(col, { ascending }) .limit(n) .single() .maybeSingle()
//   rpc(name, namedArgs)
//
// Results mimic PostgREST: { data, error, count } with error = { message, code }.
// Timestamps come back as ISO strings, not Date objects.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name) {
  if (!IDENT.test(name)) throw new Error(`pgliteSupabase: unsafe identifier "${name}"`);
  return `"${name}"`;
}

function serialize(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

function normalizeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

function pgError(err) {
  return { message: err?.message || String(err), code: err?.code || null, details: err?.detail || null };
}

class Builder {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.op = "select";
    this.cols = "*";
    this.filters = [];
    this.params = [];
    this.orders = [];
    this.lim = null;
    this.mode = "many";
    this.returning = false;
    this.values = null;
    this.onConflict = null;
    this.ignoreDuplicates = false;
    this.countMode = null;
  }

  p(v) { this.params.push(serialize(v)); return `$${this.params.length}`; }

  select(cols = "*", opts = {}) {
    if (this.op === "select") this.cols = cols;
    else this.returning = cols || "*";
    if (opts.count) this.countMode = opts.count;
    return this;
  }
  insert(rows) { this.op = "insert"; this.values = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, { onConflict, ignoreDuplicates = false } = {}) {
    this.op = "upsert"; this.values = Array.isArray(rows) ? rows : [rows];
    this.onConflict = onConflict; this.ignoreDuplicates = ignoreDuplicates; return this;
  }
  update(obj) { this.op = "update"; this.values = obj; return this; }
  delete() { this.op = "delete"; return this; }

  eq(c, v) { this.filters.push(`${ident(c)} = ${this.p(v)}`); return this; }
  neq(c, v) { this.filters.push(`${ident(c)} <> ${this.p(v)}`); return this; }
  lt(c, v) { this.filters.push(`${ident(c)} < ${this.p(v)}`); return this; }
  lte(c, v) { this.filters.push(`${ident(c)} <= ${this.p(v)}`); return this; }
  gt(c, v) { this.filters.push(`${ident(c)} > ${this.p(v)}`); return this; }
  gte(c, v) { this.filters.push(`${ident(c)} >= ${this.p(v)}`); return this; }
  ilike(c, v) { this.filters.push(`${ident(c)}::text ilike ${this.p(v)}`); return this; }
  in(c, arr) {
    if (!Array.isArray(arr) || arr.length === 0) { this.filters.push("false"); return this; }
    // Pushed raw: p() would JSON-encode the array into a malformed literal.
    this.params.push(arr.map(String));
    this.filters.push(`${ident(c)}::text = any($${this.params.length}::text[])`);
    return this;
  }
  is(c, v) {
    if (v !== null && v !== true && v !== false) throw new Error("pgliteSupabase: is() takes null/true/false");
    this.filters.push(`${ident(c)} is ${v === null ? "null" : String(v)}`);
    return this;
  }
  or(expr) {
    const parts = String(expr).split(",").map((s) => s.trim()).filter(Boolean).map((part) => {
      const [col, op, ...rest] = part.split(".");
      const val = rest.join(".").replace(/\*/g, "%");
      if (op === "ilike") return `${ident(col)}::text ilike ${this.p(val)}`;
      if (op === "eq") return `${ident(col)}::text = ${this.p(val)}`;
      throw new Error(`pgliteSupabase: or() op "${op}" not supported`);
    });
    this.filters.push(`(${parts.join(" or ")})`);
    return this;
  }
  order(c, { ascending = true } = {}) { this.orders.push(`${ident(c)} ${ascending ? "asc" : "desc"}`); return this; }
  limit(n) { this.lim = Number(n); return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  where() { return this.filters.length ? ` where ${this.filters.join(" and ")}` : ""; }

  colList(cols) {
    if (!cols || cols === "*") return "*";
    return cols.split(",").map((c) => c.trim()).filter(Boolean).map((c) => {
      if (!IDENT.test(c)) throw new Error(`pgliteSupabase: embedded/aliased select "${c}" not supported`);
      return ident(c);
    }).join(", ");
  }

  build() {
    const t = `public.${ident(this.table)}`;
    if (this.op === "select") {
      let sql = `select ${this.colList(this.cols)} from ${t}${this.where()}`;
      if (this.orders.length) sql += ` order by ${this.orders.join(", ")}`;
      if (this.lim != null) sql += ` limit ${this.lim}`;
      return sql;
    }
    const ret = this.returning ? ` returning ${this.colList(this.returning)}` : "";
    if (this.op === "insert" || this.op === "upsert") {
      const keys = [...new Set(this.values.flatMap((r) => Object.keys(r)))];
      const rows = this.values.map((r) => `(${keys.map((k) => (k in r ? this.p(r[k]) : "default")).join(", ")})`);
      let sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${rows.join(", ")}`;
      if (this.op === "upsert") {
        const target = this.onConflict.split(",").map((c) => ident(c.trim())).join(", ");
        const updates = keys.filter((k) => !this.onConflict.split(",").map((c) => c.trim()).includes(k));
        sql += this.ignoreDuplicates || updates.length === 0
          ? ` on conflict (${target}) do nothing`
          : ` on conflict (${target}) do update set ${updates.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
      }
      return sql + ret;
    }
    if (this.op === "update") {
      const sets = Object.entries(this.values).map(([k, v]) => `${ident(k)} = ${this.p(v)}`);
      return `update ${t} set ${sets.join(", ")}${this.where()}${ret}`;
    }
    if (this.op === "delete") return `delete from ${t}${this.where()}${ret}`;
    throw new Error(`pgliteSupabase: op ${this.op}`);
  }

  async exec() {
    let res;
    try {
      res = await this.db.query(this.build(), this.params);
    } catch (err) {
      return { data: null, error: pgError(err), count: null };
    }
    const rows = (res.rows || []).map(normalizeRow);
    const writeWithoutReturn = this.op !== "select" && !this.returning;
    const count = this.countMode ? (this.op === "select" ? rows.length : res.affectedRows ?? rows.length) : null;
    if (writeWithoutReturn) return { data: null, error: null, count };
    if (this.mode === "single") {
      if (rows.length !== 1) {
        return { data: null, error: { message: `JSON object requested, ${rows.length} rows returned`, code: "PGRST116" }, count };
      }
      return { data: rows[0], error: null, count };
    }
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "multiple rows", code: "PGRST116" }, count };
      return { data: rows[0] || null, error: null, count };
    }
    return { data: rows, error: null, count };
  }

  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

/** A supabase-js–shaped client over a PGlite instance. */
export function supabaseOverPglite(db) {
  return {
    from: (table) => new Builder(db, table),
    async rpc(name, args = {}) {
      const keys = Object.keys(args);
      const params = keys.map((k) => serialize(args[k]));
      const sql = `select * from public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
      try {
        const res = await db.query(sql, params);
        const rows = res.rows.map(normalizeRow);
        const one = rows.length === 1 ? Object.values(rows[0]) : null;
        return { data: one && one.length === 1 ? one[0] : rows, error: null };
      } catch (err) {
        return { data: null, error: pgError(err) };
      }
    },
  };
}

/** The auth/roles shim every migration expects — same as db-verify's. */
export const AUTH_SHIM = `
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
`;

const PGCRYPTO_LINE = /create\s+extension\s+if\s+not\s+exists\s+["']?pgcrypto["']?\s*;?/gi;

/**
 * Apply migrations to a PGlite instance. `only` restricts to file-name
 * prefixes (e.g. ["0081", "0082"]) for a fast, focused schema; omit it to
 * apply everything, as db-verify does.
 */
export async function applyMigrations(db, { dir = "supabase/migrations", only = null, preamble = "" } = {}) {
  await db.exec(AUTH_SHIM + preamble);
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => !only || only.some((p) => f.startsWith(p)))
    .sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8").replace(PGCRYPTO_LINE, "-- pgcrypto skipped");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${f} failed: ${err.message}`);
    }
  }
  return files;
}
