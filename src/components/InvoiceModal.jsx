// InvoiceModal.jsx — view one invoice, then download or email it.
//
// Renders from the SAME buildInvoiceDoc() model the PDF and the email use, so
// what the customer sees here is what they get in the file. Follows the
// .error-backdrop / .error-modal.content-modal portal convention (760px,
// self-scrolling) used by ContentModal.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";
import { useToast } from "./Toast.jsx";
import { buildInvoiceDoc } from "../lib/invoiceModel.js";
import { fetchInvoiceLines } from "../lib/billingRepo.js";
import { supabase } from "../lib/supabaseClient.js";

export default function InvoiceModal({ invoice, onClose }) {
  const showToast = useToast();
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!invoice?.id) return undefined;
    fetchInvoiceLines(invoice.id).then((rows) => {
      if (!cancelled) setLines(rows);
    });
    return () => { cancelled = true; };
  }, [invoice?.id]);

  // Document listener rather than onKeyDown on the backdrop: the latter only
  // fires when focus is already inside the dialog.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!invoice) return null;
  const model = buildInvoiceDoc(invoice, lines);

  /**
   * Download via the authenticated endpoint rather than rendering locally, so
   * the bytes the customer keeps are the ones the server vouches for.
   * Falls back to a local render when the API is unreachable — the model is
   * identical, so the document is the same.
   */
  const download = async () => {
    setBusy("download");
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const token = data?.session?.access_token;
      if (token) {
        const res = await fetch(`/api/invoice-pdf?id=${encodeURIComponent(invoice.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${String(invoice.invoice_no).replace(/[^\w-]+/g, "-")}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          showToast("Invoice downloaded", "download");
          return;
        }
      }
      const { downloadInvoicePdf } = await import("../lib/invoicePdf.js");
      downloadInvoicePdf(invoice, lines);
      showToast("Invoice downloaded", "download");
    } catch (err) {
      if (/dynamically imported/i.test(err?.message || "")) {
        showToast("App updated — please refresh the page and try again.", "info");
      } else {
        showToast("Could not download the invoice. Please try again.");
      }
    } finally {
      setBusy("");
    }
  };

  const emailIt = async () => {
    setBusy("email");
    try {
      const { data } = (await supabase?.auth.getSession()) ?? { data: null };
      const token = data?.session?.access_token;
      const res = await fetch("/api/invoice-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ invoiceId: invoice.id }),
      });
      // Deliberately vague about the address: it is always the account's own
      // registered email, never one supplied by the caller.
      showToast(res.ok ? "Invoice sent to your registered email" : "Could not send the invoice.");
    } catch {
      showToast("Could not send the invoice.");
    } finally {
      setBusy("");
    }
  };

  return createPortal(
    <div
      className="error-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-title"
      onClick={onClose}
    >
      <div className="error-modal content-modal card invoice-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm error-close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="x" size={17} />
        </button>

        <div className="inv-doc-head">
          <div>
            <h2 className="error-title" id="invoice-title">{model.title}</h2>
            <div className="inv-doc-no">{model.invoiceNo}</div>
          </div>
          <span className={`status-badge ${invoice.status}`}>{invoice.status.replace(/_/g, " ")}</span>
        </div>

        <div className="inv-parties">
          <div>
            <div className="inv-party-label">From</div>
            {model.supplier.lines.map((l, i) => (
              <div key={i} className={i === 0 ? "inv-party-name" : "inv-party-line"}>{l}</div>
            ))}
          </div>
          <div>
            <div className="inv-party-label">Billed to</div>
            {model.buyer.lines.map((l, i) => (
              <div key={i} className={i === 0 ? "inv-party-name" : "inv-party-line"}>{l}</div>
            ))}
          </div>
        </div>

        <dl className="inv-meta">
          {model.meta.map((m) => (
            <div className="inv-meta-row" key={m.label}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>

        <table className="inv-lines">
          <thead>
            <tr>
              <th>Description</th>
              {model.isTaxInvoice && <th className="inv-col-sac">SAC</th>}
              <th className="inv-col-qty">Qty</th>
              <th className="inv-col-amt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.map((l, i) => (
              <tr key={i} className={l.isCredit ? "inv-line-credit" : undefined}>
                <td>{l.description}</td>
                {model.isTaxInvoice && <td className="inv-col-sac">{l.hsnSac}</td>}
                <td className="inv-col-qty">{l.qty}</td>
                <td className="inv-col-amt">{l.amountText}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-totals">
          {model.totals.map((t) => (
            <div className={`inv-total-row${t.emphasis ? " inv-total-grand" : ""}`} key={t.label}>
              <span>{t.label}</span>
              <span>{t.value}</span>
            </div>
          ))}
        </div>

        <ul className="inv-notes">
          {model.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>

        <div className="error-actions">
          <Button variant="secondary" icon="mail" onClick={emailIt} loading={busy === "email"}>
            Email to me
          </Button>
          <Button variant="primary" icon="download" onClick={download} loading={busy === "download"}>
            Download PDF
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
