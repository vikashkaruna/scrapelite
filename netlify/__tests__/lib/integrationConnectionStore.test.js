// netlify/__tests__/lib/integrationConnectionStore.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getConnection,
  upsertConnection,
  deleteConnection,
} from "../../functions/lib/integrationConnectionStore.js";

function makeDb() {
  const state = { integration_connections: [] };
  const mock = vi.fn(async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || "GET").toUpperCase();
    if (u.pathname.endsWith("/integration_connections")) {
      if (method === "POST") {
        const body = JSON.parse(init.body || "{}");
        const id = `c-${state.integration_connections.length + 1}`;
        const row = { id, ...body };
        state.integration_connections.push(row);
        return new Response(JSON.stringify([row]), { status: 201 });
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body || "{}");
        const updated = [];
        for (const row of state.integration_connections) {
          let match = true;
          for (const [k, v] of u.searchParams) {
            const [op, ...rest] = v.split(".");
            const val = rest.join(".");
            if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
          }
          if (match) {
            Object.assign(row, body);
            updated.push(row);
          }
        }
        return new Response(JSON.stringify(updated), { status: 200 });
      }
      if (method === "DELETE") {
        state.integration_connections = state.integration_connections.filter((row) => {
          for (const [k, v] of u.searchParams) {
            const [op, ...rest] = v.split(".");
            const val = rest.join(".");
            if (op === "eq" && row[k] === decodeURIComponent(val || "")) return false;
          }
          return true;
        });
        return new Response(null, { status: 204 });
      }
      // GET
      const matches = [];
      for (const row of state.integration_connections) {
        let match = true;
        for (const [k, v] of u.searchParams) {
          if (k === "select" || k === "limit") continue;
          const [op, ...rest] = v.split(".");
          const val = rest.join(".");
          if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
        }
        if (match) matches.push(row);
      }
      // Apply select projection
      const select = u.searchParams.get("select");
      if (select) {
        const fields = select.split(",").map((s) => s.trim());
        return new Response(JSON.stringify(matches.map((r) => {
          const o = {};
          for (const f of fields) o[f] = r[f];
          return o;
        })), { status: 200 });
      }
      return new Response(JSON.stringify(matches), { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  return { mock, state };
}

const TEST_DB = { base: "https://test.supabase.co/rest/v1", headers: { apikey: "k", Authorization: "Bearer k" } };

describe("integrationConnectionStore", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    process.env.INTEGRATION_SECRETS_KEY = "test-only-integration-key";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  describe("getConnection", () => {
    it("returns the row when present", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.integration_connections.push({
        id: "c1", user_id: "u1", provider: "hubspot",
        access_token: "secret", account_label: "ACME",
      });
      const r = await getConnection({ userId: "u1", provider: "hubspot", db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.connection.account_label).toBe("ACME");
      // Without includeSecrets, the access_token should NOT be selected
      expect(r.connection.access_token).toBeUndefined();
    });
    it("includes secrets when includeSecrets=true", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.integration_connections.push({
        id: "c1", user_id: "u1", provider: "hubspot",
        access_token: "secret",
      });
      const r = await getConnection({
        userId: "u1", provider: "hubspot", includeSecrets: true, db: TEST_DB,
      });
      // This fixture represents a legacy plaintext row; reads remain
      // compatible while newly-written values are encrypted.
      expect(r.connection.access_token).toBe("secret");
    });
    it("returns null connection when nothing is stored", async () => {
      const { mock } = makeDb();
      fetchMock.mockImplementation(mock);
      const r = await getConnection({ userId: "u1", provider: "hubspot", db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.connection).toBeNull();
    });
    it("returns ok:false when service db is unconfigured", async () => {
      const prev = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_KEY };
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      try {
        const r = await getConnection({ userId: "u1", provider: "hubspot" });
        expect(r.ok).toBe(false);
        expect(r.error).toBe("service_db_unconfigured");
      } finally {
        process.env.SUPABASE_URL = prev.u;
        process.env.SUPABASE_SERVICE_KEY = prev.k;
      }
    });
  });

  describe("upsertConnection", () => {
    it("inserts when no row exists", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      const r = await upsertConnection({
        userId: "u1", provider: "hubspot",
        fields: { access_token: "pat-xxx" }, db: TEST_DB,
      });
      expect(r.ok).toBe(true);
      expect(state.integration_connections).toHaveLength(1);
      expect(state.integration_connections[0].access_token).toMatch(/^enc:v1:/);
    });
    it("updates an existing row (idempotent)", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.integration_connections.push({ id: "c1", user_id: "u1", provider: "hubspot", account_label: "Old" });
      const r = await upsertConnection({
        userId: "u1", provider: "hubspot",
        fields: { account_label: "New" }, db: TEST_DB,
      });
      expect(r.ok).toBe(true);
      expect(r.created).toBe(false);
      expect(state.integration_connections).toHaveLength(1);
      expect(state.integration_connections[0].account_label).toBe("New");
    });
  });

  describe("deleteConnection", () => {
    it("removes the row", async () => {
      const { mock, state } = makeDb();
      fetchMock.mockImplementation(mock);
      state.integration_connections.push({ id: "c1", user_id: "u1", provider: "hubspot" });
      const r = await deleteConnection({ userId: "u1", provider: "hubspot", db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(state.integration_connections).toHaveLength(0);
    });
  });
});
