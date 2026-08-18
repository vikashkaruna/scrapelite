// public/analytics.js — the ONE Google tag for the whole site.
//
// Loaded by a single synchronous <script src="/analytics.js"></script> placed
// immediately after <head> in index.html AND in every hand-written static page
// under public/. That is Google's "one tag per page, right after <head>"
// instruction, factored into one cached file instead of ~48 copies that would
// drift apart the first time the consent rules changed.
//
// ⚠️ It must stay SYNCHRONOUS (no defer/async on the tag that loads THIS file).
// The Consent Mode default has to be on the dataLayer BEFORE gtag.js executes,
// or Google treats the first hit as un-defaulted and may set cookies before the
// visitor has chosen. This file is ~4KB and same-origin, so the cost is one
// cached round trip.
//
// CSP: this file is same-origin ('self'); the googletagmanager.com origin it
// injects is allow-listed in netlify.toml's script-src. connect-src already
// wildcards https: for the measurement beacon.
//
// Nothing here is bundled by Vite — public/ is copied verbatim into dist/, the
// same mechanism as runtime-config.js.

(function () {
  "use strict";

  // ── Measurement ID ────────────────────────────────────────────────────────
  // Absent key  → fall back to the literal (runtime-config.js failed to load).
  // Present but "" → DELIBERATELY DISABLED. These two cases are not the same,
  // which is why this is not a plain `||`.
  var FALLBACK_ID = "G-B0DZLRWG63";
  var rt = window.__DATIQ_RUNTIME__ || {};
  var MEASUREMENT_ID = Object.prototype.hasOwnProperty.call(rt, "gaMeasurementId")
    ? String(rt.gaMeasurementId || "")
    : FALLBACK_ID;

  var CONSENT_KEY = "datiq.consent";

  // ── Skip conditions ───────────────────────────────────────────────────────
  // /admin is the operator console. Sending it to GA would both pollute the
  // property with internal traffic and leak internal path names into a
  // third-party report. Same reasoning as the noindex rules in netlify.toml.
  var host = (location.hostname || "").toLowerCase();
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  var isAdmin = (location.pathname || "").indexOf("/admin") === 0;
  // Escape hatch for verifying the consent flow against a dev server, where the
  // localhost skip would otherwise mean gtag.js never loads and there is nothing
  // to observe. Off unless explicitly set in runtime-config.js; it can never
  // re-enable /admin or an empty measurement ID.
  var localOverride = isLocal && rt.gaDebugLocal === true;
  var disabled = !MEASUREMENT_ID || isAdmin || (isLocal && !localOverride);

  // Is this the React shell? Readable in <head>, before <body> exists — which
  // is why this is an <html> attribute and not a #root lookup. Prerendered
  // pages inherit it from index.html and DO boot React, so they count as SPA;
  // hand-written static pages never carry it.
  var isSpa = document.documentElement.hasAttribute("data-datiq-app");

  // ── dataLayer / gtag shim ─────────────────────────────────────────────────
  // Defined even when disabled, so callers (consentService, usePageView) never
  // have to null-check and a disabled build stays a silent no-op.
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  function readStored() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || (parsed.analytics !== "granted" && parsed.analytics !== "denied")) return null;
      return parsed;
    } catch (e) { return null; }
  }

  var stored = readStored();

  // ── Consent Mode v2 ───────────────────────────────────────────────────────
  // Everything that can identify a visitor defaults to DENIED. In that state
  // Google still receives cookieless, non-identifying pings, so aggregate
  // traffic is modelled without storing anything on the device — which is what
  // makes a default-denied posture workable under GDPR and the DPDP Act.
  // functionality/security storage stay granted: they are not tracking.
  if (!disabled) {
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
      wait_for_update: 500,
    });

    if (stored && stored.analytics === "granted") {
      gtag("consent", "update", { analytics_storage: "granted" });
    }

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    (document.head || document.documentElement).appendChild(s);

    gtag("js", new Date());
    gtag("config", MEASUREMENT_ID, {
      anonymize_ip: true,
      // On a static page this is the only page_view that will ever fire.
      // In the SPA, usePageView.js fires it manually AFTER useSeo has set
      // document.title — otherwise every hit records the previous page's title.
      send_page_view: !isSpa,
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // src/lib/consentService.js talks to this, so React never touches gtag and
  // its unit tests never need a gtag stub.
  window.__datiqConsent = {
    measurementId: MEASUREMENT_ID,
    enabled: !disabled,
    get: function () { return readStored(); },
    set: function (choice) {
      if (choice !== "granted" && choice !== "denied") return;
      if (disabled) return;
      gtag("consent", "update", {
        analytics_storage: choice === "granted" ? "granted" : "denied",
      });
    },
    // The GA4 User Deletion API keys on client_id, so we capture it at consent
    // time. Without it a later "erase my analytics data" request has no handle
    // on the Google side. Callback-based because that is gtag's own signature.
    clientId: function (cb) {
      if (disabled || typeof cb !== "function") { return void (cb && cb(null)); }
      try { gtag("get", MEASUREMENT_ID, "client_id", cb); }
      catch (e) { cb(null); }
    },
  };

  // ── Consent bar for pages with no React ───────────────────────────────────
  // The static-owned pages (/faq, /dmca, /vs/* detail pages, /help/*) have no
  // React, so ConsentBanner.jsx can never mount there. Without this they would
  // silently run the default-denied state forever and never ask.
  if (disabled || isSpa || stored) return;

  function renderBar() {
    if (document.getElementById("datiq-consent-bar")) return;

    var bar = document.createElement("div");
    bar.id = "datiq-consent-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Cookie and analytics consent");
    bar.style.cssText = [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:9999",
      "display:flex", "flex-wrap:wrap", "gap:12px",
      "align-items:center", "justify-content:center",
      "padding:14px 20px",
      "background:var(--surface,#fff)",
      "color:var(--text,#111827)",
      "border-top:1px solid var(--border,#e5e7eb)",
      "box-shadow:0 -2px 12px rgba(0,0,0,.08)",
      "font:14px/1.5 system-ui,-apple-system,sans-serif",
    ].join(";");

    var text = document.createElement("span");
    text.style.cssText = "max-width:640px";
    text.innerHTML =
      "We use Google Analytics to understand how DatIQ is used. Nothing is stored " +
      'on your device until you allow it. <a href="/privacy" style="color:var(--accent,#6366f1)">Privacy Policy</a>.';

    function button(label, primary) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = [
        "cursor:pointer", "padding:8px 18px", "border-radius:8px",
        "font-weight:600", "font-size:14px",
        primary
          ? "background:var(--accent,#6366f1);color:#fff;border:1px solid var(--accent,#6366f1)"
          : "background:transparent;color:var(--text,#111827);border:1px solid var(--border,#d1d5db)",
      ].join(";");
      return b;
    }

    var allow = button("Allow analytics", true);
    var deny = button("Decline analytics", false);

    function choose(choice) {
      try {
        localStorage.setItem(CONSENT_KEY, JSON.stringify({
          analytics: choice,
          ts: new Date().toISOString(),
          policyVersion: (rt.consentPolicyVersion || "2026-08-15"),
          version: 1,
        }));
      } catch (e) { /* private mode — the gtag update below still applies */ }

      window.__datiqConsent.set(choice);

      // Mirror to the server for the audit trail. Fire-and-forget: a failed
      // beacon must never block the visitor or leave the bar stuck on screen.
      try {
        window.__datiqConsent.clientId(function (cid) {
          try {
            fetch("/api/consent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                analytics: choice,
                source: "banner",
                gaClientId: cid || null,
              }),
              keepalive: true,
            }).catch(function () {});
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }

      bar.remove();
    }

    allow.addEventListener("click", function () { choose("granted"); });
    deny.addEventListener("click", function () { choose("denied"); });

    bar.appendChild(text);
    bar.appendChild(allow);
    bar.appendChild(deny);
    document.body.appendChild(bar);

    // Fades out on its own if the visitor takes no action — engage, don't
    // distract. This is purely visual: it must never call choose(), or an
    // ignored prompt would silently become "denied" forever. bar.remove() is
    // a no-op if choose() already removed it, so no extra guarding needed.
    // Matches src/components/ConsentBanner.jsx's AUTO_HIDE_MS for the SPA.
    setTimeout(function () { bar.remove(); }, 20000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBar);
  } else {
    renderBar();
  }
})();
