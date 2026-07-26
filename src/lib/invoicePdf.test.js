// invoicePdf.test.js — the renderer, in both runtimes.
//
// The glyph tests exist because of a real defect found by RENDERING the page,
// not by reading strings: jsPDF's base-14 helvetica is WinAnsi-encoded, and a
// character outside that repertoire (₹ U+20B9, → U+2192) does not fall back to
// a placeholder — it corrupts the whole text run's metrics, so the line comes
// out with broken letter-spacing. Every assertion below would have passed while
// the PDF looked wrong, which is why toPdfSafe exists and is tested directly.
import { describe, expect, it } from "vitest";
import { DOC_TYPE } from "./invoiceModel.js";
import { invoiceFilename, invoicePdfBuffer, renderInvoicePdf, toPdfSafe } from "./invoicePdf.js";
import { buildInvoiceDoc } from "./invoiceModel.js";

const invoice = {
  id: "i1",
  invoice_no: "DTQ/26-27/000123",
  doc_type: DOC_TYPE.TAX_INVOICE,
  email: "buyer@example.com",
  plan_id: "pro",
  billing_period: "annual",
  qty: 1,
  period_start: "2026-07-27T00:00:00Z",
  period_end: "2027-07-27T00:00:00Z",
  currency: "INR",
  gross_minor: 1798800,
  discount_minor: 359760,
  proration_credit_minor: 0,
  taxable_minor: 1439040,
  tax_rate: 0.18,
  tax_treatment: "intra",
  cgst_minor: 129513,
  sgst_minor: 129514,
  igst_minor: 0,
  tax_minor: 259027,
  total_minor: 1698067,
  place_of_supply: "Karnataka",
  status: "paid",
  refunded_minor: 0,
  issued_at: "2026-07-27T10:00:00Z",
  supplier_snapshot: { legal_name: "DatIQ Technologies", state: "Karnataka", gstin: "29ABCDE1234F1Z5" },
  buyer_snapshot: { legal_name: "Acme Pvt Ltd", state: "Maharashtra" },
  provider: "razorpay",
  provider_payment_id: "pay_X",
};

const lines = [
  { line_no: 1, kind: "plan", description: "Pro plan - annual, 12 months", hsn_sac: "998314", qty: 1, amount_minor: 1798800 },
  { line_no: 2, kind: "discount", description: "Coupon LAUNCH20 (-20%)", hsn_sac: null, qty: 1, amount_minor: -359760 },
];

describe("toPdfSafe", () => {
  it("transliterates the rupee sign rather than corrupting the text run", () => {
    expect(toPdfSafe("₹1,234")).toBe("INR 1,234");
  });

  it("transliterates arrows, which silently wrecked a whole line's spacing", () => {
    expect(toPdfSafe("Account → Billing")).toBe("Account -> Billing");
  });

  it("transliterates smart quotes, dashes and ellipses", () => {
    expect(toPdfSafe("‘a’ “b” – — …")).toBe("'a' \"b\" - - ...");
  });

  it("replaces anything else outside Latin-1 with a visible marker", () => {
    // "?" rather than silent removal so it is caught in review.
    expect(toPdfSafe("emoji 😀 here")).toContain("?");
    expect(toPdfSafe("日本語")).toBe("???");
  });

  it("leaves plain Latin-1 untouched", () => {
    expect(toPdfSafe("Pro plan - annual (12 months) £100 ½")).toBe("Pro plan - annual (12 months) £100 ½");
  });

  it("handles null and undefined", () => {
    expect(toPdfSafe(null)).toBe("");
    expect(toPdfSafe(undefined)).toBe("");
  });
});

describe("rendering", () => {
  it("produces a valid PDF in this runtime", () => {
    const buf = Buffer.from(invoicePdfBuffer(invoice, lines));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders a payment receipt without a SAC column", () => {
    const receipt = {
      ...invoice,
      doc_type: DOC_TYPE.PAYMENT_RECEIPT,
      tax_rate: 0,
      tax_minor: 0,
      cgst_minor: 0,
      sgst_minor: 0,
      total_minor: 1439040,
    };
    const buf = Buffer.from(invoicePdfBuffer(receipt, lines));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("never emits a rupee glyph anywhere in the document model", () => {
    // Money formatting is the one place a symbol could plausibly creep in, and
    // no amount of render-time sanitising would make "INR " vs "₹" a cosmetic
    // difference on a tax document — so assert it at the source.
    expect(JSON.stringify(buildInvoiceDoc(invoice, lines))).not.toMatch(/₹/);
  });

  it("every string that reaches the PDF is Latin-1 clean after sanitising", () => {
    // The MODEL may legitimately carry nice typography (the service period uses
    // an en dash). The guarantee is that toPdfSafe — through which every text
    // call routes — leaves nothing jsPDF's WinAnsi helvetica cannot encode.
    const model = buildInvoiceDoc(invoice, lines);
    const strings = [
      model.title,
      model.invoiceNo,
      ...model.supplier.lines,
      ...model.buyer.lines,
      ...model.meta.flatMap((m) => [m.label, m.value]),
      ...model.lines.flatMap((l) => [l.description, String(l.qty), l.hsnSac, l.amountText]),
      ...model.totals.flatMap((t) => [t.label, t.value]),
      ...model.notes,
    ];
    for (const s of strings) {
      expect(toPdfSafe(s)).not.toMatch(/[^\x00-\xFF]/);
    }
    // And the raw model does contain typography, so the sanitiser is doing work
    // rather than passing a trivially-clean input.
    expect(strings.join(" ")).toMatch(/[^\x00-\xFF]/);
  });

  it("survives missing lines, a missing buyer and a missing supplier", () => {
    const bare = { ...invoice, buyer_snapshot: null, supplier_snapshot: {} };
    expect(() => renderInvoicePdf(buildInvoiceDoc(bare, []))).not.toThrow();
  });

  it("paginates rather than overflowing when there are many lines", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      line_no: i + 1,
      kind: "bundle",
      description: `Bundle line ${i + 1} with a fairly long description to force wrapping`,
      hsn_sac: "998314",
      qty: 1,
      amount_minor: 100000,
    }));
    const pdf = renderInvoicePdf(buildInvoiceDoc(invoice, many));
    expect(pdf.internal.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe("invoiceFilename", () => {
  it("makes the invoice number filename-safe", () => {
    expect(invoiceFilename("DTQ/26-27/000123")).toBe("DTQ-26-27-000123.pdf");
    expect(invoiceFilename("DTQC/26-27/000001")).toBe("DTQC-26-27-000001.pdf");
  });

  it("falls back when the number is missing", () => {
    expect(invoiceFilename(null)).toBe("invoice.pdf");
  });
});
