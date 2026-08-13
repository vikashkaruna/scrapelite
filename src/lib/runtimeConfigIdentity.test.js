// public/runtime-config.js ships BOTH Supabase projects' URL + anon-key pairs
// in git, and its own comment tells operators to copy those values into the
// Netlify env. So a wrong pair in that file does not stay in that file — it
// propagates into every environment that follows the documented procedure.
//
// That is exactly what happened: the dev/staging pair disagreed by ONE
// character, and because the project ref only exists base64-encoded inside the
// JWT, no amount of reading the file could reveal it. Supabase's only feedback
// was "Invalid API key", which names neither side.
//
// This test decodes every committed key and asserts it belongs to the project
// it is paired with. Run once, it would have caught the typo at commit time
// instead of after three debugging sessions across two environments.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME_CONFIG = resolve(HERE, "../../public/runtime-config.js");

/** Payload-only decode. Mirrors decodeSupabaseKey in supabaseServerClient.js. */
function claims(key) {
  if (/^sb_(publishable|secret)_/.test(key)) return { format: "publishable" };
  const parts = key.split(".");
  if (parts.length !== 3) return { format: "unknown" };
  try {
    return { format: "jwt", ...JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) };
  } catch {
    return { format: "unknown" };
  }
}

const refFromUrl = (url) => new URL(url).hostname.split(".")[0];

/**
 * Pull the (url, anonKey) pairs out of the file, matched by ternary branch.
 *
 * Deliberately regex over the source rather than importing it: the module
 * assigns to `window` and branches on `location.hostname`, so evaluating it
 * needs a DOM and would only ever exercise ONE branch. We want every committed
 * pair checked, including the ones this environment would not select.
 *
 * Both settings are written as `_isMain ? <production> : <everything-else>`,
 * so branch 0 of one lines up with branch 0 of the other. Pairing by branch
 * rather than by document order also means an intentionally-empty key (which
 * defers to the Netlify env) stays correctly associated with its URL.
 */
function ternaryBranches(src, field) {
  const m = new RegExp(`${field}:\\s*_isMain\\s*\\?\\s*("[^"]*")\\s*:\\s*("[^"]*")`).exec(src);
  if (!m) return null;
  return [JSON.parse(m[1]), JSON.parse(m[2])];
}

function readPairs() {
  const src = readFileSync(RUNTIME_CONFIG, "utf8");
  const urls = ternaryBranches(src, "supabaseUrl");
  const keys = ternaryBranches(src, "supabaseAnonKey");
  return { urls, keys, src };
}

describe("public/runtime-config.js — committed Supabase identities", () => {
  it("exposes both settings as parseable _isMain ternaries", () => {
    // If the file's shape changes, every assertion below would silently pass
    // on nothing. Fail loudly instead.
    const { urls, keys } = readPairs();
    expect(urls).not.toBeNull();
    expect(keys).not.toBeNull();
    expect(urls).toHaveLength(2);
    expect(keys).toHaveLength(2);
  });

  it("every committed anon key belongs to the project it is paired with", () => {
    const { urls, keys } = readPairs();
    const mismatches = [];
    urls.forEach((url, i) => {
      const key = keys[i];
      // An empty key is a deliberate "defer to the Netlify env" — config.js
      // falls back to the build-time VITE_SUPABASE_ANON_KEY. Nothing to check.
      if (!key) return;
      const urlRef = refFromUrl(url);
      const c = claims(key);
      if (c.format !== "jwt") return; // publishable-format keys carry no ref
      if (c.ref !== urlRef) {
        mismatches.push(
          `${url} expects project "${urlRef}" but its key is issued for "${c.ref}"`,
        );
      }
    });
    expect(mismatches).toEqual([]);
  });

  it("every committed key is an anon key, never a service_role key", () => {
    // A service key here would be compiled into the browser bundle and bypass
    // RLS for every visitor — the worst thing that could be pasted by accident
    // while swapping keys between two projects.
    const { keys } = readPairs();
    for (const key of keys) {
      if (!key) continue;
      const c = claims(key);
      if (c.format !== "jwt") continue;
      expect(c.role).toBe("anon");
    }
  });

  it("no committed key is expired", () => {
    const { keys } = readPairs();
    for (const key of keys) {
      if (!key) continue;
      const c = claims(key);
      if (c.format !== "jwt" || !c.exp) continue;
      expect(c.exp * 1000).toBeGreaterThan(Date.now());
    }
  });

  it("SUPABASE_URL values are project URLs, not the custom auth domain", () => {
    // api.datiq.app fronts /auth/v1 only. Pointing supabaseUrl at it leaves
    // every /rest/v1 call with nothing behind it — production's exact fault.
    const { src } = readPairs();
    expect(src).not.toMatch(/supabaseUrl:\s*[\s\S]{0,120}api\.datiq\.app/);
  });
});
