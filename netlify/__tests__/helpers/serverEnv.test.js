// netlify/__tests__/helpers/serverEnv.test.js
//
// Keeps the shared env list honest.
//
// The bug this guards: three contract test files each kept their OWN list of
// env vars to clear, and none included VITE_SUPABASE_URL. Vitest loads .env
// into process.env, so on any machine with real credentials —
// i.e. every developer's — supabaseServerClient resolved
// `SUPABASE_URL || VITE_SUPABASE_URL` against a leaked value and three tests
// failed. CI, with no .env, stayed green the whole time.
//
// A list that has to be updated by hand whenever the code reads a new variable
// WILL fall behind. So this derives the truth from the source and fails when
// the list is missing something.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SERVER_ENV_KEYS, SUPABASE_ENV_KEYS, clearServerEnv } from "./serverEnv.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every process.env key referenced by a source file. */
function envKeysIn(relPath) {
  const src = readFileSync(join(ROOT, relPath), "utf8");
  const keys = new Set();
  for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\benv\(["']([A-Z][A-Z0-9_]*)["']\)/g)) keys.add(m[1]);
  return [...keys];
}

describe("shared server env list", () => {
  it("covers every variable supabaseServerClient resolves", () => {
    // This is the file whose SUPABASE_URL || VITE_SUPABASE_URL fallback caused
    // the leak. If it starts reading a new variable, this fails immediately
    // rather than three suites going red on someone's laptop months later.
    const used = envKeysIn("netlify/functions/lib/supabaseServerClient.js");
    const missing = used.filter((k) => !ALL_SERVER_ENV_KEYS.includes(k));
    expect(missing).toEqual([]);
  });

  it("covers every variable the health probes resolve", () => {
    const used = envKeysIn("netlify/functions/lib/healthProbes.js");
    const missing = used.filter((k) => !ALL_SERVER_ENV_KEYS.includes(k));
    expect(missing).toEqual([]);
  });

  it("keeps URL and key variables together as pairs", () => {
    // Clearing only one half of a pair is what produced the original failure:
    // the test's SUPABASE_URL was compared against a leaked
    // VITE_SUPABASE_ANON_KEY belonging to a different project.
    for (const pair of [
      ["SUPABASE_URL", "VITE_SUPABASE_URL"],
      ["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"],
    ]) {
      for (const k of pair) expect(SUPABASE_ENV_KEYS).toContain(k);
    }
  });

  it("actually deletes the variables", () => {
    process.env.SUPABASE_URL = "https://leaked.supabase.co";
    process.env.VITE_SUPABASE_URL = "https://also-leaked.supabase.co";
    clearServerEnv();
    expect(process.env.SUPABASE_URL).toBeUndefined();
    expect(process.env.VITE_SUPABASE_URL).toBeUndefined();
  });

  it("has no duplicate entries", () => {
    expect(ALL_SERVER_ENV_KEYS.length).toBe(new Set(ALL_SERVER_ENV_KEYS).size);
  });
});
