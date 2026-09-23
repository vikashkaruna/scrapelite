// scripts/analytics-js.test.mjs — the Google tag loader, executed for real.
//
// public/analytics.js is plain browser JS served verbatim (not bundled), so it
// is tested by running it against a fake window rather than importing it.
//
// The behaviours asserted here are all ones whose failure is SILENT: a tag that
// loads on the wrong environment, a consent default that lands too late, or a
// page_view counted twice all look completely normal from the outside.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "public/analytics.js"), "utf8");
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");

/** Run analytics.js in a sandbox and report what it did. */
function run({ hostname = "datiq.app", pathname = "/", runtime, stored, isSpa = true } = {}) {
  const injected = [];
  const store = new Map();
  if (stored) store.set("datiq.consent", JSON.stringify(stored));

  const el = () => ({
    setAttribute() {}, addEventListener() {}, appendChild() {},
    remove() {}, style: {}, set async(v) { this._async = v; },
  });

  const sandbox = {
    location: { hostname, pathname },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    document: {
      documentElement: { hasAttribute: (a) => isSpa && a === "data-datiq-app" },
      readyState: "complete",
      head: { appendChild: (n) => injected.push(n) },
      body: { appendChild: (n) => injected.push(n) },
      cookie: "",
      getElementById: () => null,
      createElement: (tag) => {
        const node = el();
        node.tagName = tag.toUpperCase();
        Object.defineProperty(node, "src", {
          set(v) { node._src = v; }, get() { return node._src; }, configurable: true,
        });
        return node;
      },
      addEventListener() {},
      // PostHog's stub inserts array.js before the first <script> on the page.
      // In a real document that always exists (analytics.js is itself one), so
      // the sandbox has to model it or the stub throws and the loader silently
      // reports "PostHog did not load" for the wrong reason.
      getElementsByTagName: () => [{ parentNode: { insertBefore: (n) => injected.push(n) } }],
    },
    fetch: () => Promise.resolve({}),
    Blob: class {},
    navigator: {},
    setTimeout,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    dispatchEvent() {},
  };
  if (runtime !== undefined) sandbox.__DATIQ_RUNTIME__ = runtime;
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const scripts = injected.filter((n) => n.tagName === "SCRIPT");
  return {
    sandbox,
    injected,
    dataLayer: sandbox.dataLayer || [],
    gtagSrc: scripts.map((s) => s._src).filter(Boolean),
    api: sandbox.__datiqConsent,
    loaded: scripts.some((s) => (s._src || "").includes("googletagmanager.com")),
    posthogLoaded: scripts.some((s) => {
      try {
        const host = new URL(s._src || "").hostname;
        return host === "posthog.com" || host.endsWith(".posthog.com");
      } catch {
        return false;
      }
    }),
  };
}

/** Flatten the dataLayer's arguments-objects into inspectable arrays. */
function calls(dataLayer) {
  return dataLayer.map((a) => Array.from(a));
}

describe("analytics.js — measurement id resolution", () => {
  it("falls back to the built-in id when runtime-config has not run", () => {
    // Guards the load ORDER: if runtime-config.js has not executed, the key is
    // absent and we must still measure production rather than go dark.
    const r = run({ runtime: undefined, stored: { analytics: "granted" } });
    expect(r.loaded).toBe(true);
    expect(r.gtagSrc[0]).toContain("G-B0DZLRWG63");
  });

  it("treats an EMPTY id as deliberately disabled, not as absent", () => {
    // This distinction is the entire mechanism keeping staging and branch
    // deploys out of the production property. A plain `||` would collapse it
    // and every preview would report as production traffic.
    const r = run({ runtime: { gaMeasurementId: "" } });
    expect(r.loaded).toBe(false);
    expect(r.api.enabled).toBe(false);
  });

  it("uses a runtime-supplied id when present", () => {
    const r = run({ runtime: { gaMeasurementId: "G-STAGING1" }, stored: { analytics: "granted" } });
    expect(r.gtagSrc[0]).toContain("G-STAGING1");
  });
});

describe("analytics.js — where it refuses to run", () => {
  it("never loads on /admin", () => {
    // Admin traffic would both pollute the property and leak internal path
    // names into a third-party report.
    const r = run({ pathname: "/admin/revenue" });
    expect(r.loaded).toBe(false);
  });

  it("never loads on localhost by default", () => {
    expect(run({ hostname: "localhost" }).loaded).toBe(false);
    expect(run({ hostname: "127.0.0.1" }).loaded).toBe(false);
  });

  it("the localhost escape hatch cannot re-enable /admin", () => {
    const r = run({ hostname: "localhost", pathname: "/admin", runtime: { gaDebugLocal: true } });
    expect(r.loaded).toBe(false);
  });

  it("the localhost escape hatch works for ordinary pages", () => {
    const r = run({ hostname: "localhost", pathname: "/pricing", runtime: { gaDebugLocal: true }, stored: { analytics: "granted" } });
    expect(r.loaded).toBe(true);
  });

  it("does not load on an ordinary page before an explicit choice", () => {
    const r = run();
    expect(r.loaded).toBe(false);
    expect(r.api.active()).toBe(false);
  });
});

describe("analytics.js — Consent Mode v2", () => {
  it("pushes the denied default BEFORE gtag.js is injected", () => {
    // Ordering is the whole guarantee. A default that arrives after gtag.js has
    // run is a default that did not apply, and cookies may already be set.
    const r = run({ stored: { analytics: "granted" } });
    const c = calls(r.dataLayer);
    const defaultIdx = c.findIndex((a) => a[0] === "consent" && a[1] === "default");
    const jsIdx = c.findIndex((a) => a[0] === "js");
    expect(defaultIdx).toBeGreaterThanOrEqual(0);
    expect(defaultIdx).toBeLessThan(jsIdx);
  });

  it("denies every identifying storage type by default", () => {
    const c = calls(run({ stored: { analytics: "granted" } }).dataLayer);
    const def = c.find((a) => a[0] === "consent" && a[1] === "default")[2];
    expect(def.analytics_storage).toBe("denied");
    expect(def.ad_storage).toBe("denied");
    expect(def.ad_user_data).toBe("denied");
    expect(def.ad_personalization).toBe("denied");
    // Not tracking, and needed for the site to work at all.
    expect(def.functionality_storage).toBe("granted");
    expect(def.security_storage).toBe("granted");
  });

  it("upgrades immediately when consent was already granted", () => {
    const c = calls(run({ stored: { analytics: "granted" } }).dataLayer);
    const upd = c.find((a) => a[0] === "consent" && a[1] === "update");
    expect(upd[2].analytics_storage).toBe("granted");
  });

  it("does not upgrade for a stored denial", () => {
    const c = calls(run({ stored: { analytics: "denied" } }).dataLayer);
    const upd = c.find((a) => a[0] === "consent" && a[1] === "update");
    expect(upd).toBeUndefined();
  });

  it("loads only after the consent bridge receives an Allow choice", () => {
    const r = run();
    expect(r.loaded).toBe(false);
    r.sandbox.localStorage.setItem("datiq.consent", JSON.stringify({ analytics: "granted" }));
    r.api.set("granted");
    expect(r.injected.some((node) => (node._src || "").includes("googletagmanager.com"))).toBe(true);
    expect(r.api.active()).toBe(true);
  });

  it("anonymises IP and never enables ads personalisation", () => {
    const c = calls(run({ stored: { analytics: "granted" } }).dataLayer);
    const cfg = c.find((a) => a[0] === "config");
    expect(cfg[2].anonymize_ip).toBe(true);
  });
});

describe("analytics.js — page_view ownership", () => {
  it("leaves page_view to the router on the SPA", () => {
    // usePageView fires it manually after useSeo has set the title. If gtag
    // also sent one, every SPA navigation would be counted twice.
    const cfg = calls(run({ isSpa: true, stored: { analytics: "granted" } }).dataLayer).find((a) => a[0] === "config");
    expect(cfg[2].send_page_view).toBe(false);
  });

  it("sends its own page_view on a static page", () => {
    // No router there, so this is the only one that will ever fire.
    const cfg = calls(run({ isSpa: false, stored: { analytics: "granted" } }).dataLayer).find((a) => a[0] === "config");
    expect(cfg[2].send_page_view).toBe(true);
  });
});

describe("index.html wiring", () => {
  it("loads runtime-config.js BEFORE analytics.js", () => {
    // If this order flips, gaMeasurementId reads as absent and the PRODUCTION
    // property fires on staging, branch deploys and every preview.
    const rc = INDEX.indexOf('src="/runtime-config.js"');
    const an = INDEX.indexOf('src="/analytics.js"');
    expect(rc).toBeGreaterThan(-1);
    expect(an).toBeGreaterThan(-1);
    expect(rc).toBeLessThan(an);
  });

  it("loads analytics.js synchronously", () => {
    // async/defer would let gtag.js run before the consent default lands.
    const tag = INDEX.match(/<script[^>]*src="\/analytics\.js"[^>]*>/)[0];
    expect(tag).not.toMatch(/\basync\b|\bdefer\b/);
  });

  it("marks the shell so analytics.js can identify the SPA in <head>", () => {
    expect(INDEX).toMatch(/<html[^>]*data-datiq-app=/);
  });

  it("🔴 permits PostHog's asset origin in the CSP", () => {
    // PostHog loads array.js from <region>-assets.i.posthog.com, NOT from the
    // api_host. Without this the SDK is blocked by the browser and PostHog
    // records nothing at all — with only a console violation to show for it,
    // on a surface nobody watches. The inline snippet this replaced would have
    // shipped to datiq.app and captured zero events for exactly this reason.
    const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)[1];
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("https://us-assets.i.posthog.com");
    // connect-src carries the event beacon; it already wildcards https:.
    const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
    expect(connectSrc).toMatch(/https:/);
  });

  it("permits googletagmanager.com in the CSP", () => {
    // Without this the tag is blocked by the browser and GA records nothing,
    // with only a console violation to show for it.
    const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)[1];
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("https://www.googletagmanager.com");
  });

  it("permits plausible.io in the CSP", () => {
    const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
    const csp = toml.match(/Content-Security-Policy = "([^"]+)"/)[1];
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"));
    expect(scriptSrc).toContain("https://plausible.io");
  });

  it("loads Plausible tracking snippet in index.html", () => {
    expect(INDEX).toContain('src="https://plausible.io/js/pa-Eg7Xhgb7lalkDtpfmY-qf.js"');
    expect(INDEX).toContain("window.plausible");
  });
});

describe("analytics.js — PostHog is gated on the same consent as gtag.js", () => {
  // 🔴 PostHog's snippet initialises on execution: it writes a distinct_id and
  // starts capturing the moment it runs. Pasted into <head> — which is how it
  // arrived — it therefore tracks every visitor BEFORE the banner renders,
  // including the ones who then click Decline. That contradicts the consent
  // banner and the DPDP section of /privacy, and it fails silently: the only
  // symptom is data that should not exist.

  it("does not load before the visitor has chosen", () => {
    const r = run({});
    expect(r.posthogLoaded).toBe(false);
    expect(r.api.posthogActive()).toBe(false);
  });

  it("🔴 does not load for a stored DENIAL", () => {
    const r = run({ stored: { analytics: "denied" } });
    expect(r.posthogLoaded).toBe(false);
    expect(r.api.posthogActive()).toBe(false);
  });

  it("loads when consent was already granted", () => {
    const r = run({ stored: { analytics: "granted" } });
    expect(r.posthogLoaded).toBe(true);
    expect(r.api.posthogActive()).toBe(true);
  });

  it("loads only after the consent bridge receives an Allow choice", () => {
    const r = run({});
    expect(r.api.posthogActive()).toBe(false);
    r.sandbox.localStorage.setItem("datiq.consent", JSON.stringify({ analytics: "granted" }));
    r.api.set("granted");
    expect(r.api.posthogActive()).toBe(true);
  });

  it("never loads on /admin", () => {
    // The operator console must not leak internal path names into a
    // third-party product-analytics property, same rule as the Google tag.
    const r = run({ pathname: "/admin/revenue", stored: { analytics: "granted" } });
    expect(r.posthogLoaded).toBe(false);
  });

  it("never loads on localhost by default", () => {
    const r = run({ hostname: "localhost", stored: { analytics: "granted" } });
    expect(r.posthogLoaded).toBe(false);
  });

  it("treats an EMPTY posthogKey as deliberately disabled", () => {
    const r = run({ runtime: { posthogKey: "" }, stored: { analytics: "granted" } });
    expect(r.posthogLoaded).toBe(false);
  });

  it("uses a runtime-supplied key and host when present", () => {
    const r = run({
      runtime: { posthogKey: "phc_staging", posthogHost: "https://eu.i.posthog.com" },
      stored: { analytics: "granted" },
    });
    expect(r.posthogLoaded).toBe(true);
    expect(r.sandbox.posthog._i[0][0]).toBe("phc_staging");
    expect(r.sandbox.posthog._i[0][1].api_host).toBe("https://eu.i.posthog.com");
  });

  it("🔴 opts out and clears its cookies when consent is withdrawn", () => {
    const r = run({ stored: { analytics: "granted" } });
    expect(r.api.posthogActive()).toBe(true);
    let optedOut = false;
    r.sandbox.posthog.opt_out_capturing = () => { optedOut = true; };
    r.sandbox.posthog.reset = () => {};
    r.api.set("denied");
    expect(optedOut).toBe(true);
  });

  it("🔴 is NOT pasted into index.html — one consent gate, not two", () => {
    // A second copy in <head> would run before this file's gate and re-open
    // exactly the hole this suite exists to close.
    expect(INDEX).not.toMatch(/posthog\.init/i);
  });
});
