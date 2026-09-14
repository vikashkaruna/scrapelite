// AuditComposer.jsx — the URL bar and audit options.
//
// One field, sensible defaults, and everything else behind "Advanced". The
// four-toggle Home screen this codebase replaced is the cautionary tale: every
// option on the surface is a decision the user has to make before they can find
// out whether the tool is useful.
//
// ── WHY THE GOAL IS THE ONE EXCEPTION ─────────────────────────────────────
// The goal row sits ABOVE the fold, beside the URL, and everything else stays
// hidden. It earns that place by being the only intake field that cannot be
// recovered later: the profile can be re-derived from the page at any time and
// the page type is inferred, but if nobody was asked what they were trying to
// achieve at the moment they ran the audit, that answer is gone for good — and
// the P2 brand, product, service and local work all key off it.
//
// It is also the cheapest question in the form. "I sell software" is instant;
// "which of SEO, AEO and GEO matters most to me?" is not a question a first-time
// visitor can answer at all, which is exactly why choosing a goal now chooses
// the profile for them.

import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { AUDIT_PROFILES, PROFILE_IDS } from "../../lib/discoverability/auditProfiles.js";
import { PAGE_TYPE_PACKS } from "../../lib/discoverability/auditProfiles.js";
import {
  PRIMARY_GOALS, PRIMARY_GOAL_IDS, MAX_COMPETITOR_URLS,
} from "../../lib/discoverability/intakeModel.js";

const PAGE_TYPE_OPTIONS = [
  { id: "", label: "Detect automatically" },
  ...Object.values(PAGE_TYPE_PACKS)
    .filter((p) => p.id !== "unknown")
    .map((p) => ({ id: p.id, label: p.label })),
];

const PROFILE_OPTIONS = [
  // "" is a real choice here, not a missing one: it means "work it out", and
  // it is the DEFAULT. Pre-selecting "Balanced" would make every audit claim a
  // deliberate choice of the neutral lens and stop the goal and the page from
  // ever settling it — the difference the stored `audit_profile_source` exists
  // to record.
  { id: "", label: "Choose for me" },
  ...PROFILE_IDS.map((id) => ({ id, label: AUDIT_PROFILES[id].label })),
];

export default function AuditComposer({
  onRun, running, defaultUrl = "", remaining, signedIn = true,
  defaultProfile = "", defaultDevice = "mobile", defaultPageType = "",
  defaultGoal = "", defaultGeography = null, defaultCompetitors = [],
  subjects = [], defaultSubjectId = "",
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [advanced, setAdvanced] = useState(false);
  const [goal, setGoal] = useState(defaultGoal);
  const [profile, setProfile] = useState(defaultProfile);
  const [device, setDevice] = useState(defaultDevice);
  const [pageType, setPageType] = useState(defaultPageType);
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [country, setCountry] = useState(defaultGeography?.country || "");
  const [region, setRegion] = useState(defaultGeography?.region || "");
  const [city, setCity] = useState(defaultGeography?.city || "");
  const [language, setLanguage] = useState(defaultGeography?.language || "");
  const [competitors, setCompetitors] = useState((defaultCompetitors || []).join("\n"));
  const [error, setError] = useState("");

  // What the audit will actually lead with, said out loud before the click.
  // A choice whose consequence is only visible in the result is a choice the
  // user cannot make deliberately.
  const chosenGoal = goal ? PRIMARY_GOALS[goal] : null;
  const effectiveProfile = profile
    ? AUDIT_PROFILES[profile]
    : chosenGoal ? AUDIT_PROFILES[chosenGoal.suggestedProfile] : null;

  function submit(e) {
    e?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) { setError("Paste the URL of the page you want to audit."); return; }
    // Accept a bare domain; a user typing example.com means https://example.com.
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try { new URL(withScheme); } catch { setError("That doesn't look like a web address."); return; }

    const competitorList = competitors
      .split(/[\n,]/).map((c) => c.trim()).filter(Boolean);
    if (competitorList.length > MAX_COMPETITOR_URLS) {
      // Refused here rather than truncated on the server, so nobody believes a
      // competitor is being recorded when it is not.
      setError(`Name at most ${MAX_COMPETITOR_URLS} competitors — you have listed ${competitorList.length}.`);
      return;
    }
    setError("");

    const geography = (country || region || city || language)
      ? { country: country.trim(), region: region.trim(), city: city.trim(), language: language.trim() }
      : null;

    onRun({
      target_url: withScheme,
      // Omitted rather than sent empty. An absent `audit_profile` is what tells
      // the server nobody chose one, which is what lets the goal and then the
      // page settle it.
      ...(profile ? { audit_profile: profile } : {}),
      ...(goal ? { primary_goal: goal } : {}),
      ...(subjectId ? { subject_id: subjectId } : {}),
      ...(geography ? { target_geography: geography } : {}),
      ...(competitorList.length ? { competitor_urls: competitorList } : {}),
      device_profile: device,
      page_type_hint: pageType || null,
      // A double-clicked Run button costs one audit, not two: the server
      // returns the original rather than spending a second credit. The goal is
      // part of the key because two audits of the same URL under different
      // goals are two different commissions, not a retry of one.
      idempotency_key: `${withScheme}|${profile}|${goal}|${device}|${subjectId}|${Math.floor(Date.now() / 30000)}`,
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

      <fieldset className="dsc-fieldset dsc-goal-row">
        <legend>What are you trying to achieve?</legend>
        <div className="dsc-chip-row">
          {PRIMARY_GOAL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`dsc-chip${goal === id ? " dsc-chip-on" : ""}`}
              onClick={() => setGoal((g) => (g === id ? "" : id))}
              aria-pressed={goal === id}
              title={PRIMARY_GOALS[id].description}
              disabled={running}
            >
              {PRIMARY_GOALS[id].label}
            </button>
          ))}
        </div>
        <p className="dsc-fieldset-hint">
          {chosenGoal
            ? `${chosenGoal.description} The report will lead with the ${AUDIT_PROFILES[chosenGoal.suggestedProfile].label} view — every score is still calculated the same way.`
            : "Optional, and it changes no score — it decides which view leads the report. Skip it and we read the page instead."}
        </p>
      </fieldset>

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
              {effectiveProfile && !profile && (
                <> Your goal has already chosen <strong>{effectiveProfile.label}</strong>; pick one here to override it.</>
              )}
            </p>
            <div className="dsc-chip-row">
              {PROFILE_OPTIONS.map((o) => (
                <button
                  key={o.id || "auto"}
                  type="button"
                  className={`dsc-chip${profile === o.id ? " dsc-chip-on" : ""}`}
                  onClick={() => setProfile(o.id)}
                  aria-pressed={profile === o.id}
                  title={o.id ? AUDIT_PROFILES[o.id].description : "Take the profile from your goal, or from what the page says it is."}
                  disabled={running}
                >
                  {o.label}
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

            {subjects && subjects.length > 0 && (
              <label className="dsc-field">
                <span>Associated subject</span>
                <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">Auto-mint or detect from page</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.canonical_domain || s.id} ({s.subject_kind || s.kind || "entity"})
                    </option>
                  ))}
                </select>
                <small>
                  Link this audit directly to an existing Brand, Product, Service or Page subject.
                </small>
              </label>
            )}
          </div>

          <fieldset className="dsc-fieldset">
            <legend>Where you want to be found</legend>
            <p className="dsc-fieldset-hint">
              Optional. Recorded with the audit and used to shape local and
              language-specific findings. Nothing here changes a score.
            </p>
            <div className="dsc-advanced-grid">
              <label className="dsc-field">
                <span>Country</span>
                <input type="text" value={country} onChange={(e) => setCountry(e.target.value)}
                  placeholder="IN, or India" autoComplete="country" />
              </label>
              <label className="dsc-field">
                <span>State or region</span>
                <input type="text" value={region} onChange={(e) => setRegion(e.target.value)}
                  placeholder="Karnataka" />
              </label>
              <label className="dsc-field">
                <span>City</span>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
                  placeholder="Bengaluru" />
              </label>
              <label className="dsc-field">
                <span>Language</span>
                <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)}
                  placeholder="en-IN" />
              </label>
            </div>
          </fieldset>

          <label className="dsc-field">
            <span>Competitors</span>
            <textarea
              className="dsc-textarea"
              rows={3}
              value={competitors}
              onChange={(e) => setCompetitors(e.target.value)}
              placeholder={"competitor.com/page\nanother.com/page"}
            />
            <small>
              One per line, up to {MAX_COMPETITOR_URLS}. Recorded with this audit
              as context — nothing is fetched and no credit is spent. Use a
              benchmark to actually audit them.
            </small>
          </label>
        </div>
      )}
    </form>
  );
}
