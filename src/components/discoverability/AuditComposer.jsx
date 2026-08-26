// AuditComposer.jsx — the URL bar and audit options.
//
// One field, sensible defaults, and everything else behind "Advanced". The
// four-toggle Home screen this codebase replaced is the cautionary tale: every
// option on the surface is a decision the user has to make before they can find
// out whether the tool is useful.

import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { AUDIT_PROFILES, PROFILE_IDS } from "../../lib/discoverability/auditProfiles.js";
import { PAGE_TYPE_PACKS } from "../../lib/discoverability/auditProfiles.js";

const PAGE_TYPE_OPTIONS = [
  { id: "", label: "Detect automatically" },
  ...Object.values(PAGE_TYPE_PACKS)
    .filter((p) => p.id !== "unknown")
    .map((p) => ({ id: p.id, label: p.label })),
];

export default function AuditComposer({ onRun, running, defaultUrl = "", remaining, signedIn = true }) {
  const [url, setUrl] = useState(defaultUrl);
  const [advanced, setAdvanced] = useState(false);
  const [profile, setProfile] = useState("balanced");
  const [device, setDevice] = useState("mobile");
  const [pageType, setPageType] = useState("");
  const [error, setError] = useState("");

  function submit(e) {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { setError("Paste the URL of the page you want to audit."); return; }
    // Accept a bare domain; a user typing example.com means https://example.com.
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try { new URL(withScheme); } catch { setError("That doesn't look like a web address."); return; }
    setError("");
    onRun({
      target_url: withScheme,
      audit_profile: profile,
      device_profile: device,
      page_type_hint: pageType || null,
      // A double-clicked Run button costs one audit, not two: the server
      // returns the original rather than spending a second credit.
      idempotency_key: `${withScheme}|${profile}|${device}|${Math.floor(Date.now() / 30000)}`,
    });
  }

  return (
    <form className="dsc-composer" onSubmit={submit}>
      <div className="dsc-composer-row">
        <div className="dsc-composer-field">
          <Icon name="scan-search" size={18} />
          <input
            type="text"
            className="dsc-composer-input"
            placeholder="https://example.com/the-page-you-want-found"
            value={url}
            onChange={(e) => { setUrl(e.target.value); if (error) setError(""); }}
            aria-label="URL to audit"
            aria-invalid={Boolean(error)}
            disabled={running}
          />
        </div>
        <Button type="submit" loading={running} disabled={running}>
          {running ? "Auditing…" : "Run audit"}
        </Button>
      </div>

      {error && <p className="dsc-composer-error" role="alert">{error}</p>}

      <div className="dsc-composer-foot">
        <button
          type="button"
          className="dsc-advanced-toggle"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          <Icon name={advanced ? "chevron-down" : "chevron-right"} size={14} />
          Advanced options
        </button>
        {!signedIn ? (
          // Said BEFORE the click, not after it. Audits are signed-in only, and
          // the global trial banner above talks about extraction credits — which
          // are a different allowance and do not apply here. Letting someone
          // press Run and then bouncing them to a sign-up modal is a worse way
          // to learn the same fact.
          <span className="dsc-remaining">
            Audits need a free account — your history is what makes the second one useful.
          </span>
        ) : Number.isFinite(remaining) && (
          <span className="dsc-remaining">
            {remaining} audit{remaining === 1 ? "" : "s"} left this month
          </span>
        )}
      </div>

      {advanced && (
        <div className="dsc-advanced">
          <fieldset className="dsc-fieldset">
            <legend>Audit profile</legend>
            <p className="dsc-fieldset-hint">
              Changes which score leads the report. All four are always computed with the
              same weightings, so an audit run under one profile stays comparable with one
              run under another.
            </p>
            <div className="dsc-chip-row">
              {PROFILE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`dsc-chip${profile === id ? " dsc-chip-on" : ""}`}
                  onClick={() => setProfile(id)}
                  aria-pressed={profile === id}
                  title={AUDIT_PROFILES[id].description}
                >
                  {AUDIT_PROFILES[id].label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="dsc-advanced-grid">
            <label className="dsc-field">
              <span>Device</span>
              <select value={device} onChange={(e) => setDevice(e.target.value)}>
                <option value="mobile">Mobile (crawl default)</option>
                <option value="desktop">Desktop</option>
              </select>
            </label>

            <label className="dsc-field">
              <span>Page type</span>
              <select value={pageType} onChange={(e) => setPageType(e.target.value)}>
                {PAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <small>
                Decides which checks apply. A pricing page has no procedure to
                describe, so it is never asked for HowTo markup.
              </small>
            </label>
          </div>
        </div>
      )}
    </form>
  );
}
