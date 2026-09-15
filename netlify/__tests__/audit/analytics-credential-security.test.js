import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveAnalyticsConnection } from "../../functions/lib/audit/auditStore.js";

describe("analytics credential storage", () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
    encryption: process.env.INTEGRATION_SECRETS_KEY,
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    delete process.env.INTEGRATION_SECRETS_KEY;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previous.key;
    if (previous.encryption === undefined) delete process.env.INTEGRATION_SECRETS_KEY;
    else process.env.INTEGRATION_SECRETS_KEY = previous.encryption;
    vi.unstubAllGlobals();
  });

  it("fails closed before storage when the encryption key is unavailable", async () => {
    const secret = "provider-secret-that-must-never-be-written";
    const result = await saveAnalyticsConnection("user-1", {
      provider: "ga4",
      token: secret,
    });

    expect(result).toMatchObject({ ok: false, code: "ENCRYPTION_UNAVAILABLE" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
