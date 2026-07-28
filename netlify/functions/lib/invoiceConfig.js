// invoiceConfig.js — who is issuing the document, and what kind of document it is.
//
// ── THE ONE SWITCH ───────────────────────────────────────────────────────────
// SUPPLIER_GSTIN decides everything:
//
//   set    → "Tax Invoice". Carries the GSTIN, SAC 998314, place of supply and
//            a CGST/SGST or IGST split. This is a document a customer can claim
//            input tax credit against.
//
//   unset  → "Payment Receipt". No GSTIN, no tax lines, and an explicit
//            "not a tax invoice" note. Issuing a document that LOOKS like a tax
//            invoice without a registration behind it is a real problem, so the
//            unregistered path must never render tax fields.
//
// This is deliberately a runtime config rather than a build flag: registration
// can be completed without a code change, and nothing about the schema or the
// renderer changes when it happens.
//
// ⚠️ Note for whoever flips this on: DatIQ already adds 18% labelled GST to
// every INR charge (create-checkout.js). If SUPPLIER_GSTIN is unset, that
// labelling is not backed by a registration and needs its own review — the
// document type is not the only thing that has to be right.

export const SAC_CODE = "998314"; // Information technology infrastructure & data services

export const DOC_TYPE = Object.freeze({
  TAX_INVOICE: "tax_invoice",
  PAYMENT_RECEIPT: "payment_receipt",
  CREDIT_NOTE: "credit_note",
});

export const SERIES = Object.freeze({
  INVOICE: "DTQ",
  CREDIT_NOTE: "DTQC",
});

/** True when the supplier is GST-registered and may issue tax invoices. */
export function isGstRegistered(env = process.env) {
  return Boolean((env.SUPPLIER_GSTIN || "").trim());
}

/**
 * Snapshot of the supplier, frozen onto every document at issue time so a later
 * change of address or legal name never rewrites history.
 */
export function getSupplierSnapshot(env = process.env) {
  const gstin = (env.SUPPLIER_GSTIN || "").trim();
  return {
    legal_name: env.SUPPLIER_LEGAL_NAME || "DatIQ",
    trade_name: env.SUPPLIER_TRADE_NAME || "DatIQ",
    address: env.SUPPLIER_ADDRESS || "",
    state: env.SUPPLIER_STATE || "",
    country: env.SUPPLIER_COUNTRY || "India",
    email: env.SUPPLIER_EMAIL || "hello@datiq.app",
    website: "https://datiq.app",
    gstin: gstin || null,
    pan: env.SUPPLIER_PAN || null,
    registered: Boolean(gstin),
  };
}

/**
 * Which document to issue.
 * A credit note stays a credit note whether or not GST applies; only its series
 * and tax treatment differ.
 */
export function resolveDocType({ isCreditNote = false, currency, env = process.env } = {}) {
  if (isCreditNote) return DOC_TYPE.CREDIT_NOTE;
  // A tax invoice only makes sense where tax was actually charged. USD supplies
  // carry no GST, so they are receipts even for a registered supplier.
  if (isGstRegistered(env) && currency === "INR") return DOC_TYPE.TAX_INVOICE;
  return DOC_TYPE.PAYMENT_RECEIPT;
}

/** Human label for the document header. */
export function docTypeLabel(docType) {
  if (docType === DOC_TYPE.TAX_INVOICE) return "Tax Invoice";
  if (docType === DOC_TYPE.CREDIT_NOTE) return "Credit Note";
  return "Payment Receipt";
}
