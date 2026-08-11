// netlify/__tests__/lib/apiKeyStore.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateApiKey } from "../../functions/lib/apiKeyService.js";
import {
  buildApiKeyRow,
  findActiveApiKey,
  listApiKeysForUser,
  revokeApiKey,
  createApiKey,
  touchApiKey,
  getServiceDb,
} from "../../functions/lib/apiKeyStore.js";

// Tiny in-memory Supabase REST mock. The code uses global `fetch` plus a
// `db` object carrying base/headers; we mock fetch to interpret the URL
// and return rows.
function makeDb(initialRows = []) {
  const state = { api_keys: [...initialRows] };
  const calls = [];
  const mock = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    const method = (init.method || "GET").toUpperCase();
    const headers = init.headers || {};
    void headers;
    // /api_keys table
    if (u.pathname.endsWith("/api_keys") || u.pathname.endsWith("/api_keys/")) {
      if (method === "POST") {
        const body = JSON.parse(init.body || "{}");
        const id = `k-${state.api_keys.length + 1}`;
        const row = { id, ...body };
        state.api_keys.push(row);
        return new Response(JSON.stringify([row]), { status: 201 });
      }
      if (method === "PATCH") {
        const body = JSON.parse(init.body || "{}");
        let updated = null;
        for (const row of state.api_keys) {
          let match = true;
          for (const [k, v] of u.searchParams) {
            const [op, ...rest] = v.split(".");
            const val = rest.join(".");
            if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
          }
          if (match) { Object.assign(row, body); updated = row; }
        }
        return new Response(JSON.stringify(updated ? [updated] : []), { status: 200 });
      }
      if (method === "DELETE") {
        state.api_keys = state.api_keys.filter((row) => {
          for (const [k, v] of u.searchParams) {
            const [op, ...rest] = v.split(".");
            const val = rest.join(".");
            if (op === "eq" && row[k] === decodeURIComponent(val || "")) return false;
          }
          return true;
        });
        return new Response("", { status: 204 });
      }
      // GET
      const matches = [];
      for (const row of state.api_keys) {
        let match = true;
        for (const [k, v] of u.searchParams) {
          if (k === "select" || k === "order" || k === "limit") continue;
          // URL format: `field=op.value` (e.g. `user_id=eq.u1`,
          // `revoked_at=is.null`). The FIRST segment of `v` is the operator,
          // the rest (joined back with dots) is the value.
          const [op, ...rest] = v.split(".");
          const val = rest.join(".");
          if (op === "eq" && row[k] !== decodeURIComponent(val || "")) { match = false; break; }
          if (op === "is" && val === "null" && row[k] != null) { match = false; break; }
        }
        if (match) matches.push(row);
      }
      // Apply select projection
      const select = u.searchParams.get("select");
      let out = matches;
      if (select && select !== "*") {
        const fields = select.split(",").map((s) => s.trim());
        out = matches.map((r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
      }
      return new Response(JSON.stringify(out), { status: 200 });
    }
    return new Response("", { status: 404 });
  });
  return { mock, state, calls };
}

const TEST_DB = { base: "https://test.supabase.co/rest/v1", headers: { apikey: "k", Authorization: "Bearer k" } };

describe("apiKeyStore", () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("buildApiKeyRow", () => {
    it("hashes the plaintext and stores the prefix", () => {
      const plaintext = generateApiKey("live");
      const row = buildApiKeyRow({ plaintext, userId: "u1", label: "laptop" });
      expect(row.key_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.user_id).toBe("u1");
      expect(row.label).toBe("laptop");
      expect(row.env).toBe("live");
      expect(row.key_prefix).toMatch(/^dq_live_/);
    });
    it("rejects missing plaintext or userId", () => {
      expect(() => buildApiKeyRow({ userId: "u1" })).toThrow(/plaintext/);
      expect(() => buildApiKeyRow({ plaintext: "x".repeat(20) })).toThrow(/userId/);
    });
  });

  describe("findActiveApiKey", () => {
    it("looks up by hash and returns the row when active", async () => {
      const plaintext = generateApiKey("live");
      const { mock } = makeDb([{ id: "k1", ...buildApiKeyRow({ plaintext, userId: "u1" }) }]);
      fetchMock.mockImplementation(mock);
      const r = await findActiveApiKey(plaintext, { db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.key.id).toBe("k1");
      expect(r.key.user_id).toBe("u1");
    });
    it("returns key:null for a key that is not in the table", async () => {
      const { mock } = makeDb([]);
      fetchMock.mockImplementation(mock);
      const r = await findActiveApiKey(generateApiKey("live"), { db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.key).toBeNull();
    });
    it("treats revoked keys as missing", async () => {
      const plaintext = generateApiKey("live");
      const { mock } = makeDb([
        { id: "k1", ...buildApiKeyRow({ plaintext, userId: "u1" }), revoked_at: new Date().toISOString() },
      ]);
      fetchMock.mockImplementation(mock);
      const r = await findActiveApiKey(plaintext, { db: TEST_DB });
      expect(r.key).toBeNull();
    });
    it("treats expired keys as missing", async () => {
      const plaintext = generateApiKey("live");
      const past = new Date(Date.now() - 1000).toISOString();
      const { mock } = makeDb([
        { id: "k1", ...buildApiKeyRow({ plaintext, userId: "u1" }), expires_at: past },
      ]);
      fetchMock.mockImplementation(mock);
      const r = await findActiveApiKey(plaintext, { db: TEST_DB });
      expect(r.key).toBeNull();
    });
    it("returns ok:false when service db is unconfigured", async () => {
      // Override the env stub from beforeEach
      const prevUrl = process.env.SUPABASE_URL;
      const prevKey = process.env.SUPABASE_SERVICE_KEY;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      try {
        const r = await findActiveApiKey(generateApiKey("live"));
        expect(r.ok).toBe(false);
        expect(r.error).toBe("service_db_unconfigured");
      } finally {
        if (prevUrl) process.env.SUPABASE_URL = prevUrl;
        if (prevKey) process.env.SUPABASE_SERVICE_KEY = prevKey;
      }
    });
    it("returns malformed_key when the key is too short", async () => {
      const { mock } = makeDb([]);
      fetchMock.mockImplementation(mock);
      const r = await findActiveApiKey("short", { db: TEST_DB });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("malformed_key");
    });
  });

  describe("listApiKeysForUser", () => {
    it("returns only active keys by default", async () => {
      const now = new Date().toISOString();
      const { mock } = makeDb([
        { id: "k1", user_id: "u1", key_prefix: "dq_live_a…", env: "live", created_at: now },
        { id: "k2", user_id: "u1", key_prefix: "dq_live_b…", env: "live", created_at: now, revoked_at: now },
      ]);
      fetchMock.mockImplementation(mock);
      const r = await listApiKeysForUser("u1", { db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(r.keys.map((k) => k.id)).toEqual(["k1"]);
    });
    it("includes revoked keys when includeRevoked=true", async () => {
      const now = new Date().toISOString();
      const { mock } = makeDb([
        { id: "k1", user_id: "u1", key_prefix: "dq_live_a…", env: "live", created_at: now },
        { id: "k2", user_id: "u1", key_prefix: "dq_live_b…", env: "live", created_at: now, revoked_at: now },
      ]);
      fetchMock.mockImplementation(mock);
      const r = await listApiKeysForUser("u1", { includeRevoked: true, db: TEST_DB });
      expect(r.keys).toHaveLength(2);
    });
  });

  describe("revokeApiKey", () => {
    it("sets revoked_at to now", async () => {
      const { mock, state } = makeDb([{ id: "k1", user_id: "u1", env: "live" }]);
      fetchMock.mockImplementation(mock);
      const r = await revokeApiKey({ keyId: "k1", userId: "u1", db: TEST_DB });
      expect(r.ok).toBe(true);
      expect(state.api_keys[0].revoked_at).toBeDefined();
    });
  });

  describe("createApiKey", () => {
    it("inserts a row and returns the new id", async () => {
      const { mock, state } = makeDb([]);
      fetchMock.mockImplementation(mock);
      const r = await createApiKey({
        row: { user_id: "u1", key_hash: "abc", env: "live", key_prefix: "dq_live_a…" },
        db: TEST_DB,
      });
      expect(r.ok).toBe(true);
      expect(r.id).toBeDefined();
      expect(state.api_keys).toHaveLength(1);
    });
    it("surfaces upstream errors", async () => {
      fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
      const r = await createApiKey({ row: { user_id: "u1" }, db: TEST_DB });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("upstream_500");
    });
  });

  describe("touchApiKey", () => {
    it("is a silent no-op when service db is unconfigured", async () => {
      const prevUrl = process.env.SUPABASE_URL;
      const prevKey = process.env.SUPABASE_SERVICE_KEY;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_KEY;
      try {
        // Should NOT throw
        await touchApiKey("k1");
      } finally {
        if (prevUrl) process.env.SUPABASE_URL = prevUrl;
        if (prevKey) process.env.SUPABASE_SERVICE_KEY = prevKey;
      }
    });
  });

  describe("getServiceDb", () => {
    it("returns null when env is incomplete", () => {
      expect(getServiceDb({})).toBeNull();
    });
    it("returns a service handle when env is complete", () => {
      const d = getServiceDb({ SUPABASE_URL: "https://x", SUPABASE_SERVICE_KEY: "k" });
      expect(d).toBeTruthy();
      expect(d.base).toBe("https://x/rest/v1");
    });
  });
});
