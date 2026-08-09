// netlify/__tests__/razorpay-sdk.test.js
// Tests for the same-origin Razorpay SDK proxy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const RAZORPAY_SDK_URL = "https://checkout.razorpay.com/v1/checkout.js";

// dynamic import lets us mock global fetch before the module evaluates
const importHandler = async () => (await import("../functions/razorpay-sdk.js")).default;

describe("razorpay-sdk proxy", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the upstream JS with the right content-type and cache headers on success", async () => {
    const fakeBody = "/* fake razorpay sdk body */ window.Razorpay = function(){};";
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => fakeBody,
    }));

    const handler = await importHandler();
    const res = await handler({ method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(fakeBody);
    expect(res.headers.get("Content-Type")).toMatch(/application\/javascript/);
    expect(res.headers.get("Cache-Control")).toMatch(/max-age=86400/);
    expect(res.headers.get("Cache-Control")).toMatch(/immutable/);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Proxied-From")).toBe(RAZORPAY_SDK_URL);
  });

  it("returns 502 with a no-op comment when the upstream returns non-OK", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => "upstream broken",
    }));

    const handler = await importHandler();
    const res = await handler({ method: "GET" });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toMatch(/DatIQ razorpay-sdk proxy/);
    expect(body).toMatch(/upstream status 503/);
  });

  it("returns 502 with a no-op comment when fetch itself throws (DNS, network, etc.)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });

    const handler = await importHandler();
    const res = await handler({ method: "GET" });
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toMatch(/DatIQ razorpay-sdk proxy/);
    expect(body).toMatch(/fetch-error: ENOTFOUND/);
  });

  it("rejects non-GET requests with 405", async () => {
    const handler = await importHandler();
    const res = await handler({ method: "POST" });
    expect(res.status).toBe(405);
  });

  it("passes a stable User-Agent to the upstream so Razorpay can rate-limit one source", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "/* x */",
    }));
    const handler = await importHandler();
    await handler({ method: "GET" });
    const [calledUrl, calledInit] = globalThis.fetch.mock.calls[0];
    expect(calledUrl).toBe(RAZORPAY_SDK_URL);
    expect(calledInit.headers["User-Agent"]).toMatch(/DatIQ-NetlifyProxy/);
  });
});
