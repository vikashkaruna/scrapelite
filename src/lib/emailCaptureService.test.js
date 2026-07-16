import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEmail, getSubscribers } from "./emailCaptureService.js";

/**
 * U-47..48 — emailCaptureService persists subscriber emails locally and
 * forwards to the n8n webhook as a fire-and-forget side effect.
 */

const WEBHOOK_URL = "https://hook.example.com/email-capture";

let env;

beforeEach(() => {
  env = { ...process.env };
});

afterEach(() => {
  process.env = env;
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("captureEmail (U-47)", () => {
  it("adds a new email to datiq.subscribers with source", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = "";
    const { captureEmail } = await import("./emailCaptureService.js");
    const r = await captureEmail("a@b.com", "home");
    expect(r.ok).toBe(true);
    expect(r.alreadySubscribed).toBe(false);
    const subs = getSubscribers();
    expect(subs.length).toBe(1);
    expect(subs[0]).toMatchObject({ email: "a@b.com", source: "home" });
    expect(typeof subs[0].ts).toBe("number");
  });

  it("dedupes by email (case-insensitive)", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = "";
    const { captureEmail } = await import("./emailCaptureService.js");
    await captureEmail("a@b.com", "home");
    const r = await captureEmail("A@B.com", "blog");
    expect(r.alreadySubscribed).toBe(true);
    expect(getSubscribers().length).toBe(1);
  });

  it("rejects an invalid email", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = "";
    const { captureEmail } = await import("./emailCaptureService.js");
    const r = await captureEmail("not-an-email", "home");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid email/);
    expect(getSubscribers().length).toBe(0);
  });
});

describe("webhook forwarding (U-48)", () => {
  it("POSTs to VITE_WEBHOOK_URL with the email_capture event", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock;

    const { captureEmail } = await import("./emailCaptureService.js");
    await captureEmail("a@b.com", "blog");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(JSON.parse(init.body)).toMatchObject({
      event: "email_capture",
      email: "a@b.com",
      source: "blog",
    });
  });

  it("swallows 5xx + network errors (fire-and-forget)", async () => {
    vi.resetModules();
    process.env.VITE_WEBHOOK_URL = WEBHOOK_URL;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(new Response("oops", { status: 200 }))
      .mockRejectedValueOnce(new Error("Network unreachable"));
    globalThis.fetch = fetchMock;

    const { captureEmail } = await import("./emailCaptureService.js");
    // 5xx — should not throw
    await expect(captureEmail("a@b.com", "blog")).resolves.toMatchObject({ ok: true });
    // 200 — should not throw
    await expect(captureEmail("c@d.com", "blog")).resolves.toMatchObject({ ok: true });
    // Network reject — should not throw
    await expect(captureEmail("e@f.com", "blog")).resolves.toMatchObject({ ok: true });
  });
});
