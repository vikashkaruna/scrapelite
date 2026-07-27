// invoiceModel.js — the invoice as DATA, independent of how it is rendered.
//
// One model drives three surfaces: the PDF (invoicePdf.js), the HTML email
// body, and the on-screen viewer in Account. That is the point — if each
// rendered its own numbers they would eventually disagree, and "the PDF says
// something different from the website" is a support nightmare on a document
// people file with their accountant.
//
// Pure: no jsPDF, no DOM, no I/O. Safe to import in a Netlify function.

export const SAC_CODE = "998314";

export const DOC_TYPE = Object.freeze({
  TAX_INVOICE: "tax_invoice",
  PAYMENT_RECEIPT: "payment_receipt",
  CREDIT_NOTE: "credit_note",
});

export function docTypeLabel(docType) {
  if (docType === DOC_TYPE.TAX_INVOICE) return "Tax Invoice";
  if (docType === DOC_TYPE.CREDIT_NOTE) return "Credit Note";
  return "Payment Receipt";
}

/**
 * Indian digit grouping: 12,34,567.89 rather than 1,234,567.89.
 * Applied for INR only; other currencies use standard thousands grouping.
 */
export function groupIndian(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

/**
 * Format money for a document.
 *
 * ASCII currency CODE, never a symbol. jsPDF's helvetica is a base-14 Type1
 * font with WinAnsi encoding and simply has no glyph for U+20B9 (₹) — it would
 * render as a wrong character or nothing at all. "INR 1,23,456.00" is also what
 * most Indian GST invoices actually print, so this is the conventional choice
 * rather than a workaround. invoicePdf.test.js asserts no rupee sign survives
 * into a rendered PDF.
 */
export function formatMoney(minor, currency = "INR") {
  const neg = Number(minor) < 0;
  const abs = Math.abs(Math.round(Number(minor) || 0));
  const major = Math.floor(abs / 100);
  const paise = String(abs % 100).padStart(2, "0");
  const grouped =
    currency === "INR"
      ? groupIndian(String(major))
      : String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${currency} ${grouped}.${paise}`;
}

function fmtDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mmm = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    d.getUTCMonth()
  ];
  return `${dd} ${mmm} ${d.getUTCFullYear()}`;
}

function partyLines(p = {}) {
  return [
    p.legal_name || p.name || "",
    p.company || "",
    p.address || "",
    [p.state, p.country].filter(Boolean).join(", "),
    p.gstin ? `GSTIN: ${p.gstin}` : "",
    p.email || "",
  ].filter(Boolean);
}

/**
 * Build the renderable document.
 *
 * @param {object} invoice  an `invoices` row
 * @param {Array}  lines    `invoice_lines` rows, ordered by line_no
 */
export function buildInvoiceDoc(invoice, lines = []) {
  const cur = invoice.currency || "INR";
  const isTax = invoice.doc_type === DOC_TYPE.TAX_INVOICE;
  const isCredit = invoice.doc_type === DOC_TYPE.CREDIT_NOTE;
  const supplier = invoice.supplier_snapshot || {};
  const buyer = invoice.buyer_snapshot || {};

  const meta = [
    { label: isCredit ? "Credit note no." : "Invoice no.", value: invoice.invoice_no },
    { label: "Date", value: fmtDate(invoice.issued_at) },
  ];
  if (invoice.period_start && invoice.period_end) {
    meta.push({
      label: "Service period",
      value: `${fmtDate(invoice.period_start)} – ${fmtDate(invoice.period_end)}`,
    });
  }
  if (invoice.provider_payment_id) {
    meta.push({ label: "Payment ref.", value: invoice.provider_payment_id });
  }
  // Place of supply is a mandatory field on a GST tax invoice; it is noise on a
  // plain receipt, so it only appears where it is legally required.
  if (isTax && invoice.place_of_supply) {
    meta.push({ label: "Place of supply", value: invoice.place_of_supply });
  }

  // Only an actual SUPPLY carries an SAC code and a quantity. A discount or a
  // proration credit is a reduction of consideration, not a service — printing
  // SAC 998314 against a coupon line would be wrong on a GST document.
  const isSupplyLine = (kind) => kind === "plan" || kind === "bundle";

  const bodyLines = (lines.length ? lines : []).map((l) => {
    const supply = isSupplyLine(l.kind);
    return {
      description: l.description,
      hsnSac: isTax && supply ? l.hsn_sac || SAC_CODE : "",
      qty: supply ? (l.qty ?? 1) : "",
      amountText: formatMoney(l.amount_minor, cur),
      isCredit: Number(l.amount_minor) < 0,
    };
  });

  const totals = [];
  if (invoice.discount_minor > 0 || invoice.proration_credit_minor > 0) {
    totals.push({ label: "Gross", value: formatMoney(invoice.gross_minor, cur) });
  }
  totals.push({
    label: isTax ? "Taxable value" : "Subtotal",
    value: formatMoney(invoice.taxable_minor, cur),
  });

  if (isTax && invoice.tax_minor > 0) {
    const pct = Math.round(Number(invoice.tax_rate) * 100);
    if (invoice.igst_minor > 0) {
      totals.push({ label: `IGST @ ${pct}%`, value: formatMoney(invoice.igst_minor, cur) });
    } else {
      const half = pct / 2;
      totals.push({ label: `CGST @ ${half}%`, value: formatMoney(invoice.cgst_minor, cur) });
      totals.push({ label: `SGST @ ${half}%`, value: formatMoney(invoice.sgst_minor, cur) });
    }
  }

  totals.push({
    label: isCredit ? "Total credited" : "Total paid",
    value: formatMoney(invoice.total_minor, cur),
    emphasis: true,
  });

  const notes = [];
  if (!isTax && !isCredit) {
    // Never let an unregistered document be mistaken for a tax invoice.
    notes.push("This is a payment receipt, not a tax invoice. No GST has been charged or collected.");
  }
  if (isTax) {
    notes.push(`Service accounting code (SAC): ${SAC_CODE}.`);
    if (!buyer.gstin) {
      // ASCII only — see toPdfSafe() in invoicePdf.js. An arrow here silently
      // wrecked the whole line's letter-spacing in the rendered PDF.
      notes.push("Add your GSTIN under Account > Billing details to claim input tax credit on future invoices.");
    }
  }
  if (invoice.status === "refunded") notes.push("This invoice has been fully refunded.");
  if (invoice.status === "partially_refunded") {
    notes.push(`Partially refunded: ${formatMoney(invoice.refunded_minor, cur)}.`);
  }
  notes.push("This is a computer-generated document and does not require a signature.");

  return {
    docType: invoice.doc_type,
    title: docTypeLabel(invoice.doc_type),
    invoiceNo: invoice.invoice_no,
    isTaxInvoice: isTax,
    currency: cur,
    supplier: { name: supplier.legal_name || "DatIQ", lines: partyLines(supplier) },
    buyer: {
      name: buyer.legal_name || buyer.name || invoice.email || "Customer",
      lines: partyLines({ ...buyer, email: buyer.email || invoice.email }),
    },
    meta,
    lines: bodyLines,
    totals,
    notes,
    statusLabel: invoice.status,
  };
}
