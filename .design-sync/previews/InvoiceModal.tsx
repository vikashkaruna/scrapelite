import { InvoiceModal } from "datiq";

// InvoiceModal renders from buildInvoiceDoc(invoice, lines) — `lines` is
// fetched async via fetchInvoiceLines(invoice.id) (billingRepo.js), which
// talks to Supabase. This preview environment has no VITE_SUPABASE_URL
// configured, so that fetch resolves to [] synchronously (the function
// early-returns `if (!supabase) return []`) and the line-items table renders
// with a header only. That is the same graceful-degradation behavior the
// real app has with no backend configured — everything else on the document
// (parties, meta, totals, notes) comes straight from the `invoice` prop and
// renders in full.

const now = Date.now();
const DAY = 24 * 3600_000;

const SUPPLIER_REGISTERED = {
  legal_name: "Karuna Technologies Private Limited",
  trade_name: "DatIQ",
  address: "4th Floor, Prestige Tech Park, Marathahalli",
  state: "Karnataka",
  country: "India",
  email: "hello@datiq.app",
  website: "https://datiq.app",
  gstin: "29ABCDE1234F1Z5",
  pan: "ABCDE1234F",
  registered: true,
};

const SUPPLIER_UNREGISTERED = {
  legal_name: "DatIQ",
  trade_name: "DatIQ",
  address: "",
  state: "",
  country: "India",
  email: "hello@datiq.app",
  website: "https://datiq.app",
  gstin: null,
  pan: null,
  registered: false,
};

export function TaxInvoiceIntraStateCGSTSGST() {
  const invoice = {
    id: "6e2f9b3a-3f2a-4b7d-9d1e-8a9c7f6e5d4c",
    invoice_no: "DTQ/2026-27/000418",
    series: "DTQ",
    doc_type: "tax_invoice",
    status: "paid",
    currency: "INR",
    issued_at: new Date(now - 3 * DAY).toISOString(),
    period_start: new Date(now - 3 * DAY).toISOString(),
    period_end: new Date(now + 362 * DAY).toISOString(),
    provider_payment_id: "pay_QF7k2mN9xR3sLp",
    place_of_supply: "Karnataka",
    gross_minor: 1798800,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: 1798800,
    tax_rate: 0.18,
    cgst_minor: 161892,
    sgst_minor: 161892,
    igst_minor: 0,
    tax_minor: 323784,
    total_minor: 2122584,
    refunded_minor: 0,
    email: "priya.sharma@northwindanalytics.in",
    supplier_snapshot: SUPPLIER_REGISTERED,
    buyer_snapshot: {
      legal_name: "Northwind Analytics LLP",
      company: "Northwind Analytics LLP",
      address: "12 MG Road, Bengaluru",
      state: "Karnataka",
      country: "India",
      gstin: "29AACFN1234M1Z8",
      email: "priya.sharma@northwindanalytics.in",
    },
  };
  return <InvoiceModal invoice={invoice} onClose={() => {}} />;
}

export function TaxInvoiceInterStateIGST() {
  const invoice = {
    id: "b1d4e7a2-9c6f-4a1b-8e3d-2f5c9a7b6d1e",
    invoice_no: "DTQ/2026-27/000531",
    series: "DTQ",
    doc_type: "tax_invoice",
    status: "paid",
    currency: "INR",
    issued_at: new Date(now - 10 * DAY).toISOString(),
    period_start: new Date(now - 10 * DAY).toISOString(),
    period_end: new Date(now + 20 * DAY).toISOString(),
    provider_payment_id: "pay_LK9v3pQ7wX2mNt",
    place_of_supply: "Maharashtra",
    gross_minor: 419900,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: 419900,
    tax_rate: 0.18,
    cgst_minor: 0,
    sgst_minor: 0,
    igst_minor: 75582,
    tax_minor: 75582,
    total_minor: 495482,
    refunded_minor: 0,
    email: "finance@bluecrestventures.com",
    supplier_snapshot: SUPPLIER_REGISTERED,
    buyer_snapshot: {
      legal_name: "Bluecrest Ventures Pvt Ltd",
      company: "Bluecrest Ventures Pvt Ltd",
      address: "Bandra Kurla Complex, Mumbai",
      state: "Maharashtra",
      country: "India",
      gstin: null,
      email: "finance@bluecrestventures.com",
    },
  };
  return <InvoiceModal invoice={invoice} onClose={() => {}} />;
}

export function PaymentReceiptUSD() {
  const invoice = {
    id: "9a3c5e7f-1b2d-4c6a-8e9f-3d5b7a1c2e4f",
    invoice_no: "DTQ/2026-27/000452",
    series: "DTQ",
    doc_type: "payment_receipt",
    status: "paid",
    currency: "USD",
    issued_at: new Date(now - 5 * DAY).toISOString(),
    period_start: new Date(now - 5 * DAY).toISOString(),
    period_end: new Date(now + 25 * DAY).toISOString(),
    provider_payment_id: "pay_9Hn4KqL2wRz8Yb",
    place_of_supply: null,
    gross_minor: 4440,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: 4440,
    tax_rate: 0,
    cgst_minor: 0,
    sgst_minor: 0,
    igst_minor: 0,
    tax_minor: 0,
    total_minor: 4440,
    refunded_minor: 0,
    email: "jordan.lee@meridianresearch.io",
    supplier_snapshot: SUPPLIER_UNREGISTERED,
    buyer_snapshot: {
      legal_name: "Jordan Lee",
      company: "Meridian Research",
      address: "",
      state: "",
      country: "United States",
      gstin: null,
      email: "jordan.lee@meridianresearch.io",
    },
  };
  return <InvoiceModal invoice={invoice} onClose={() => {}} />;
}

export function CreditNoteForDowngrade() {
  const invoice = {
    id: "2c4e6a8b-3d5f-4b7c-9a1e-6f8b3d5a7c9e",
    invoice_no: "DTQC/2026-27/000041",
    series: "DTQC",
    doc_type: "credit_note",
    status: "paid",
    currency: "INR",
    issued_at: new Date(now - 1 * DAY).toISOString(),
    period_start: null,
    period_end: null,
    provider_payment_id: null,
    place_of_supply: "Karnataka",
    gross_minor: -319800,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: -319800,
    tax_rate: 0.18,
    cgst_minor: -28782,
    sgst_minor: -28782,
    igst_minor: 0,
    tax_minor: -57564,
    total_minor: -377364,
    refunded_minor: 0,
    email: "priya.sharma@northwindanalytics.in",
    supplier_snapshot: SUPPLIER_REGISTERED,
    buyer_snapshot: {
      legal_name: "Northwind Analytics LLP",
      company: "Northwind Analytics LLP",
      address: "12 MG Road, Bengaluru",
      state: "Karnataka",
      country: "India",
      gstin: "29AACFN1234M1Z8",
      email: "priya.sharma@northwindanalytics.in",
    },
  };
  return <InvoiceModal invoice={invoice} onClose={() => {}} />;
}

export function PartiallyRefundedUSD() {
  const invoice = {
    id: "7f1a3c5e-8b2d-4a6c-9e1f-3b5d7a9c1e2f",
    invoice_no: "DTQ/2026-27/000389",
    series: "DTQ",
    doc_type: "payment_receipt",
    status: "partially_refunded",
    currency: "USD",
    issued_at: new Date(now - 14 * DAY).toISOString(),
    period_start: new Date(now - 14 * DAY).toISOString(),
    period_end: new Date(now + 16 * DAY).toISOString(),
    provider_payment_id: "pay_3Xm7QpL9vNz2Kd",
    place_of_supply: null,
    gross_minor: 7900,
    discount_minor: 0,
    proration_credit_minor: 0,
    taxable_minor: 7900,
    tax_rate: 0,
    cgst_minor: 0,
    sgst_minor: 0,
    igst_minor: 0,
    tax_minor: 0,
    total_minor: 7900,
    refunded_minor: 4000,
    email: "sam.okafor@driftlinemedia.com",
    supplier_snapshot: SUPPLIER_UNREGISTERED,
    buyer_snapshot: {
      legal_name: "Sam Okafor",
      company: "Driftline Media",
      address: "",
      state: "",
      country: "United States",
      gstin: null,
      email: "sam.okafor@driftlinemedia.com",
    },
  };
  return <InvoiceModal invoice={invoice} onClose={() => {}} />;
}
