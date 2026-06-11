// ContentModal.jsx — "Generate Content" modal (PRD 4.1). Lets the user turn a
// saved extraction into marketing content (SEO outline, competitor summary,
// social posts). Reuses the error-modal shell for visual consistency.
import { useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { CONTENT_FORMATS, generateContent } from "../lib/aiService.js";

export default function ContentModal({ item, onClose }) {
  const [format, setFormat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async (fmt) => {
    setFormat(fmt);
    setOutput("");
    setError("");
    setLoading(true);
    try {
      const text = await generateContent(item, fmt);
      setOutput(text);
    } catch (err) {
      console.error("[DatIQ] Content generation failed:", err);
      setError(err?.message || "Couldn't generate content. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  return createPortal(
    <div
      className="error-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="content-title"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      onClick={onClose}
    >
      <div className="error-modal content-modal card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm error-close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="x" size={17} />
        </button>

        <div className="email-icon-wrap">
          <Icon name="wand" size={24} strokeWidth={2} />
        </div>

        <div className="error-body">
          <h2 className="error-title" id="content-title">Generate content</h2>
          <p className="error-message">
            From <b>{item.page_title}</b>. Pick a format and we'll draft it from the page's
            summary &amp; headings.
          </p>
        </div>

        <div className="content-formats">
          {CONTENT_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={"content-format" + (format?.key === f.key ? " on" : "")}
              onClick={() => run(f)}
              disabled={loading}
            >
              <span className="cf-icon">
                <Icon name={f.icon} size={16} />
              </span>
              <span className="cf-text">
                <span className="cf-label">{f.label}</span>
                <span className="cf-desc">{f.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {(loading || output || error) && (
          <div className="content-output">
            {loading ? (
              <div className="content-loading">
                <span className="spinner" style={{ "--sp-size": "18px" }} /> Generating {format?.label}…
              </div>
            ) : error ? (
              <div className="content-error">{error}</div>
            ) : (
              <>
                <div className="content-output-head">
                  <span className="cf-label">{format?.label}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                    <Icon name={copied ? "check" : "clipboard-copy"} size={14} />{" "}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="content-text scroll-y">{output}</pre>
              </>
            )}
          </div>
        )}

        <div className="error-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
