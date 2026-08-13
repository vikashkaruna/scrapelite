// src/components/WebhookSetupModal.jsx
//
// F-44 — Per-user webhook setup.
//
// Reachable from the Webhook / n8n "Use now" button on /integrations.
// Lets the user paste a webhook URL (Zapier / n8n / Make / Pipedream /
// any HTTPS endpoint), test it with a synthetic extraction event, and
// save it to localStorage. The saved URL is what webhook.js reads on
// every notifyWebhook() call, so the next extraction fires to the
// user's target with no reload needed.
//
// The modal also shows the current state:
//   - "Platform URL only"  → operator-set VITE_WEBHOOK_URL is active
//   - "Your URL"            → user URL is set and active
//   - "Not configured"      → neither set; feature is off
//
// The full URL is NEVER displayed back to the user. Showing even the
// last 4 characters makes targeted phishing easier. The status pill
// reveals only "configured" vs "not configured".

import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import {
  isValidWebhookUrl,
  setUserWebhookUrl,
  clearUserWebhookUrl,
  getUserWebhookUrl,
} from "../lib/userWebhook.js";
import { getEffectiveWebhookUrl } from "../lib/webhook.js";

// Send a synthetic event to the URL and return { ok, status, error? }.
// The test event has the same shape as a real extraction.saved payload
// so the user can verify their endpoint accepts it before the next
// real save fires.
async function sendTestEvent(url) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "extraction.saved",
        sent_at: new Date().toISOString(),
        source: "datiq",
        test: true,
        data: {
          id: "ext_test",
          url: "https://example.com",
          page_title: "DatIQ — Test extraction",
          ai_summary: "This is a test event from the Webhook setup modal.",
          headings: ["Test heading"],
          links: [{ href: "https://example.com", text: "Example" }],
          created_at: new Date().toISOString(),
        },
      }),
    });
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `Webhook returned ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, error: err.message || "Network error" };
  }
}

export default function WebhookSetupModal({ open, onClose }) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [userUrl, setUserUrlState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");

  // Reset state every time the modal opens so a previous session
  // doesn't leak its test result into the next open.
  useEffect(() => {
    if (!open) return;
    setInput("");
    setError("");
    setTestResult(null);
    setUserUrlState(getUserWebhookUrl());
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleSave = () => {
    setError("");
    setTestResult(null);
    if (!isValidWebhookUrl(input)) {
      setError("Please enter a valid http(s) URL — e.g. https://hooks.zapier.com/abc/xyz");
      return;
    }
    try {
      setUserWebhookUrl(input);
      setUserUrlState(input);
      setInput("");
      toast("Webhook URL saved", "success");
    } catch (err) {
      setError(err.message || "Failed to save");
    }
  };

  const handleClear = () => {
    clearUserWebhookUrl();
    setUserUrlState(null);
    setInput("");
    setTestResult(null);
    setError("");
    toast("Webhook URL cleared — falling back to the platform URL", "info");
  };

  const handleTest = async () => {
    setError("");
    setTestResult(null);
    // Test whatever the user has typed (if valid), else whatever is
    // already saved, else the platform URL — same precedence as
    // the real dispatcher.
    const candidate = isValidWebhookUrl(input) ? input.trim() : getEffectiveWebhookUrl();
    if (!candidate) {
      setError("Enter a URL first, or save one with the form above.");
      return;
    }
    setBusy(true);
    const result = await sendTestEvent(candidate);
    setBusy(false);
    setTestResult(result);
    if (result.ok) {
      toast(`Test event delivered (${result.status})`, "success");
    } else {
      toast(`Test failed: ${result.error}`, "error");
    }
  };

  // Status pill: "Your URL" / "Platform URL" / "Not configured".
  const effective = getEffectiveWebhookUrl();
  const status = userUrl
    ? { label: "Your URL is active", cls: "ws-status-on" }
    : effective
      ? { label: "Using platform URL", cls: "ws-status-platform" }
      : { label: "Not configured", cls: "ws-status-off" };

  return (
    <div className="notify-modal-overlay" role="dialog" aria-modal="true" aria-label="Webhook setup">
      <div className="notify-modal ws-modal">
        <button className="notify-modal-close" onClick={onClose} aria-label="Close">
          <Icon name="x" size={14} />
        </button>
        <span className="notify-modal-eyebrow">
          <Icon name="zap" size={12} />
          Available
        </span>
        <h2 className="notify-modal-title">Webhook / n8n</h2>
        <p className="notify-modal-sub">
          DatIQ POSTs a JSON <code>extraction.saved</code> event to your URL the moment
          an extraction is saved. Use it to pipe data into n8n, Make, Zapier, Pipedream,
          or any HTTP endpoint.
        </p>

        <div className={`ws-status ${status.cls}`}>
          <span className="ws-status-dot" />
          {status.label}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          className="ws-form"
        >
          <label className="ws-label" htmlFor="ws-url">Your webhook URL</label>
          <div className="ws-input-row">
            <input
              id="ws-url"
              type="url"
              placeholder="https://hooks.zapier.com/abc/xyz"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); setTestResult(null); }}
              className="notify-modal-input ws-input"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" variant="primary" disabled={!input.trim()}>
              {userUrl ? "Update" : "Save"}
            </Button>
          </div>
          {userUrl && (
            <button type="button" className="ws-clear-btn" onClick={handleClear}>
              <Icon name="trash" size={12} /> Clear my URL (use platform default)
            </button>
          )}

          {error && <div className="notify-modal-error">{error}</div>}
          {testResult && (
            <div
              className={`ws-test-result ${testResult.ok ? "ok" : "fail"}`}
              role="status"
            >
              <Icon name={testResult.ok ? "check" : "alert"} size={14} />
              {testResult.ok
                ? `Test event delivered — HTTP ${testResult.status}`
                : `Test failed: ${testResult.error}`}
            </div>
          )}

          <div className="ws-actions">
            <Button
              type="button"
              variant="secondary"
              icon="zap"
              loading={busy}
              loadingText="Sending…"
              onClick={handleTest}
            >
              Send test event
            </Button>
            <a
              href="https://docs.datiq.app/integrations/webhook"
              target="_blank"
              rel="noopener noreferrer"
              className="ws-docs-link"
            >
              <Icon name="book" size={12} /> Event payload reference
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
