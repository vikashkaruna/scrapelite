// web3forms.test.js — Web3Forms submission client.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { submitToWeb3Forms, Web3FormsError } from "./web3forms.js";
import { WEB3FORMS_ACCESS_KEY, WEB3FORMS_ENDPOINT } from "./config.js";

function okResponse(body = { success: true, message: "Email sent successfully" }) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

describe("web3forms — configuration", () => {
  it("ships a default access key so the form works without env setup", () => {
    expect(WEB3FORMS_ACCESS_KEY).toBe("d7378b9e-dce4-4f18-804a-3b6e8dc51719");
  });

  it("posts to the documented Web3Forms endpoint", () => {
    expect(WEB3FORMS_ENDPOINT).toBe("https://api.web3forms.com/submit");
  });
});

describe("web3forms — submitToWeb3Forms", () => {
  it("POSTs JSON to the endpoint and resolves on success", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    const result = await submitToWeb3Forms({ message: "hi" }, { fetchImpl });

    expect(result).toEqual({ ok: true, message: "Email sent successfully" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(WEB3FORMS_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toMatchObject({ message: "hi" });
  });

  it("fills the access key from config when none is supplied", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    await submitToWeb3Forms({ message: "hi" }, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).access_key)
      .toBe(WEB3FORMS_ACCESS_KEY);
  });

  it("an explicit accessKey option wins over the configured default", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    await submitToWeb3Forms({ message: "hi" }, { fetchImpl, accessKey: "key-admin" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).access_key).toBe("key-admin");
  });

  it("rejects with Web3FormsError when the API returns success:false", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: false, status: 400,
      json: () => Promise.resolve({ success: false, message: "Invalid Access Key" }),
    }));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .rejects.toThrow(/Invalid Access Key/);
  });

  it("treats HTTP 200 with success:false as a failure", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ success: false, message: "Spam detected" }),
    }));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .rejects.toBeInstanceOf(Web3FormsError);
  });

  it("surfaces the HTTP status when the error body is not JSON", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: false, status: 502,
      json: () => Promise.reject(new Error("Unexpected token <")),
    }));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .rejects.toThrow(/HTTP 502/);
  });

  it("still resolves when a 200 response body is not JSON", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.reject(new Error("no body")),
    }));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .resolves.toMatchObject({ ok: true });
  });

  it("wraps a network failure in a friendly Web3FormsError", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .rejects.toThrow(/Could not reach the mail service/);
  });

  it("reports an abort as a timeout", async () => {
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn(() => Promise.reject(abortErr));
    await expect(submitToWeb3Forms({ message: "hi" }, { fetchImpl }))
      .rejects.toThrow(/timed out/);
  });

  it("passes an AbortSignal so a hung request can't wedge the form", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    await submitToWeb3Forms({ message: "hi" }, { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].signal).toBeDefined();
  });
});

describe("web3forms — missing access key", () => {
  // A default key is baked into config, so this guard is defensive only: it is
  // reachable exclusively when config resolves to an empty key. Mock config to
  // prove the guard short-circuits instead of firing a doomed request.
  it("throws without touching the network when config has no key", async () => {
    vi.resetModules();
    vi.doMock("./config.js", () => ({
      WEB3FORMS_ACCESS_KEY: "",
      WEB3FORMS_ENDPOINT: "https://api.web3forms.com/submit",
    }));
    const { submitToWeb3Forms: unconfigured } = await import("./web3forms.js");

    const fetchImpl = vi.fn();
    await expect(unconfigured({ message: "hi" }, { fetchImpl }))
      .rejects.toThrow(/not configured/);
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.doUnmock("./config.js");
    vi.resetModules();
  });
});

describe("web3forms — timeout wiring", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("clears the timeout timer once the request settles", async () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));
    await submitToWeb3Forms({ message: "hi" }, { fetchImpl });
    expect(clearSpy).toHaveBeenCalled();
  });
});
