// invoice-pdf.test.js — authorization on the invoice download endpoint.
//
// An invoice carries a name, a billing address and possibly a GSTIN. The
// authorization cases below are the point of this file; the PDF bytes are
// almost incidental.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn(),
    maybeSingle: vi.fn(),
  };
  return { auth: { getUser: vi.fn() }, from: vi.fn(() => chain), _chain: chain };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => supabaseMock) }));

const AUTH = { authorization: "Bearer jwt" };
const get = (id = "inv-1", headers = AUTH) => ({
  httpMethod: "GET",
  headers,
  queryStringParameters: { id },
});

const INVOICE = {
  id: "inv-1",
  invoice_no: "DTQ/26-27/000123",
  doc_type: "tax_invoice",
  user_id: "user-1",
  currency: "INR",
  gross_minor: 289900,
  discount_minor: 0,
  proration_credit_minor: 0,
  taxable_minor: 289900,
  tax_rate: 0.18,
  tax_treatment: "intra",
  cgst_minor: 26091,
  sgst_minor: 26091,
  igst_minor: 0,
  tax_minor: 52182,
  total_minor: 342082,
  status: "paid",
  refunded_minor: 0,
  issued_at: "2026-07-27T00:00:00Z",
  supplier_snapshot: { legal_name: "DatIQ", gstin: "29ABCDE1234F1Z5" },
  buyer_snapshot: { legal_name: "Acme" },
};

let handler;

beforeEach(async () => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://db.example.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  supabaseMock.auth.getUser.mockReset();
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  supabaseMock._chain.select.mockReturnThis();
  supabaseMock._chain.eq.mockReturnThis();
  supabaseMock._chain.maybeSingle.mockReset();
  supabaseMock._chain.order.mockReset();
  supabaseMock._chain.order.mockResolvedValue({ data: [], error: null });
  ({ handler } = await import("../functions/invoice-pdf.js"));
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  vi.clearAllMocks();
});

describe("authorization", () => {
  it("401s without an Authorization header", async () => {
    const r = await handler(get("inv-1", {}));
    expect(r.statusCode).toBe(401);
  });

  it("401s on an invalid or expired token", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    const r = await handler(get());
    expect(r.statusCode).toBe(401);
  });

  it("scopes the query to the authenticated user, not to a session id", async () => {
    supabaseMock._chain.maybeSingle.mockResolvedValue({ data: INVOICE, error: null });
    await handler(get());
    expect(supabaseMock._chain.eq).toHaveBeenCalledWith("user_id", "user-1");
    // session_id is client-writable and must never be an ownership check.
    const filtered = supabaseMock._chain.eq.mock.calls.map((c) => c[0]);
    expect(filtered).not.toContain("session_id");
  });

  it("returns 404 — not 403 — for someone else's invoice, so ids cannot be enumerated", async () => {
    // RLS + the explicit user_id filter yield no row for another user's id.
    supabaseMock._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await handler(get("someone-elses-id"));
    expect(r.statusCode).toBe(404);
    expect(r.statusCode).not.toBe(403);
  });

  it("400s without an id", async () => {
    const r = await handler({ httpMethod: "GET", headers: AUTH, queryStringParameters: {} });
    expect(r.statusCode).toBe(400);
  });

  it("405s on a non-GET method", async () => {
    const r = await handler({ httpMethod: "POST", headers: AUTH, queryStringParameters: { id: "x" } });
    expect(r.statusCode).toBe(405);
  });
});

describe("successful download", () => {
  beforeEach(() => {
    supabaseMock._chain.maybeSingle.mockResolvedValue({ data: INVOICE, error: null });
    supabaseMock._chain.order.mockResolvedValue({
      data: [
        { line_no: 1, kind: "plan", description: "Pro plan - monthly", hsn_sac: "998314", qty: 1, amount_minor: 289900 },
      ],
      error: null,
    });
  });

  it("returns a real PDF", async () => {
    const r = await handler(get());
    expect(r.statusCode).toBe(200);
    expect(r.headers["Content-Type"]).toBe("application/pdf");
    expect(r.isBase64Encoded).toBe(true);
    expect(Buffer.from(r.body, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("names the file after the invoice number", async () => {
    const r = await handler(get());
    expect(r.headers["Content-Disposition"]).toContain("DTQ-26-27-000123.pdf");
  });

  it("forbids shared caching of a tax document", async () => {
    const r = await handler(get());
    expect(r.headers["Cache-Control"]).toMatch(/private/);
    expect(r.headers["Cache-Control"]).toMatch(/no-store/);
  });

  it("never leaks internal detail on an error", async () => {
    supabaseMock._chain.maybeSingle.mockRejectedValue(new Error("connection postgres://u:p@h"));
    const r = await handler(get());
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toMatch(/postgres:\/\//);
  });
});

describe("configuration", () => {
  it("503s when Supabase is not configured", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    vi.resetModules();
    const mod = await import("../functions/invoice-pdf.js");
    const r = await mod.handler(get());
    expect(r.statusCode).toBe(503);
  });
});
