// netlify/__tests__/reengagement-handler.test.js
//
// The gap reengagement.test.js left: it only ever exercised the pure helpers
// (buildDigest, the HTML templates), never the HTTP handler — so the actual
// defect (selecting a `user_email` column public.scheduled_tasks never had,
// against the REAL schema, which only has `user_id`) had nothing testing it
// and shipped silently for months. This drives the real exported `handler`
// against a schema-accurate scheduled_tasks response and asserts an email
// actually goes out, which the pre-fix code could never do (its query 400'd).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "service-key",
  RESEND_API_KEY: "re_test",
};

let origEnv;

beforeEach(() => {
  origEnv = { ...process.env };
  Object.assign(process.env, ENV);
  vi.resetModules();
});

afterEach(() => {
  process.env = origEnv;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/reengagement.js");
  return mod.handler;
}

describe("reengagement handler — the real schema, not user_email", () => {
  it("resolves user_id to a real email and sends a D7 email, using scheduled_tasks' actual columns", async () => {
    const now = new Date();
    now.setUTCHours(12, 0, 0, 0); // outside the daily-digest hour, so only D7/D30 fire
    const lastRunAt = new Date(now.getTime() - 10 * 86400000).toISOString(); // 10 days ago → D7-eligible

    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      const u = String(url);
      calls.push(u);

      // 1. scheduled_tasks read — the query that used to 400 on `user_email`.
      if (u.includes("/scheduled_tasks?")) {
        expect(u).toContain("select=id,user_id,data");
        expect(u).not.toContain("user_email");
        return new Response(JSON.stringify([
          { id: "sch_1", user_id: "user-abc", data: { label: "Watch", lastRunAt, runCount: 4, lastStatus: "unchanged" } },
        ]), { status: 200 });
      }

      // 2. Auth admin API — resolves user_id -> email, same call admin-users.js makes.
      if (u.includes("/auth/v1/admin/users")) {
        return new Response(JSON.stringify({ users: [{ id: "user-abc", email: "quiet@x.com" }] }), { status: 200 });
      }

      // 3. reengagement_log dedup reads — nothing sent yet.
      if (u.includes("/reengagement_log") && (!opts || opts.method === undefined)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      // 4. reengagement_log write (markSent).
      if (u.includes("/reengagement_log") && opts?.method === "POST") {
        return new Response("", { status: 201 });
      }

      // 5. Resend send.
      if (u.includes("api.resend.com")) {
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }

      return new Response("{}", { status: 200 });
    }));

    const handler = await loadHandler();
    const res = await handler({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/1 email\(s\) sent/);
    expect(res.body).toMatch(/1 user\(s\) checked/);

    const resendCall = calls.find((c) => c.includes("api.resend.com"));
    expect(resendCall).toBeTruthy();

    const authCall = calls.find((c) => c.includes("/auth/v1/admin/users"));
    expect(authCall).toBeTruthy();
  });

  it("skips a scheduled_tasks row whose user_id no longer resolves to an account", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/scheduled_tasks?")) {
        return new Response(JSON.stringify([
          { id: "sch_1", user_id: "ghost-user", data: { lastRunAt: new Date().toISOString(), runCount: 1 } },
        ]), { status: 200 });
      }
      if (u.includes("/auth/v1/admin/users")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 }); // no match for ghost-user
      }
      return new Response("{}", { status: 200 });
    }));

    const handler = await loadHandler();
    const res = await handler({});
    expect(res.body).toMatch(/0 email\(s\) sent/);
    expect(res.body).toMatch(/0 user\(s\) checked/);
  });
});
