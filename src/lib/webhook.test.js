// webhook.test.js
//
// U-42 — webhook is a fire-and-forget notification. The contract is:
//   1. POST JSON to the resolved URL (user URL > env URL).
//   2. The payload includes event, sent_at, source, data.
//   3. fetch failures are swallowed (never thrown to the caller).
//   4. keepalive: true so the request continues after page unload.
//
// U-44 — per-user URL takes precedence over the platform URL.
// Note: src/lib/config.js reads `import.meta.env.VITE_WEBHOOK_URL`
// at module-load time, so each test must vi.resetModules() and
// re-import config.js + webhook.js to pick up a freshly-mutated
// process.env. Tests that DON'T touch the env URL can use the
// already-loaded module directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUserWebhookUrl, clearUserWebhookUrl, STORAGE_KEY } from "./userWebhook.js";

const ENV_WEBHOOK = "https://hook.example.com/datiq";
const USER_WEBHOOK = "https://hooks.zapier.com/abc/xyz";

let originalEnv;
let fetchMock;
let warnSpy;

beforeEach(() => {
  originalEnv = { ...process.env };
  localStorage.clear();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = originalEnv;
  localStorage.clear();
  vi.restoreAllMocks();
});

// Re-import config + webhook with the current process.env, returning
// a fresh notifyWebhook bound to a fresh fetch mock. Mirrors the
// pattern in the original test: vi.resetModules + dynamic import.
async function loadFreshWebhook({ envUrl = null, userUrl = null, fetchImpl } = {}) {
  vi.resetModules();
  if (envUrl) {
    process.env.VITE_WEBHOOK_URL = envUrl;
  } else {
    delete process.env.VITE_WEBHOOK_URL;
  }
  if (userUrl) {
    // Persist AFTER vi.resetModules so the localStorage write uses
    // a fresh globalThis.localStorage.
    const storage = (typeof localStorage !== "undefined" ? localStorage : null);
    if (storage) storage.setItem(STORAGE_KEY, userUrl);
  }
  fetchImpl = fetchImpl || vi.fn(async () => new Response("", { status: 200 }));
  globalThis.fetch = fetchImpl;
  // Re-import both modules so config.js re-reads import.meta.env from
  // the updated process.env.
  const { notifyWebhook, getEffectiveWebhookUrl, resolveWebhookUrl } = await import("./webhook.js");
  return { notifyWebhook, getEffectiveWebhookUrl, resolveWebhookUrl, fetchImpl };
}

describe("notifyWebhook — URL resolution", () => {
  it("posts to the platform VITE_WEBHOOK_URL when no user URL is set", async () => {
    const { notifyWebhook, fetchImpl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK });
    await notifyWebhook({ id: "ext_1", url: "https://example.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENV_WEBHOOK);
  });

  it("posts to the USER URL when the user has set one (overrides platform URL)", async () => {
    const { notifyWebhook, fetchImpl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK, userUrl: USER_WEBHOOK });
    await notifyWebhook({ id: "ext_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(USER_WEBHOOK);
  });

  it("no-ops when neither user URL nor env URL is set", async () => {
    const { notifyWebhook, fetchImpl } = await loadFreshWebhook({});
    await notifyWebhook({ id: "ext_1" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores an invalid stored URL and falls back to the env URL", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = ENV_WEBHOOK;
    localStorage.setItem(STORAGE_KEY, "javascript:alert(1)");
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchImpl;
    const { notifyWebhook } = await import("./webhook.js");
    await notifyWebhook({ id: "ext_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENV_WEBHOOK);
  });
});

describe("notifyWebhook — payload shape", () => {
  it("includes event, sent_at, source, data, and uses keepalive: true", async () => {
    const { notifyWebhook, fetchImpl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK });
    const data = { id: "ext_1", url: "https://example.com" };
    await notifyWebhook(data);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENV_WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body.event).toBe("extraction.saved");
    expect(body.source).toBe("datiq");
    expect(body.data).toEqual(data);
    expect(typeof body.sent_at).toBe("string");
    expect(new Date(body.sent_at).toString()).not.toBe("Invalid Date");
    expect(init.keepalive).toBe(true);
  });
});

describe("notifyWebhook — failure handling", () => {
  it("swallows fetch failures (fire-and-forget) — env URL", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("Network unreachable"); });
    const { notifyWebhook } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK, fetchImpl });
    await expect(notifyWebhook({ id: "ext_1" })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("swallows fetch failures — user URL", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("boom"); });
    const { notifyWebhook } = await loadFreshWebhook({ userUrl: USER_WEBHOOK, fetchImpl });
    await expect(notifyWebhook({ id: "ext_1" })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("does not warn when no URL is configured (silent no-op)", async () => {
    const { notifyWebhook } = await loadFreshWebhook({});
    await notifyWebhook({ id: "ext_1" });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("getEffectiveWebhookUrl", () => {
  it("returns the user URL when set", async () => {
    const { getEffectiveWebhookUrl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK, userUrl: USER_WEBHOOK });
    expect(getEffectiveWebhookUrl()).toBe(USER_WEBHOOK);
  });

  it("returns the env URL when no user URL", async () => {
    const { getEffectiveWebhookUrl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK });
    expect(getEffectiveWebhookUrl()).toBe(ENV_WEBHOOK);
  });

  it("returns null when neither is set", async () => {
    const { getEffectiveWebhookUrl } = await loadFreshWebhook({});
    expect(getEffectiveWebhookUrl()).toBeNull();
  });
});

describe("resolveWebhookUrl (unit)", () => {
  it("user URL wins when set", async () => {
    const { resolveWebhookUrl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK, userUrl: USER_WEBHOOK });
    expect(resolveWebhookUrl()).toBe(USER_WEBHOOK);
  });

  it("cleared user URL → env URL", async () => {
    const { resolveWebhookUrl } = await loadFreshWebhook({ envUrl: ENV_WEBHOOK, userUrl: USER_WEBHOOK });
    clearUserWebhookUrl();
    expect(resolveWebhookUrl()).toBe(ENV_WEBHOOK);
  });
});
