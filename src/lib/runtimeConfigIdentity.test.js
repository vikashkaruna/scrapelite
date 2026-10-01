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
 * Pull the (url, anonKey) pairs out of the file.
 *
 * Deliberately regex over the source rather than importing it: the module
 * assigns to `window` and branches on `location.hostname`, so evaluating it
 * needs a DOM and would only ever exercise ONE branch. We want every committed
 * pair checked, including the ones this environment would not select.
 *
 * Shape since the prod-cutover prep (2026-10-01): each setting is
 * `_isMain ? <prodVar> : <stagingVar>` and BOTH values live in
 * `var _prodSupabase…` / `var _stagingSupabase…` declarations — the prod pair
 * gained the same patchable seam the staging one has, so cutover-db.sh can
 * swap it for one hosting deploy. The pairs are
 * [prod-var-value, staging-var-value].
 */
function ternaryBranches(src, field) {
  const m = new RegExp(`${field}:\\s*_isMain\\s*\\?\\s*([\\w"]+)\\s*:\\s*(\\w+)`).exec(src);
  if (!m) return null;
  return [m[1].replace(/"/g, ""), m[2]];
}

/** Value of `var <ident> = "…"` in the source (a variable OR a bare literal). */
function varValue(src, ident) {
  if (!/^_/.test(ident)) return ident;   // already a literal from the regex
  const m = new RegExp(`var ${ident}\\s*=\\s*("[^"]*")`).exec(src);
  return m ? JSON.parse(m[1]) : null;
}

function readPairs() {
  const src = readFileSync(RUNTIME_CONFIG, "utf8");
  const urls = ternaryBranches(src, "supabaseUrl");
  const keys = ternaryBranches(src, "supabaseAnonKey");
  // Resolve the identifier branches into their committed values.
  return {
    urls: urls ? [varValue(src, urls[0]), varValue(src, urls[1])] : null,
    keys: keys ? [varValue(src, keys[0]), varValue(src, keys[1])] : null,
    src,
  };
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

  it("the COMMITTED staging pair stays the hosted dev project", () => {
    // The staging DB cutover (12-STAGING-DB-CUTOVER.md) repoints staging to
    // the self-hosted trio, but it does so by patching runtime-config.js for
    // the duration of ONE hosting deploy and restoring the committed form
    // after. A committed flip would ship the self-hosted pair to Netlify
    // branch deploys BEFORE the /auth/v1+/rest/v1 rewrites exist, breaking
    // every non-production deploy. This is the tripwire that stops a flip
    // being committed by mistake.
    const { urls, keys } = readPairs();
    expect(urls[1]).toBe("https://aubwooslkkrprdxuiyvj.supabase.co");
    // The staging key must remain the hosted dev project's publishable key.
    expect(keys[1]).toBe("sb_publishable_NXSVmJA_neFWqLGEiCmkEg_j8I03VLG");
  });
});
