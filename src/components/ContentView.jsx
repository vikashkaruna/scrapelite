// ContentView.jsx — renders a "content" kind enrichment entry (markdown text
// produced by aiService.generateContent). The body is a single <pre> + a
// Copy button. Tabs use the same shell as the structured-data tabs in
// Preview.jsx; only the body is different.
//
// Why a separate component: the structured-data tabs render arbitrary JSON
// via StructuredData. Markdown is a different shape (one big string) and
// wants different affordances (Copy, no field-by-field navigation), so the
// branch lives in its own file rather than growing a flag soup on
// StructuredData.

import { useState } from "react";
import Icon from "./Icon.jsx";
import { copyToClipboard } from "../lib/utils.js";

export default function ContentView({ text }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await copyToClipboard(text || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be blocked (insecure context, iframe sandbox, etc).
      // We intentionally swallow the error — the user can still select
      // the text manually. A toast would be over-reach for a permission
      // issue that's almost always a browser setting.
    }
  };

  return (
    <div className="content-view">
      <div className="content-view-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCopy}
          aria-label="Copy content"
        >
          <Icon name={copied ? "check" : "clipboard-copy"} size={14} />{" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="content-view-text scroll-y">{text || ""}</pre>
    </div>
  );
}
