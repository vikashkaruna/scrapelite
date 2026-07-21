// netlify/__tests__/welcome-email.test.js — F49 (welcome-email trigger).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @supabase/supabase-js before importing the handler
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn(() => ({
      auth: {
        admin: {
          getUserById: vi.fn(),
          updateUserById: vi.fn().mockResolvedValue({ user: {} }),
        },
      },
    })),
  };
});

import { handler } from "../functions/welcome-email.js";

function makeEvent(overrides = {}) {
  return {
    httpMethod: "POST",
    body: JSON.stringify({
      userId: "u-123",
      email: "test@example.com",
      name: "Test",
      planLabel: "Free",
      ...overrides,
    }),
  };
}

describe("welcome-email (F49)", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    process.env.RESEND_API_KEY = "resend-key";
    process.env.ALERT_EMAIL_FROM = "DatIQ <hello@datiq.app>";
    process.env.URL = "https://datiq.app";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects non-POST methods", async () => {
    const r = await handler({ httpMethod: "GET", body: "{}" });
    expect(r.statusCode).toBe(405);
  });

  it("rejects bad JSON", async () => {
    const r = await handler({ httpMethod: "POST", body: "not-json" });
    expect(r.statusCode).toBe(400);
  });

  it("rejects missing userId / email", async () => {
    const r = await handler({ httpMethod: "POST", body: JSON.stringify({}) });
    expect(r.statusCode).toBe(400);
  });

  it("skips when Supabase service key is not set", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/no supabase/);
  });

  it("skips when Resend key is not set", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/no Resend/);
  });

  it("returns 200 immediately when welcomeEmailSent is already true", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    createClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: "u-123", email: "test@example.com", user_metadata: { welcomeEmailSent: true } } },
            error: null,
          }),
          updateUserById: vi.fn(),
        },
      },
    });
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("already sent");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the email and updates the flag on success", async () => {
    const updateMock = vi.fn().mockResolvedValue({ user: {} });
    const { createClient } = await import("@supabase/supabase-js");
    createClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: "u-123", email: "test@example.com", user_metadata: {} } },
            error: null,
          }),
          updateUserById: updateMock,
        },
      },
    });
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => "ok" });
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("welcome email sent");
    // Resend was called
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual(["test@example.com"]);
    expect(body.subject).toMatch(/Welcome/);
    expect(body.html).toMatch(/Test/);
    // The user metadata was updated
    expect(updateMock).toHaveBeenCalledWith("u-123", expect.objectContaining({
      user_metadata: expect.objectContaining({ welcomeEmailSent: true }),
    }));
  });

  it("returns 502 when Resend rejects the send", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    createClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: { id: "u-123", email: "test@example.com", user_metadata: {} } },
            error: null,
          }),
          updateUserById: vi.fn(),
        },
      },
    });
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "Resend error" });
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(502);
    expect(r.body).toMatch(/resend 500/);
  });

  it("returns 404 when the Supabase user is not found", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    createClient.mockReturnValue({
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "not found" } }),
          updateUserById: vi.fn(),
        },
      },
    });
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(404);
  });
});
