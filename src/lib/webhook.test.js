import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyWebhook } from "./webhook.js";

/**
 * U-42 — webhook is a fire-and-forget notification. The contract is:
 *   1. POST JSON to the configured URL.
 *   2. fetch failures are swallowed (never thrown to the caller).
 */

const WEBHOOK_URL = "https://hook.example.com/datiq";

let env;

beforeEach(() => {
  env = { ...process.env };
});

afterEach(() => {
  process.env = env;
  vi.restoreAllMocks();
});

it("posts JSON to the configured URL", async () => {
  vi.resetModules();
  process.env.VITE_WEBHOOK_URL = WEBHOOK_URL;
  const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
  globalThis.fetch = fetchMock;

  const { notifyWebhook } = await import("./webhook.js");
  await notifyWebhook({ id: "ext_1", url: "https://example.com" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(WEBHOOK_URL);
  expect(init.method).toBe("POST");
  expect(init.body).toContain('"event":"extraction.saved"');
  expect(init.keepalive).toBe(true);
});

it("does nothing when VITE_WEBHOOK_URL is unset", async () => {
  vi.resetModules();
  delete process.env.VITE_WEBHOOK_URL;
  const fetchMock = vi.fn();
  globalThis.fetch = fetchMock;

  const { notifyWebhook } = await import("./webhook.js");
  await notifyWebhook({ id: "ext_1" });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("swallows fetch failures (fire-and-forget)", async () => {
  vi.resetModules();
  process.env.VITE_WEBHOOK_URL = WEBHOOK_URL;
  globalThis.fetch = vi.fn(async () => {
    throw new Error("Network unreachable");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { notifyWebhook } = await import("./webhook.js");
  // Must not throw
  await expect(notifyWebhook({ id: "ext_1" })).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalled();
});
