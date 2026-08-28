// WhiteLabelTemplateUploader.jsx — the Account-page section that lets a
// Business or Agency user customize the branding on every exported
// file/email. Available only when the entitlement model grants
// `white_label_pdf` — every entry point on this component assumes the
// caller has already gated it.
//
// Two mechanisms, both optional and independent:
//
//   1. Brand Kit (default, structured) — company name, tagline, accent
//      color, footer text, website, contact email, and a small logo image.
//      Every export format's branding renderer (exportBranding.js) reads
//      these fields natively — PDF, Markdown, CSV, JSON and report emails
//      all pick it up, not just PDF.
//   2. Full-page PDF background (legacy, "Advanced") — upload a single-page
//      PDF and its first page is painted as a full-bleed background behind
//      every generated page. PDF-only, no structured fields — kept working
//      exactly as it always has, for anyone already relying on it.
//
// A small "Powered by DatIQ" credit always survives in both cases — see
// exportBranding.js's poweredByLine, which nothing in either mechanism can
// suppress.

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import {
  MAX_BYTES,
  clearTemplate,
  readTemplate,
  readTemplateMeta,
  writeTemplate,
  readBrandKit,
  writeBrandKit,
  clearBrandKit,
} from "../lib/whiteLabelTemplate.js";
import { buildBrandingContext, brandingMarkdownHeader, brandingMarkdownFooter } from "../lib/exportBranding.js";

const ACCEPT = "application/pdf";
const LOGO_ACCEPT = "image/png,image/jpeg,image/svg+xml";
const LOGO_MAX_BYTES = 200 * 1024;
const DEFAULT_ACCENT = "#4f46e5";

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const BLANK_KIT = { companyName: "", tagline: "", accentColor: "", footerText: "", website: "", contactEmail: "" };

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = dataUrl;
  });
}

/** Brand Kit form + live preview. Exported separately from the default
 *  export so it can also compose into other Account layouts if needed. */
function BrandKitEditor() {
  const [saved, setSaved] = useState(() => readBrandKit());
  const [form, setForm] = useState(() => ({ ...BLANK_KIT, ...(readBrandKit() || {}) }));
  const [logo, setLogo] = useState(() => saved?.logo || null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const logoRef = useRef(null);

  useEffect(() => { setInfo(""); setError(""); }, [form, logo]);

  async function handleLogoFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      setError(`Logo must be ${(LOGO_MAX_BYTES / 1024).toFixed(0)}KB or smaller.`);
      if (logoRef.current) logoRef.current.value = "";
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { width, height } = await readImageDimensions(dataUrl);
      setLogo({ dataUrl, width, height });
    } catch {
      setError("Could not read that image.");
    }
  }

  function handleSave() {
    setBusy(true);
    setError("");
    const payload = { ...form };
    if (logo) payload.logo = logo;
    const res = writeBrandKit(payload);
    setBusy(false);
    if (!res.ok) { setError(res.reason || "Could not save your brand kit."); return; }
    setSaved(res.value);
    setInfo("Brand kit saved — applies to your next export.");
  }

  function handleReset() {
    if (!window.confirm("Remove your brand kit? Exports will use the default DatIQ look.")) return;
    clearBrandKit();
    setSaved(null);
    setForm({ ...BLANK_KIT });
    setLogo(null);
    setInfo("");
    setError("");
    if (logoRef.current) logoRef.current.value = "";
  }

  // Live preview — built from the SAME context object and the SAME markdown
  // renderer every real export uses, so the Markdown preview is byte-exact,
  // not a mockup that can drift from what actually gets generated. The
  // PDF/email preview below is a visual approximation using the same
  // brand/tagline/accentColor/logo fields (rendering a live jsPDF page just
  // for a form preview is more machinery than a preview needs), clearly
  // labeled as such rather than implied to be pixel-exact.
  const previewCtx = buildBrandingContext({
    kind: "extraction",
    sourceUrls: "https://example.com",
    generatedAt: "2026-01-01T12:00:00.000Z",
    brandKit: { ...form, logo },
  });
  const mdPreview = `${brandingMarkdownHeader(previewCtx)}\n…\n${brandingMarkdownFooter(previewCtx)}`;

  return (
    <div className="wlp-block">
      <div className="wlp-head">
        <Icon name="palette" size={18} />
        <div>
          <h3 className="wlp-title">Brand kit</h3>
          <p className="wlp-sub">
            Your company name, colors, and logo — applied to every exported PDF, Markdown, CSV, JSON
            file and report email. A small "Powered by DatIQ" credit always stays in the footer.
          </p>
        </div>
      </div>

      <div className="wlp-brandkit-grid">
        <label className="wlp-field">
          <span>Company name</span>
          <input type="text" maxLength={120} value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Acme Research Co." />
        </label>
        <label className="wlp-field">
          <span>Tagline</span>
          <input type="text" maxLength={120} value={form.tagline}
            onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
            placeholder="Market Intelligence, Delivered." />
        </label>
        <label className="wlp-field">
          <span>Accent color</span>
          <div className="wlp-color-row">
            <input type="color" value={form.accentColor || DEFAULT_ACCENT}
              onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))} />
            <input type="text" maxLength={7} value={form.accentColor}
              onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
              placeholder="#4f46e5" />
          </div>
        </label>
        <label className="wlp-field">
          <span>Website</span>
          <input type="text" maxLength={200} value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            placeholder="https://acmeresearch.example.com" />
        </label>
        <label className="wlp-field">
          <span>Contact email</span>
          <input type="text" maxLength={200} value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            placeholder="reports@acmeresearch.example.com" />
        </label>
        <label className="wlp-field wlp-field--wide">
          <span>Footer text</span>
          <input type="text" maxLength={120} value={form.footerText}
            onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
            placeholder="Confidential — prepared exclusively for Acme Research clients." />
        </label>
      </div>

      <div className="wlp-logo-row">
        <label className={"wlp-upload-btn"}>
          <input ref={logoRef} type="file" accept={LOGO_ACCEPT} onChange={handleLogoFile} style={{ display: "none" }} />
          <Icon name="image" size={14} /> {logo ? "Replace logo" : "Upload logo"}
        </label>
        {logo && (
          <div className="wlp-logo-preview">
            <img src={logo.dataUrl} alt="Logo preview" />
            <button type="button" className="wlp-clear-btn" onClick={() => { setLogo(null); if (logoRef.current) logoRef.current.value = ""; }}>
              <Icon name="x" size={12} /> Remove logo
            </button>
          </div>
        )}
      </div>

      {error && <div className="wlp-msg wlp-msg--err"><Icon name="alert-circle" size={13} />{error}</div>}
      {info && <div className="wlp-msg wlp-msg--ok"><Icon name="check-circle" size={13} />{info}</div>}

      <div className="wlp-actions">
        <Button size="sm" variant="primary" onClick={handleSave} loading={busy}>Save brand kit</Button>
        {saved && (
          <button type="button" className="wlp-clear-btn" onClick={handleReset}>
            <Icon name="trash-2" size={14} /> Remove brand kit
          </button>
        )}
      </div>

      <div className="wlp-preview">
        <div className="wlp-preview-label">Live preview</div>
        <div className="wlp-preview-pdf" style={{ borderColor: previewCtx.accentColor }}>
          <div className="wlp-preview-pdf-head">
            {logo ? <img src={logo.dataUrl} alt="" className="wlp-preview-logo" /> : <span className="wlp-preview-logo-dot" style={{ background: previewCtx.accentColor }} />}
            <div>
              <div className="wlp-preview-brand" style={{ color: previewCtx.accentColor }}>{previewCtx.brand}</div>
              {previewCtx.tagline && <div className="wlp-preview-tagline">{previewCtx.tagline}</div>}
            </div>
            <div className="wlp-preview-title">Extraction Report</div>
          </div>
          <div className="wlp-preview-body">…report content…</div>
          <div className="wlp-preview-foot">
            {previewCtx.footerText ? `${previewCtx.footerText} · ` : ""}Powered by DatIQ
          </div>
        </div>
        <details className="wlp-help">
          <summary>Markdown/CSV/JSON preview (exact — generated by the real export code)</summary>
          <pre className="wlp-preview-md">{mdPreview}</pre>
        </details>
      </div>
    </div>
  );
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
            <p>Upgrade to the Business plan to customize the branding on every exported file.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <BrandKitEditor />

      <details className="wlp-block wlp-advanced">
        <summary className="wlp-advanced-summary">
          <Icon name="file-text" size={16} /> Advanced: full-page PDF background
        </summary>

        <div className="wlp-head">
          <div>
            <h3 className="wlp-title">White-label PDF template</h3>
            <p className="wlp-sub">
              Upload a single-page PDF (≤ {formatBytes(MAX_BYTES)}). Its first page becomes the
              background of every PDF you export, with the body content laid on top. This is
              independent of the Brand Kit above — most people only need one or the other.
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

        <div className="wlp-help">
          <ul>
            <li>Your template is painted as the background of every page in the exported PDF.</li>
            <li>Body text is drawn on top, fully opaque, so the report is always readable regardless of how busy the background is.</li>
            <li>The template is private to your account. Signed-in users get Supabase Storage; signed-out users get browser-local storage.</li>
            <li>Replace it any time. The new template applies to the very next export.</li>
          </ul>
        </div>
      </details>
    </>
  );
}
