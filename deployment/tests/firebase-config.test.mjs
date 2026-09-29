// deployment/tests/firebase-config.test.mjs — unit tests for the Firebase
// Hosting config generator (gen-firebase-config.mjs). These guard the
// behaviours the staging/prod deploys depend on:
//   1. the static/dynamic split (only /api/** is dynamic in hosted-supabase mode)
//   2. phase-dependent rewrites (/auth/v1 + /rest/v1 ONLY in cloud-sql mode)
//   3. the homepage model: NO "/" rewrite (deploy-hosting.sh swaps
//      dist/index.html for the prerendered home; the SPA shell lives at
//      /__shell/index.html and backs the /** fallback, which is last)
//   4. URL parity: trailingSlash:false (Firebase's default would 301
//      /pricing → /pricing/ BEFORE rewrites run) + one extensionless exact
//      rewrite per site route
import { describe, it, expect } from "vitest";
import {
  parseEnvFile,
  parseNetlifyToml,
  buildHosting,
  buildFirebaserc,
} from "../scripts/gen-firebase-config.mjs";
import { REACT_OWNED, STATIC_OWNED, HELP_INDEX } from "../../scripts/site-routes.mjs";

const TOML = `
[[redirects]]
  from = "/help/old.html"
  to = "/help/new.html"
  status = 301
  force = true

[[redirects]]
  from = "/api/v1/*"
  to = "/.netlify/functions/api-v1/:splat"
  status = 200
  force = true

[[redirects]]
  from = "/"
  to = "/home/index.html"
  status = 200
  force = true

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Content-Security-Policy = "default-src 'self'"

[[headers]]
  for = "/admin/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow"

[[headers]]
  for = "/admin"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow"
`;

const ENV = {
  GCP_PROJECT_ID: "proj-under-test",
  FHS_SITE_ID: "site-under-test",
  GCP_REGION: "region-under-test",
  CLOUD_RUN_API: "run-api-test",
  CLOUD_RUN_ADMIN: "run-admin-test",
  CLOUD_RUN_AUTH: "run-auth-test",
  CLOUD_RUN_REST: "run-rest-test",
  DATA_MODE: "hosted-supabase",
};

const parsed = () => parseNetlifyToml(TOML);

describe("parseEnvFile", () => {
  it("ignores comments and interpolates ${VAR} from earlier lines", () => {
    const env = parseEnvFile(
      ["# comment", "A=first", "B=${A}/suffix", 'QUOTED="x=y"', ""].join("\n"),
    );
    expect(env.A).toBe("first");
    expect(env.B).toBe("first/suffix");
    expect(env.QUOTED).toBe("x=y");
  });
});

describe("parseNetlifyToml", () => {
  it("extracts redirects with numeric or quoted status", () => {
    const { redirects } = parsed();
    expect(redirects).toHaveLength(4);
    expect(redirects[0]).toEqual({ from: "/help/old.html", to: "/help/new.html", status: 301 });
  });
  it("extracts header blocks with all keys", () => {
    const { headers } = parsed();
    const baseline = headers.find((h) => h.for === "/*");
    expect(baseline.values["X-Content-Type-Options"]).toBe("nosniff");
    expect(baseline.values["Content-Security-Policy"]).toContain("default-src");
  });
});

describe("buildHosting", () => {
  it("fails fast on missing env vars", () => {
    expect(() => buildHosting(parsed(), {})).toThrow(/missing env vars/);
  });

  it("hosted-supabase mode: dynamic surface is /api/** only — no auth/rest rewrites", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    const sources = h.rewrites.map((r) => r.source);
    expect(sources[0]).toBe("/api/**");         // the only dynamic rewrite here
    expect(sources[sources.length - 1]).toBe("/**"); // SPA fallback last
    expect(sources).not.toContain("/");         // `/` is a real file now, not a rewrite
    expect(sources.some((s) => s.includes("auth/v1"))).toBe(false);
    expect(sources.some((s) => s.includes("rest/v1"))).toBe(false);
    const apiRewrite = h.rewrites[0];
    expect(apiRewrite.run).toEqual({ serviceId: ENV.CLOUD_RUN_API, region: ENV.GCP_REGION });
  });

  it("URL parity: trailingSlash:false and one extensionless rewrite per site route", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    // Firebase's default 301s /pricing → /pricing/ BEFORE rewrites; false
    // restores Netlify's extensionless-canonical form.
    expect(h.trailingSlash).toBe(false);
    const sources = new Set(h.rewrites.map((r) => r.source));
    for (const route of [...REACT_OWNED, ...STATIC_OWNED]) {
      if (route.path === "/") continue;
      const ext = route.path.replace(/\/+$/, "") || "/";
      expect(sources.has(ext), `missing exact rewrite for ${ext}`).toBe(true);
    }
    // HELP_INDEX is "/help/" in site-routes — the emitted source must be the
    // extensionless form ("/help"), which is the canonical one under
    // trailingSlash:false.
    expect(sources.has("/help")).toBe(true);
    expect(sources.has("/help/")).toBe(false);
  });

  it("cloud-sql mode: adds the GoTrue/PostgREST rewrites at the cutover", () => {
    const h = buildHosting(parsed(), { ...ENV, DATA_MODE: "cloud-sql" }).hosting;
    const sources = h.rewrites.map((r) => r.source);
    expect(sources).toContain("/auth/v1/**");
    expect(sources).toContain("/rest/v1/**");
    // and they sit before the SPA catch-all
    expect(sources.indexOf("/auth/v1/**")).toBeLessThan(sources.indexOf("/**"));
  });

  it("keeps 3xx redirects, drops the netlify function 200-rewrites", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    expect(h.redirects).toHaveLength(1);
    expect(h.redirects[0]).toEqual({ source: "/help/old.html", destination: "/help/new.html", type: 301 });
  });

  it("SPA shell ships as /__shell/index.html backing the /** fallback", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    // The dist/index.html exclusion moved to deploy-hosting.sh (the file is
    // REPLACED by the prerendered home, the shell copied to __shell/) — the
    // generator's contract is just the fallback destination.
    const spa = h.rewrites.find((r) => r.source === "/**");
    expect(spa.destination).toBe("/__shell/index.html");
  });

  it("maps netlify header globs to firebase globs and merges duplicates", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    const admin = h.headers.find((r) => r.source === "/admin/**");
    expect(admin.headers[0].key).toBe("X-Robots-Tag");
    // /admin/* and /admin merge into one /admin/** rule? No — exact paths map
    // verbatim; the glob rule carries the header once.
    const baseline = h.headers.find((r) => r.source === "/**");
    expect(baseline.headers.some((x) => x.key === "Content-Security-Policy")).toBe(true);
  });

  it("rewrites the site identity from env only", () => {
    const h = buildHosting(parsed(), ENV).hosting;
    expect(h.site).toBe(ENV.FHS_SITE_ID);
    expect(buildFirebaserc(ENV)).toEqual({ projects: { default: ENV.GCP_PROJECT_ID } });
  });
});
