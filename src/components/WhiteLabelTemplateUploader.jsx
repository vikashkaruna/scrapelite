// WhiteLabelTemplateUploader.jsx — the Account-page section that lets a
// Business or Agency user upload, preview, replace, or remove their branded
// PDF template. Available only when the entitlement model grants
// `white_label_pdf` — every entry point on this component assumes the
// caller has already gated it.
//
// Flow:
//   1. User picks a PDF file via <input type="file" accept="application/pdf">.
//   2. We validate (MIME, size ≤ 2 MB, "%PDF" signature).
//   3. We save via writeTemplate() — localStorage by default, Supabase
//      Storage when configured and the user is signed in.
//   4. The UI re-reads readTemplateMeta() and shows the filename + size.
//
// Errors are surfaced inline rather than via toasts so the user can correct
// them without dismissing a transient banner. The component is uncontrolled
// for the file input (it's a one-shot action) but reactive for the meta
// panel, which re-reads after every write/clear.

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import {
  MAX_BYTES,
  clearTemplate,
  dataUrlToBytes,
  readTemplate,
  readTemplateMeta,
  writeTemplate,
} from "../lib/whiteLabelTemplate.js";

const ACCEPT = "application/pdf";

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function WhiteLabelTemplateUploader({ userId = null, canManage = true }) {
  const [meta, setMeta] = useState(() => readTemplateMeta());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const fileRef = useRef(null);

  // Re-read the meta when the component mounts (handles the case where a
  // template was written in another tab / device and we just navigated here).
  useEffect(() => { setMeta(readTemplateMeta()); }, []);

  // Build a preview URL whenever the meta changes. The PDF blob is loaded
  // on demand — the actual template bytes can be up to 2 MB, so we don't
  // keep them in React state.
  useEffect(() => {
    let revoke = "";
    (async () => {
      if (!meta || !meta.fileName) { setPreviewUrl(""); return; }
      const res = await readTemplate({ userId });
      if (res?.ok && res.value?.bytes) {
        const bytes = res.value.bytes;
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        revoke = url;
        setPreviewUrl(url);
      } else {
        setPreviewUrl("");
      }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [meta, userId]);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setInfo("");
    const res = await writeTemplate(file, { userId });
    setBusy(false);
    if (!res.ok) {
      setError(res.reason || "Could not save the template.");
      // Reset the input so the same file can be re-picked after a fix.
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setInfo(`Saved ${file.name} (${formatBytes(file.size)}).`);
    setMeta({ fileName: file.name, size: file.size, uploadedAt: res.value?.uploadedAt });
  }

  function handleClear() {
    if (!window.confirm("Remove your white-label template? Exported PDFs will use the default DatIQ layout.")) return;
    clearTemplate();
    setMeta(null);
    setInfo("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!canManage) {
    return (
      <div className="wlp-block wlp-block--locked">
        <div className="wlp-locked-row">
          <Icon name="lock" size={16} />
          <div>
            <strong>White-label PDF — not available on your tier.</strong>
            <p>Upgrade to the Business plan to upload a branded template that appears on every exported PDF.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wlp-block">
      <div className="wlp-head">
        <Icon name="file-text" size={18} />
        <div>
          <h3 className="wlp-title">White-label PDF template</h3>
          <p className="wlp-sub">
            Upload a single-page PDF (≤ {formatBytes(MAX_BYTES)}). Its first page becomes the
            background of every PDF you export, with the body content laid on top.
          </p>
        </div>
      </div>

      <div className="wlp-actions">
        <label className={"wlp-upload-btn" + (busy ? " is-busy" : "")}>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFile}
            disabled={busy}
            style={{ display: "none" }}
          />
          <Icon name="upload" size={14} />
          {busy ? "Uploading…" : meta ? "Replace template" : "Choose PDF"}
        </label>
        {meta && (
          <button type="button" className="wlp-clear-btn" onClick={handleClear} disabled={busy}>
            <Icon name="trash-2" size={14} /> Remove
          </button>
        )}
      </div>

      {error && <div className="wlp-msg wlp-msg--err"><Icon name="alert-circle" size={13} />{error}</div>}
      {info && <div className="wlp-msg wlp-msg--ok"><Icon name="check-circle" size={13} />{info}</div>}

      {meta && (
        <div className="wlp-current">
          <div className="wlp-current-info">
            <Icon name="file" size={14} />
            <div>
              <div className="wlp-current-name">{meta.fileName || "template.pdf"}</div>
              <div className="wlp-current-meta">
                {formatBytes(meta.size)}
                {meta.uploadedAt ? ` · uploaded ${new Date(meta.uploadedAt).toLocaleString()}` : ""}
                {meta.storage ? ` · stored ${meta.storage}` : ""}
              </div>
            </div>
          </div>
          {previewUrl && (
            <a className="wlp-preview-link" href={previewUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="external-link" size={12} /> Preview
            </a>
          )}
        </div>
      )}

      <details className="wlp-help">
        <summary>How does this work?</summary>
        <ul>
          <li>Your template is painted as the background of every page in the exported PDF — your logo, brand colors, and footer appear on every page.</li>
          <li>Body text is drawn on top, fully opaque, so the report is always readable regardless of how busy the background is.</li>
          <li>The template is private to your account. Signed-in users get Supabase Storage; signed-out users get browser-local storage.</li>
          <li>Replace it any time. The new template applies to the very next export.</li>
        </ul>
      </details>
    </div>
  );
}
