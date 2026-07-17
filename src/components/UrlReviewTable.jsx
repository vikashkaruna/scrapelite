// src/components/UrlReviewTable.jsx — Q7 (Batch default = table view) UI.
//
// A comparable grid for the multi-URL list. Default = expanded table so the
// user can review + remove individual URLs before running. Provides:
//   - Index, host, full URL, status (valid/invalid/duplicate), remove (×)
//   - Bulk "Copy all" + "Clear" actions
//   - Collapsible toggle (default expanded when URLs are present)

import { useState } from "react";
import Icon from "./Icon.jsx";

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export default function UrlReviewTable({
  urls = [],
  invalid = [],
  onRemove,
  onClear,
  maxHeight = 320,
}) {
  // Default expanded when there are URLs to review, collapsed when empty.
  const [open, setOpen] = useState(urls.length + invalid.length > 0);
  const [copied, setCopied] = useState(false);

  const totalCount = urls.length + invalid.length;
  if (totalCount === 0) return null;

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable in tests; that's fine.
    }
  };

  return (
    <div className={"url-review" + (open ? " open" : " collapsed")}>
      <div className="url-review-head">
        <button
          type="button"
          className="url-review-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
          <span>
            Review URLs — {urls.length} valid
            {invalid.length > 0 && ` · ${invalid.length} invalid`}
          </span>
        </button>
        <div className="url-review-actions">
          <button
            type="button"
            className="url-review-action"
            onClick={copyAll}
            title="Copy all valid URLs to clipboard"
            disabled={urls.length === 0}
          >
            <Icon name={copied ? "check" : "copy"} size={12} />
            {copied ? "Copied" : "Copy all"}
          </button>
          <button
            type="button"
            className="url-review-action danger"
            onClick={onClear}
            title="Clear all URLs"
          >
            <Icon name="trash-2" size={12} />
            Clear
          </button>
        </div>
      </div>
      {open && (
        <div className="url-review-body" style={{ maxHeight }}>
          <table className="url-review-table">
            <thead>
              <tr>
                <th className="urt-num">#</th>
                <th>URL</th>
                <th className="urt-status">Status</th>
                <th className="urt-act"></th>
              </tr>
            </thead>
            <tbody>
              {urls.map((url, i) => (
                <tr key={`v-${i}-${url}`} className="urt-valid">
                  <td className="urt-num">{i + 1}</td>
                  <td className="urt-url" title={url}>
                    <span className="urt-host">{hostOf(url)}</span>
                    <span className="urt-path">{url.replace(/^https?:\/\/[^/]+/, "")}</span>
                  </td>
                  <td className="urt-status">
                    <span className="urt-badge ok">
                      <Icon name="check" size={10} />
                      Valid
                    </span>
                  </td>
                  <td className="urt-act">
                    <button
                      type="button"
                      className="urt-remove"
                      onClick={() => onRemove?.(i)}
                      aria-label={`Remove ${url}`}
                      title="Remove this URL"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {invalid.map((raw, i) => (
                <tr key={`i-${i}-${raw}`} className="urt-invalid">
                  <td className="urt-num">—</td>
                  <td className="urt-url" title={raw}>
                    <span className="urt-host muted">{raw}</span>
                  </td>
                  <td className="urt-status">
                    <span className="urt-badge bad">
                      <Icon name="alert-triangle" size={10} />
                      Invalid
                    </span>
                  </td>
                  <td className="urt-act"></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
