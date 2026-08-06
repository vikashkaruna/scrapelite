// BulkUploadModal.jsx — opened by the FAB button next to the URL input.
// Lets users paste a list of URLs or upload a CSV file. On confirm it calls
// onUrls(validUrls[]) so the parent can route them to inline batch or /batch.
import { useState, useRef } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { isValidUrl } from "../lib/utils.js";
import { parseUrlsFromCsv } from "../lib/batchService.js";

function parseLines(text) {
  const raw = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const r of raw) {
    const norm = /^https?:\/\//i.test(r) ? r : "https://" + r;
    if (seen.has(norm.toLowerCase())) continue;
    seen.add(norm.toLowerCase());
    if (isValidUrl(norm)) valid.push(norm);
    else invalid.push(r);
  }
  return { valid, invalid };
}

export default function BulkUploadModal({ open, onClose, onUrls }) {
  const [tab, setTab] = useState("paste");
  const [text, setText] = useState("");
  const [csvUrls, setCsvUrls] = useState([]);
  const [csvError, setCsvError] = useState("");
  const fileRef = useRef(null);

  const { valid, invalid } = parseLines(text);
  const activeUrls = tab === "paste" ? valid : csvUrls;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError("");
    setCsvUrls([]);
    try {
      const content = await file.text();
      const urls = parseUrlsFromCsv(content);
      setCsvUrls(urls);
    } catch {
      setCsvError("Could not parse this CSV. Make sure URLs are in the first column.");
    }
    // Allow re-selecting same file
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleConfirm = () => {
    if (!activeUrls.length) return;
    onUrls(activeUrls);
    handleClose();
  };

  const handleClose = () => {
    setText("");
    setCsvUrls([]);
    setCsvError("");
    setTab("paste");
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="bum-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bum-card">
        {/* Header */}
        <div className="bum-header">
          <div className="bum-title">
            <Icon name="layers-2" size={18} />
            Bulk URL Import
          </div>
          <button className="modal-close" onClick={handleClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="bum-tabs">
          <button
            className={"bum-tab" + (tab === "paste" ? " bum-tab-active" : "")}
            onClick={() => setTab("paste")}
            type="button"
          >
            <Icon name="list-checks" size={14} /> Paste URLs
          </button>
          <button
            className={"bum-tab" + (tab === "csv" ? " bum-tab-active" : "")}
            onClick={() => setTab("csv")}
            type="button"
          >
            <Icon name="file-up" size={14} /> Upload CSV
          </button>
        </div>

        {/* Paste tab */}
        {tab === "paste" && (
          <div className="bum-body">
            <p className="bum-hint">
              One URL per line, or comma-separated. Bare domains (e.g. <code>stripe.com</code>) work too.
            </p>
            <textarea
              className="bum-textarea"
              rows={7}
              placeholder={"https://acme.com\nhttps://acme.com/pricing\nhttps://acme.com/about"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            {text.trim() && (
              <div className="bum-count">
                <span className="bum-count-valid">
                  <Icon name="check" size={12} /> {valid.length} valid URL{valid.length !== 1 ? "s" : ""}
                </span>
                {invalid.length > 0 && (
                  <span className="bum-count-invalid">
                    <Icon name="x" size={12} /> {invalid.length} skipped
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* CSV tab */}
        {tab === "csv" && (
          <div className="bum-body">
            <p className="bum-hint">
              Upload a CSV file. URLs should be in the first column — header row is optional.
            </p>
            <div className="bum-file-drop" onClick={() => fileRef.current?.click()}>
              <Icon name="file-up" size={28} />
              <span>Click to upload CSV</span>
              <span className="bum-file-note">.csv files only</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={handleFile}
            />
            {csvError && <p className="bum-csv-error">{csvError}</p>}
            {csvUrls.length > 0 && (
              <div className="bum-count">
                <span className="bum-count-valid">
                  <Icon name="check" size={12} /> {csvUrls.length} URLs loaded from CSV
                </span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="bum-footer">
          <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            variant="primary"
            iconRight="arrow-right"
            onClick={handleConfirm}
            disabled={activeUrls.length === 0}
          >
            {activeUrls.length > 0
              ? `Use ${activeUrls.length} URL${activeUrls.length !== 1 ? "s" : ""}`
              : "Add URLs"}
          </Button>
        </div>
      </div>
    </div>
  );
}
