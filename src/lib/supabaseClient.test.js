import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSupabaseEnabled } from "./supabaseClient.js";

/**
 * U-70..71 — supabaseClient is the singleton for the Supabase client.
 * The contract:
 *   - When VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing,
 *     `supabase` is null (the app falls back to localStorage).
 *   - When both are set, createClient is called with the right values.
 *
 * Note: the module has a module-level side effect (createClient runs at
 * import time), so the tests only assert the observable surface
 * (isSupabaseEnabled) and use vi.resetModules to re-import with a
 * different env.
 */

let env;

beforeEach(() => {
  env = { ...process.env };
});

afterEach(() => {
  process.env = env;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("supabaseClient (U-70)", () => {
  it("isSupabaseEnabled is false when env is unset", async () => {
    vi.resetModules();
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const mod = await import("./supabaseClient.js");
    expect(mod.isSupabaseEnabled).toBe(false);
  });
});

describe("supabaseClient (U-71)", () => {
  it("createClient is called with the right URL and key when env is set", async () => {
    vi.resetModules();
    process.env.VITE_SUPABASE_URL = "https://abc.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key-xyz";

    const createClientMock = vi.fn(() => ({ auth: {}, from: vi.fn() }));
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: createClientMock,
    }));

    const mod = await import("./supabaseClient.js");
    expect(mod.isSupabaseEnabled).toBe(true);
    expect(createClientMock).toHaveBeenCalledWith("https://abc.supabase.co", "anon-key-xyz");
  });
});
