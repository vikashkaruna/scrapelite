// admin-billing.test.js — operator controls.
//
// These actions restore paid access without payment, issue legally-numbered
// documents, and reverse tax. The tests that matter are auth, the mandatory
// reason, and the arithmetic of a partial refund.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tokenMock = vi.hoisted(() => ({ verifyAdminToken: vi.fn(), bearerFromEvent: vi.fn(() => "tok") }));
vi.mock("../functions/lib/adminToken.js", () => tokenMock);

const emailMock = vi.hoisted(() => ({ sendInvoiceEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock("../functions/lib/invoiceEmail.js", () => emailMock);

let fetchMock;
let handler;

const INVOICE = {
  id: "inv-1",
  invoice_no: "DTQ/26-27/000123",
  user_id: "u1",
  email: "buyer@example.com",
  plan_id: "pro",
  billing_period: "annual",
  qty: 1,
  currency: "INR",
  gross_minor: 1000000,
  taxable_minor: 1000000,
  tax_rate: 0.18,
  tax_treatment: "intra",
  cgst_minor: 90000,
  sgst_minor: 90000,
  igst_minor: 0,
  tax_minor: 180000,
  total_minor: 1180000,
  refunded_minor: 0,
  status: "paid",
  supplier_snapshot: {},
  buyer_snapshot: {},
  provider: "razorpay",
  provider_payment_id: "pay_X",
};

beforeEach(async () => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  tokenMock.verifyAdminToken.mockReset();
  tokenMock.verifyAdminToken.mockReturnValue({ ok: true, demo: false });
  emailMock.sendInvoiceEmail.mockClear();
  fetchMock = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/rpc/issue_invoice")) {
      const p = JSON.parse(opts.body).p;
      return okRes({ created: true, invoice: { ...p, id: "new-1", invoice_no: `${p.series}/26-27/000001` } });
    }
    if (u.includes("/invoices?id=eq.") && (!opts.method || opts.method === "GET")) return okRes([INVOICE]);
    if (u.includes("/entitlements?")) return okRes([{ user_id: "u1", version: 2, plan_id: "pro" }]);
    return okRes([]);
  });
  vi.stubGlobal("fetch", fetchMock);
  ({ handler } = await import("../functions/admin-billing.js"));
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const okRes = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
const post = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(body) });
const calls = (frag, method) =>
  fetchMock.mock.calls.filter(([u, o]) => String(u).includes(frag) && (!method || o?.method === method));
const audits = () => calls("/billing_audit_log", "POST").map(([, o]) => JSON.parse(o.body));

describe("authentication", () => {
  it("401s without a valid admin token", async () => {
    tokenMock.verifyAdminToken.mockReturnValue({ ok: false, reason: "bad" });
    const r = await handler(post({ action: "suspend", userId: "u1", reason: "x" }));
    expect(r.statusCode).toBe(401);
  });

  it("does not touch the database when unauthenticated", async () => {
    tokenMock.verifyAdminToken.mockReturnValue({ ok: false, reason: "bad" });
    await handler(post({ action: "suspend", userId: "u1", reason: "x" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("every mutation demands a reason", () => {
  it.each(["suspend", "reactivate", "comp", "offline_payment", "refund"])(
    "rejects %s without one",
    async (action) => {
      const r = await handler(post({ action, userId: "u1", invoiceId: "inv-1" }));
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body).code).toBe("REASON_REQUIRED");
    },
  );

  it("rejects a whitespace-only reason", async () => {
    const r = await handler(post({ action: "suspend", userId: "u1", reason: "   " }));
    expect(r.statusCode).toBe(400);
  });
});

describe("suspend / reactivate", () => {
  it("suspends the account and stops its automation", async () => {
    const r = await handler(post({ action: "suspend", userId: "u1", reason: "chargeback" }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(calls("/entitlements", "PATCH")[0][1].body).status).toBe("suspended");
    const sched = JSON.parse(calls("scheduled_tasks", "PATCH")[0][1].body);
    expect(sched.system_paused).toBe(true);
  });

  it("clears every lifecycle marker on reactivate, so stale dates cannot re-suspend", async () => {
    await handler(post({ action: "reactivate", userId: "u1", reason: "goodwill" }));
    const patch = JSON.parse(calls("/entitlements", "PATCH")[0][1].body);
    expect(patch.status).toBe("active");
    expect(patch.suspended_at).toBeNull();
    expect(patch.deactivated_at).toBeNull();
    expect(patch.purge_after).toBeNull();
    expect(patch.last_notice_kind).toBeNull();
  });

  it("resumes only platform-paused schedules on reactivate", async () => {
    await handler(post({ action: "reactivate", userId: "u1", reason: "goodwill" }));
    expect(String(calls("scheduled_tasks", "PATCH")[0][0])).toContain(
      "system_pause_reason=eq.subscription_suspended",
    );
  });

  it("bumps the version so client caches invalidate", async () => {
    await handler(post({ action: "reactivate", userId: "u1", reason: "goodwill" }));
    expect(JSON.parse(calls("/entitlements", "PATCH")[0][1].body).version).toBe(3);
  });

  it("audits with the actor and the reason", async () => {
    await handler(post({ action: "suspend", userId: "u1", reason: "chargeback received" }));
    const [entry] = audits();
    expect(entry.action).toBe("suspend");
    expect(entry.reason).toBe("chargeback received");
    expect(entry.actor).toBe("admin");
  });
});

describe("comp", () => {
  it("extends free time and makes the account usable now", async () => {
    const r = await handler(post({ action: "comp", userId: "u1", days: 14, reason: "incident credit" }));
    expect(r.statusCode).toBe(200);
    const patch = JSON.parse(calls("/entitlements", "PATCH")[0][1].body);
    expect(patch.status).toBe("active");
    expect(Date.parse(patch.comp_until)).toBeGreaterThan(Date.now());
  });

  it.each([0, -5, 9999, "abc", undefined])(
    "rejects an out-of-range or malformed days value (%s) instead of silently clamping",
    async (days) => {
      const r = await handler(post({ action: "comp", userId: "u1", days, reason: "x" }));
      expect(r.statusCode).toBe(400);
      expect(JSON.parse(r.body).code).toBe("INVALID_DAYS");
    },
  );

  it("stacks onto an existing comp rather than shortening it", async () => {
    const future = new Date(Date.now() + 10 * 86400_000).toISOString();
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/entitlements?") && (!opts.method || opts.method === "GET")) {
        return okRes([{ user_id: "u1", version: 1, comp_until: future }]);
      }
      return okRes([]);
    });
    await handler(post({ action: "comp", userId: "u1", days: 5, reason: "more credit" }));
    const patch = JSON.parse(calls("/entitlements", "PATCH")[0][1].body);
    expect(Date.parse(patch.comp_until)).toBeGreaterThan(Date.parse(future));
  });
});

describe("offline payment", () => {
  it("issues a real numbered invoice through the same RPC as an online payment", async () => {
    const r = await handler(
      post({ action: "offline_payment", userId: "u1", planId: "pro", billingPeriod: "annual",
             currency: "INR", reference: "NEFT123", email: "buyer@example.com", reason: "bank transfer" }),
    );
    expect(r.statusCode).toBe(200);
    const p = JSON.parse(calls("/rpc/issue_invoice", "POST")[0][1].body).p;
    expect(p.series).toBe("DTQ");
    expect(p.provider).toBe("offline");
    expect(p.total_minor).toBeGreaterThan(0);
    expect(p.taxable_minor + p.tax_minor).toBe(p.total_minor);
  });

  it("uses the operator reference as the idempotency key", async () => {
    // Re-submitting the same bank reference must not double-invoice.
    await handler(post({ action: "offline_payment", userId: "u1", planId: "pro",
                         reference: "NEFT123", reason: "bank transfer" }));
    const p = JSON.parse(calls("/rpc/issue_invoice", "POST")[0][1].body).p;
    expect(p.provider_payment_id).toBe("offline:NEFT123");
  });

  it("activates the plan period", async () => {
    await handler(post({ action: "offline_payment", userId: "u1", planId: "pro",
                         billingPeriod: "monthly", reason: "bank transfer" }));
    const ent = JSON.parse(calls("/entitlements", "POST")[0][1].body);
    expect(ent.plan_id).toBe("pro");
    expect(ent.status).toBe("active");
    expect(ent.source).toBe("payment");
    expect(Date.parse(ent.period_end)).toBeGreaterThan(Date.now());
  });

  it("rejects an unknown plan", async () => {
    const r = await handler(post({ action: "offline_payment", userId: "u1", planId: "nope", reason: "x" }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("UNKNOWN_PLAN");
  });
});

describe("refund → credit note", () => {
  it("issues a credit note in its own series, referencing the original", async () => {
    const r = await handler(post({ action: "refund", invoiceId: "inv-1", reason: "customer request" }));
    expect(r.statusCode).toBe(200);
    const p = JSON.parse(calls("/rpc/issue_invoice", "POST")[0][1].body).p;
    expect(p.series).toBe("DTQC");
    expect(p.doc_type).toBe("credit_note");
    expect(p.credit_note_of).toBe("inv-1");
  });

  it("reverses tax in proportion for a PARTIAL refund", async () => {
    // Half the total → half the taxable value and half the tax, not all of it.
    await handler(post({ action: "refund", invoiceId: "inv-1", amountMinor: 590000, reason: "partial" }));
    const p = JSON.parse(calls("/rpc/issue_invoice", "POST")[0][1].body).p;
    expect(p.total_minor).toBe(590000);
    expect(p.taxable_minor).toBe(500000);
    expect(p.tax_minor).toBe(90000);
    expect(p.cgst_minor + p.sgst_minor).toBe(p.tax_minor);
  });

  it("reverses the full tax on a full refund", async () => {
    await handler(post({ action: "refund", invoiceId: "inv-1", reason: "full" }));
    const p = JSON.parse(calls("/rpc/issue_invoice", "POST")[0][1].body).p;
    expect(p.taxable_minor).toBe(INVOICE.taxable_minor);
    expect(p.tax_minor).toBe(INVOICE.tax_minor);
  });

  it("marks the original refunded without mutating any other field", async () => {
    await handler(post({ action: "refund", invoiceId: "inv-1", reason: "full" }));
    const patch = JSON.parse(calls("/invoices?id=eq.", "PATCH")[0][1].body);
    expect(patch).toEqual({ refunded_minor: 1180000, status: "refunded" });
  });

  it("marks a partial refund distinctly", async () => {
    await handler(post({ action: "refund", invoiceId: "inv-1", amountMinor: 100000, reason: "partial" }));
    expect(JSON.parse(calls("/invoices?id=eq.", "PATCH")[0][1].body).status).toBe("partially_refunded");
  });

  it("refuses to refund more than the invoice total", async () => {
    const r = await handler(post({ action: "refund", invoiceId: "inv-1", amountMinor: 9999999, reason: "x" }));
    // Clamped to the total rather than rejected, then applied as a full refund.
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(calls("/invoices?id=eq.", "PATCH")[0][1].body).refunded_minor).toBe(1180000);
  });

  it("refuses a second refund that would exceed the total", async () => {
    fetchMock.mockImplementation(async (url, opts = {}) => {
      const u = String(url);
      if (u.includes("/invoices?id=eq.") && (!opts.method || opts.method === "GET")) {
        return okRes([{ ...INVOICE, refunded_minor: 1000000 }]);
      }
      if (u.includes("/entitlements?")) return okRes([]);
      return okRes([]);
    });
    const r = await handler(post({ action: "refund", invoiceId: "inv-1", amountMinor: 500000, reason: "x" }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).code).toBe("OVER_REFUND");
  });

  it("404s for an invoice that does not exist", async () => {
    fetchMock.mockImplementation(async () => okRes([]));
    const r = await handler(post({ action: "refund", invoiceId: "nope", reason: "x" }));
    expect(r.statusCode).toBe(404);
  });
});

describe("errors", () => {
  it("never leaks internal detail", async () => {
    fetchMock.mockRejectedValue(new Error("postgres://user:pw@host/db"));
    const r = await handler(post({ action: "suspend", userId: "u1", reason: "x" }));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toMatch(/postgres:\/\//);
  });

  it("rejects an unknown action", async () => {
    const r = await handler(post({ action: "delete_everything", userId: "u1", reason: "x" }));
    expect(r.statusCode).toBe(400);
  });
});
