// invoiceModel.test.js — document correctness.
//
// The highest-stakes assertions here are the NEGATIVE ones: an unregistered
// supplier must never emit anything that looks like a tax invoice, and a
// discount must never carry a service accounting code.
import { describe, expect, it } from "vitest";
import { DOC_TYPE, buildInvoiceDoc, docTypeLabel, formatMoney, groupIndian } from "./invoiceModel.js";

const base = {
  id: "i1",
  invoice_no: "DTQ/26-27/000123",
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
  buyer_snapshot: { legal_name: "Acme Pvt Ltd", state: "Maharashtra", gstin: null },
  provider: "razorpay",
  provider_payment_id: "pay_X",
};

const LINES = [
  { line_no: 1, kind: "plan", description: "Pro plan - annual", hsn_sac: "998314", qty: 1, amount_minor: 1798800 },
  { line_no: 2, kind: "discount", description: "Coupon LAUNCH20 (-20%)", hsn_sac: null, qty: 1, amount_minor: -359760 },
];

const taxInvoice = { ...base, doc_type: DOC_TYPE.TAX_INVOICE };
const receipt = {
  ...base,
  doc_type: DOC_TYPE.PAYMENT_RECEIPT,
  tax_rate: 0,
  tax_minor: 0,
  cgst_minor: 0,
  sgst_minor: 0,
  taxable_minor: 1439040,
  total_minor: 1439040,
  supplier_snapshot: { legal_name: "DatIQ", state: "Karnataka", gstin: null },
};

describe("tax invoice", () => {
  const m = buildInvoiceDoc(taxInvoice, LINES);

  it("is titled Tax Invoice", () => {
    expect(m.title).toBe("Tax Invoice");
    expect(m.isTaxInvoice).toBe(true);
  });

  it("shows the CGST/SGST split for an intra-state supply and no IGST", () => {
    const labels = m.totals.map((t) => t.label);
    expect(labels).toContain("CGST @ 9%");
    expect(labels).toContain("SGST @ 9%");
    expect(labels.some((l) => l.startsWith("IGST"))).toBe(false);
  });

  it("shows IGST alone for an inter-state supply", () => {
    const inter = { ...taxInvoice, igst_minor: 259027, cgst_minor: 0, sgst_minor: 0 };
    const labels = buildInvoiceDoc(inter, LINES).totals.map((t) => t.label);
    expect(labels).toContain("IGST @ 18%");
    expect(labels.some((l) => l.startsWith("CGST"))).toBe(false);
  });

  it("carries place of supply, which is mandatory on a GST invoice", () => {
    expect(m.meta.find((x) => x.label === "Place of supply")?.value).toBe("Karnataka");
  });

  it("puts the SAC code on the supply line only, never on a discount", () => {
    expect(m.lines[0].hsnSac).toBe("998314");
    expect(m.lines[1].hsnSac).toBe("");
  });

  it("omits quantity on non-supply lines", () => {
    expect(m.lines[0].qty).toBe(1);
    expect(m.lines[1].qty).toBe("");
  });

  it("prompts for a GSTIN when the buyer has none", () => {
    expect(m.notes.join(" ")).toMatch(/GSTIN/);
  });

  it("does not prompt when the buyer already supplied a GSTIN", () => {
    const withGstin = { ...taxInvoice, buyer_snapshot: { ...base.buyer_snapshot, gstin: "27AAAAA0000A1Z5" } };
    expect(buildInvoiceDoc(withGstin, LINES).notes.join(" ")).not.toMatch(/Add your GSTIN/);
  });

  it("shows the gross line only when something was deducted", () => {
    expect(m.totals.map((t) => t.label)).toContain("Gross");
    const noDiscount = { ...taxInvoice, discount_minor: 0, proration_credit_minor: 0 };
    expect(buildInvoiceDoc(noDiscount, [LINES[0]]).totals.map((t) => t.label)).not.toContain("Gross");
  });
});

describe("payment receipt (supplier not GST-registered)", () => {
  const m = buildInvoiceDoc(receipt, LINES);

  it('never contains the words "Tax Invoice" anywhere in the document', () => {
    expect(JSON.stringify(m)).not.toMatch(/Tax Invoice/);
  });

  it("emits no tax lines at all", () => {
    expect(m.totals.some((t) => /GST/i.test(t.label))).toBe(false);
  });

  it("says explicitly that it is not a tax invoice", () => {
    expect(m.notes.join(" ")).toMatch(/not a tax invoice/i);
  });

  it("carries no SAC code and no place of supply", () => {
    expect(m.lines[0].hsnSac).toBe("");
    expect(m.meta.some((x) => x.label === "Place of supply")).toBe(false);
  });

  it('labels the subtotal "Subtotal", not "Taxable value"', () => {
    expect(m.totals.map((t) => t.label)).toContain("Subtotal");
  });
});

describe("credit note", () => {
  it("is labelled and worded as a credit", () => {
    const cn = { ...taxInvoice, doc_type: DOC_TYPE.CREDIT_NOTE, invoice_no: "DTQC/26-27/000001" };
    const m = buildInvoiceDoc(cn, LINES);
    expect(m.title).toBe("Credit Note");
    expect(m.meta[0].label).toBe("Credit note no.");
    expect(m.totals.at(-1).label).toBe("Total credited");
  });
});

describe("refund status", () => {
  it("states a full refund", () => {
    const m = buildInvoiceDoc({ ...taxInvoice, status: "refunded" }, LINES);
    expect(m.notes.join(" ")).toMatch(/fully refunded/i);
  });

  it("states the amount of a partial refund", () => {
    const m = buildInvoiceDoc(
      { ...taxInvoice, status: "partially_refunded", refunded_minor: 50000 },
      LINES,
    );
    expect(m.notes.join(" ")).toMatch(/INR 500\.00/);
  });
});

describe("money formatting", () => {
  it("uses Indian lakh/crore grouping for INR", () => {
    expect(formatMoney(123456789, "INR")).toBe("INR 12,34,567.89");
    expect(formatMoney(100000, "INR")).toBe("INR 1,000.00");
    expect(groupIndian("10000000")).toBe("1,00,00,000");
  });

  it("uses thousands grouping for other currencies", () => {
    expect(formatMoney(123456789, "USD")).toBe("USD 1,234,567.89");
  });

  it("uses the ASCII currency CODE, never a symbol", () => {
    // jsPDF's helvetica has no rupee glyph, and a symbol here would corrupt the
    // whole text run's metrics in the rendered PDF.
    expect(formatMoney(100, "INR")).not.toMatch(/₹/);
    expect(formatMoney(100, "INR")).toMatch(/^INR /);
  });

  it("formats negative amounts for discount lines", () => {
    expect(formatMoney(-359760, "INR")).toBe("-INR 3,597.60");
  });

  it("always shows two decimal places", () => {
    expect(formatMoney(5, "INR")).toBe("INR 0.05");
    expect(formatMoney(0, "INR")).toBe("INR 0.00");
  });
});

describe("labels", () => {
  it("maps every doc type", () => {
    expect(docTypeLabel(DOC_TYPE.TAX_INVOICE)).toBe("Tax Invoice");
    expect(docTypeLabel(DOC_TYPE.CREDIT_NOTE)).toBe("Credit Note");
    expect(docTypeLabel(DOC_TYPE.PAYMENT_RECEIPT)).toBe("Payment Receipt");
    expect(docTypeLabel("anything-else")).toBe("Payment Receipt");
  });
});
