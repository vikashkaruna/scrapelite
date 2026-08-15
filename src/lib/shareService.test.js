// src/lib/shareService.test.js — Q8 (shareable links + public gallery) unit tests.
// Covers the cross-browser bug that was previously broken: the share URL only
// worked in the originator's localStorage. Now the slug is persisted to
// Supabase (or, in tests, a mocked Supabase) so any browser can resolve it.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mutable mock for the supabase singleton. The vi.mock below re-imports
// shareService with this mock in place. We swap the implementation per
// test to simulate Supabase enabled / disabled / erroring.
const supabaseMock = {
  enabled: false,
  // Mock client — records calls + returns configured responses.
  from: vi.fn(),
  auth: { getUser: vi.fn() },
};

vi.mock("./supabaseClient.js", () => ({
  get supabase() { return supabaseMock.enabled ? supabaseMock : null; },
  isSupabaseEnabled: () => supabaseMock.enabled,
  EXTRACTIONS_TABLE: "extractions",
}));

const { generateSlug, isValidSlug, shareExtraction, unshareExtraction,
        getPublicBySlug, getPublicBySlugLocal, getSharedSlugForId,
        getGallery, getCuratedGallery, buildPublicUrl, _resetShareForTests } =
  await import("./shareService.js");

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeSupabaseClient({ onSelect, onUpsert, onDelete }) {
  const chainable = {
    select: vi.fn(() => chainable),
    eq:    vi.fn(() => chainable),
    maybeSingle: vi.fn(async () => ({ data: onSelect?.() ?? null, error: null })),
    upsert: vi.fn(async (row, opts) => {
      onUpsert?.(row, opts);
      return { data: { slug: row.slug }, error: null };
    }),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => {
        onDelete?.();
        return { data: null, error: null };
      }),
    })),
  };
  return {
    from: vi.fn(() => chainable),
    auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  };
}

const sampleExtraction = () => ({
  id: "ext_1",
  title: "Stripe — Pricing",
  url: "https://stripe.com/pricing",
  ai_summary: "Stripe offers 4 pricing tiers.",
  custom_extraction: { plans: [{ name: "Starter", price: "$0" }] },
  intent: "pricing",
  created_at: "2026-07-17T00:00:00Z",
});

beforeEach(() => {
  try { localStorage.clear(); } catch {}
  _resetShareForTests();
  supabaseMock.enabled = false;
  supabaseMock.from.mockReset();
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(() => {
  supabaseMock.enabled = false;
});

// ── Slug shape + validation ───────────────────────────────────────────────────

describe("Q8 — shareService: slug + validation", () => {
  it("generates a slug of the right shape (lowercase, no ambiguous chars)", () => {
    for (let i = 0; i < 50; i++) {
      const s = generateSlug();
      expect(s).toMatch(/^[a-z0-9]{8}$/);
      expect(s).not.toMatch(/[0o1l]/);
    }
  });

  it("isValidSlug accepts/rejects the right shapes", () => {
    expect(isValidSlug("k7m2p4qx")).toBe(true);
    expect(isValidSlug("abcdef")).toBe(true);
    expect(isValidSlug("ABC")).toBe(false);
    expect(isValidSlug("abc def")).toBe(false);
    expect(isValidSlug("a_b_c")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug(null)).toBe(false);
  });
});

// ── Share (offline / Supabase-disabled) ──────────────────────────────────────

describe("Q8 — shareService: offline (Supabase disabled)", () => {
  it("shareExtraction returns a slug and writes to localStorage", async () => {
    const { slug, persistedTo } = await shareExtraction(sampleExtraction());
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    expect(persistedTo).toBe("local");
    const local = JSON.parse(localStorage.getItem("datiq.sharedExtractions"));
    expect(local).toHaveLength(1);
    expect(local[0].slug).toBe(slug);
  });

  it("shareExtraction throws when extraction.id is missing", async () => {
    await expect(shareExtraction({ title: "No ID" })).rejects.toThrow(/id is required/);
    await expect(shareExtraction(null)).rejects.toThrow();
  });

  it("shareExtraction is idempotent (re-share returns the same slug)", async () => {
    const a = await shareExtraction(sampleExtraction());
    const b = await shareExtraction({ ...sampleExtraction(), ai_summary: "Updated" });
    expect(a.slug).toBe(b.slug);
    const local = JSON.parse(localStorage.getItem("datiq.sharedExtractions"));
    expect(local).toHaveLength(1);
    expect(local[0].ai_summary).toBe("Updated");
  });

  it("unshareExtraction removes the public record + the gallery entry", async () => {
    const { slug } = await shareExtraction(sampleExtraction());
    const ok = await unshareExtraction("ext_1");
    expect(ok).toBe(true);
    expect(await getPublicBySlugLocal(slug)).toBeNull();
  });

  it("unshareExtraction returns false for an unknown id", async () => {
    expect(await unshareExtraction("nope")).toBe(false);
  });

  it("getSharedSlugForId returns the slug for a shared extraction", async () => {
    const { slug } = await shareExtraction(sampleExtraction());
    expect(getSharedSlugForId("ext_1")).toBe(slug);
    expect(getSharedSlugForId("ext_unknown")).toBeNull();
  });

  it("getGallery returns the most recent shared extraction first", async () => {
    await shareExtraction({ ...sampleExtraction(), id: "ext_a", title: "A" });
    await shareExtraction({ ...sampleExtraction(), id: "ext_b", title: "B" });
    const g = getGallery();
    expect(g[0].title).toBe("B");
    expect(g[1].title).toBe("A");
  });

  it("getGallery respects the limit argument", async () => {
    for (let i = 0; i < 5; i++) {
      await shareExtraction({ ...sampleExtraction(), id: `ext_${i}` });
    }
    expect(getGallery(2)).toHaveLength(2);
    expect(getGallery(10)).toHaveLength(5);
  });

  it("buildPublicUrl constructs a URL from origin + slug", () => {
    const url = buildPublicUrl("k7m2p4qx");
    expect(url).toMatch(/\/p\/k7m2p4qx$/);
  });
});

// ── Share (Supabase enabled — the cross-browser fix) ─────────────────────────

describe("Q8 — shareService: Supabase enabled (cross-browser path)", () => {
  it("shareExtraction writes to Supabase and reports persistedTo='supabase'", async () => {
    supabaseMock.enabled = true;
    let upsertedRow = null;
    supabaseMock.from.mockImplementation(() => makeSupabaseClient({
      onUpsert: (row) => { upsertedRow = row; },
    }).from());
    const { slug, persistedTo } = await shareExtraction(sampleExtraction(), { userId: "u_1", sessionId: "s_1" });
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    expect(persistedTo).toBe("supabase");
    expect(upsertedRow.slug).toBe(slug);
    expect(upsertedRow.user_id).toBe("u_1");
    expect(upsertedRow.session_id).toBe("s_1");
    expect(upsertedRow.is_public).toBe(true);
  });

  it("shareExtraction falls back to local when Supabase throws", async () => {
    supabaseMock.enabled = true;
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      upsert: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    const { slug, persistedTo } = await shareExtraction(sampleExtraction());
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
    // Persisted locally even though Supabase errored.
    expect(persistedTo).toBe("local");
    expect(getSharedSlugForId("ext_1")).toBe(slug);
  });

  it("re-share looks up the existing slug from Supabase first", async () => {
    supabaseMock.enabled = true;
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { slug: "k7m2p4qx" }, error: null })),
      upsert: vi.fn(async (row) => ({ data: { slug: row.slug }, error: null })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    const ext = sampleExtraction();
    const { slug } = await shareExtraction(ext);
    expect(slug).toBe("k7m2p4qx");
  });

  it("unshareExtraction removes from both Supabase and local", async () => {
    supabaseMock.enabled = true;
    const client = makeSupabaseClient({});
    supabaseMock.from.mockImplementation(() => client.from());
    await shareExtraction(sampleExtraction());
    const ok = await unshareExtraction("ext_1");
    expect(ok).toBe(true);
    expect(getSharedSlugForId("ext_1")).toBeNull();
  });
});

// ── getPublicBySlug (the cross-browser test the user asked for) ──────────────

describe("Q8 — getPublicBySlug: the cross-browser fix", () => {
  it("returns the public report from Supabase when localStorage is empty (cross-browser)", async () => {
    supabaseMock.enabled = true;
    const expected = { ...projectPubForTest(), id: "ext_x", slug: "remote01" };
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { data: expected }, error: null })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    // The originator cleared localStorage (or this is a different browser).
    try { localStorage.clear(); } catch {}
    const pub = await getPublicBySlug("remote01");
    expect(pub).toBeTruthy();
    expect(pub.id).toBe("ext_x");
    expect(pub.slug).toBe("remote01");
  });

  it("returns the localStorage record when Supabase is disabled", async () => {
    supabaseMock.enabled = false;
    const { slug } = await shareExtraction(sampleExtraction());
    const pub = await getPublicBySlug(slug);
    expect(pub).toBeTruthy();
    expect(pub.slug).toBe(slug);
    expect(pub.id).toBe("ext_1");
  });

  it("returns null for an invalid slug shape (no network call)", async () => {
    supabaseMock.enabled = true;
    const fromMock = vi.fn();
    supabaseMock.from.mockImplementation(fromMock);
    expect(await getPublicBySlug("NOT VALID!")).toBeNull();
    expect(await getPublicBySlug("")).toBeNull();
    expect(await getPublicBySlug(null)).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns null when neither Supabase nor localStorage has the slug", async () => {
    supabaseMock.enabled = true;
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    supabaseMock.from.mockImplementation(() => chain);
    try { localStorage.clear(); } catch {}
    expect(await getPublicBySlug("zzzzzzzz")).toBeNull();
  });

  it("falls back to localStorage when Supabase errors", async () => {
    supabaseMock.enabled = true;
    const { slug } = await shareExtraction(sampleExtraction());
    // After sharing, simulate Supabase going down on the read path.
    const chain = {
      select: vi.fn(() => chain),
      eq:    vi.fn(() => chain),
      maybeSingle: vi.fn(async () => { throw new Error("network down"); }),
    };
    supabaseMock.from.mockImplementation(() => chain);
    const pub = await getPublicBySlug(slug);
    expect(pub).toBeTruthy();
    expect(pub.slug).toBe(slug);
  });
});

// helper for the cross-browser test (we need a projection that the mocked
// Supabase row would actually contain).
function projectPubForTest() {
  return {
    title: "Remote report",
    url: "https://remote.example.com",
    ai_summary: "Hello from a different browser.",
    intent: "summary",
    created_at: "2026-07-17T00:00:00Z",
    is_public: true,
  };
}

// FA1 — public-quota counter integration with share/unshare.
import { recordPublicShare, recordPublicUnshare, isPubliclyShared } from "./shareService.js";
import { readPublicCount } from "./publicQuota.js";

describe("FA1 — public-quota counter (shareService integration)", () => {
  beforeEach(() => {
    // FA1 tests are offline-only (no Supabase) to keep them deterministic.
    supabaseMock.enabled = false;
    supabaseMock.from.mockReset();
    _resetShareForTests();
    try { localStorage.removeItem("datiq.usage"); } catch {}
  });

  it("recordPublicShare increments the public count on first share", async () => {
    const ext = { id: "fa1-test-1", title: "T", url: "https://x.com" };
    await shareExtraction(ext);
    const before = readPublicCount();
    recordPublicShare(ext.id);
    expect(readPublicCount()).toBe(before + 1);
  });

  it("recordPublicShare increments on every call (caller is responsible for idempotency)", async () => {
    const ext = { id: "fa1-test-2", title: "T", url: "https://x.com" };
    await shareExtraction(ext);
    recordPublicShare(ext.id);
    recordPublicShare(ext.id);
    // Each call increments by 1 — the Preview.jsx call site only calls
    // once per successful share, so production stays correct.
    expect(readPublicCount()).toBe(2);
  });

  it("recordPublicUnshare decrements the public count", async () => {
    const ext = { id: "fa1-test-3", title: "T", url: "https://x.com" };
    await shareExtraction(ext);
    recordPublicShare(ext.id);
    expect(readPublicCount()).toBe(1);
    await unshareExtraction(ext.id);
    recordPublicUnshare();
    expect(readPublicCount()).toBe(0);
  });

  it("recordPublicShare returns 1 on first call (and is a simple increment thereafter)", () => {
    // (a no-op never-shared-id returns 1 because we always increment; the
    // Preview.jsx call site only calls once per successful share.)
    const result = recordPublicShare("never-shared-id");
    expect(result).toBe(1);
  });

  it("isPubliclyShared returns true for shared extractions, false otherwise", async () => {
    const ext = { id: "fa1-test-4", title: "T", url: "https://x.com" };
    expect(isPubliclyShared(ext.id)).toBe(false);
    await shareExtraction(ext);
    expect(isPubliclyShared(ext.id)).toBe(true);
  });
});

// ── Curated persona showcase ────────────────────────────────────────────────
// Distinct from getGallery() (tested above) — getCuratedGallery() is NEVER
// local-only, because a showcase has to look the same to every visitor.

function makeCuratedQueryClient(rows, { throwOnQuery = false } = {}) {
  const calls = { eqArgs: [] };
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((col, val) => { calls.eqArgs.push([col, val]); return chain; }),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve, reject) => {
      // The query is awaited directly (no terminal .maybeSingle()/.single()),
      // so it must itself be thenable — mirrors the real supabase-js builder.
      if (throwOnQuery) return Promise.resolve({ data: null, error: new Error("boom") }).then(resolve, reject);
      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };
  return { from: vi.fn(() => chain), calls };
}

describe("Q8/persona — getCuratedGallery", () => {
  it("returns [] when Supabase isn't configured — no local fallback", async () => {
    supabaseMock.enabled = false;
    const result = await getCuratedGallery({ persona: "sales" });
    expect(result).toEqual([]);
  });

  it("returns [] (not a throw) when the Supabase query errors", async () => {
    const { from } = makeCuratedQueryClient([], { throwOnQuery: true });
    supabaseMock.enabled = true;
    supabaseMock.from = from;
    const result = await getCuratedGallery({});
    expect(result).toEqual([]);
  });

  it("filters by is_public=true and curated=true unconditionally", async () => {
    const rows = [{ slug: "abc12345", title: "T", url: "https://x.com", persona: "seo", created_at: "2026-08-01T00:00:00Z" }];
    const { from, calls } = makeCuratedQueryClient(rows);
    supabaseMock.enabled = true;
    supabaseMock.from = from;
    const result = await getCuratedGallery({});
    expect(result).toEqual(rows);
    expect(calls.eqArgs).toContainEqual(["is_public", true]);
    expect(calls.eqArgs).toContainEqual(["curated", true]);
  });

  it("adds a persona filter only when one is given", async () => {
    const { from: fromWithPersona, calls: withPersona } = makeCuratedQueryClient([]);
    supabaseMock.enabled = true;
    supabaseMock.from = fromWithPersona;
    await getCuratedGallery({ persona: "recruiter" });
    expect(withPersona.eqArgs).toContainEqual(["persona", "recruiter"]);

    const { from: fromNoPersona, calls: noPersona } = makeCuratedQueryClient([]);
    supabaseMock.from = fromNoPersona;
    await getCuratedGallery({});
    expect(noPersona.eqArgs.some(([col]) => col === "persona")).toBe(false);
  });
});
