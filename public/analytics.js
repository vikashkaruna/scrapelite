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

  // ── PostHog ───────────────────────────────────────────────────────────────
  // Same absent-vs-empty rule as the GA id above: an ABSENT key falls back to
  // the literal, an EMPTY string is a deliberate disable. PostHog lives here
  // rather than as its own <script> in index.html for the reason stated at the
  // top of this file — a second copy of the consent rules drifts from the first
  // one the moment either changes, and a snippet pasted into <head> runs before
  // the visitor has chosen anything.
  var PH_FALLBACK_KEY = "phc_nGVqCMMbixTafmtb46bLZZakeEV2cpmEMQYf8uLVymUs";
  var PH_KEY = Object.prototype.hasOwnProperty.call(rt, "posthogKey")
    ? String(rt.posthogKey || "")
    : PH_FALLBACK_KEY;
  var PH_HOST = String(rt.posthogHost || "https://us.i.posthog.com");

  var CONSENT_KEY = "datiq.consent";

  // ── Skip conditions ───────────────────────────────────────────────────────
  // /admin is the operator console. Sending it to GA would both pollute the
  // property with internal traffic and leak internal path names into a
  // third-party report. Same reasoning as the noindex rules in netlify.toml.
  var host = (location.hostname || "").toLowerCase();
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  function isAdminPath(pathname) {
    var p = typeof pathname === "string" ? pathname : (location.pathname || "");
    return p === "/admin" || p.indexOf("/admin/") === 0;
  }
  var isAdmin = isAdminPath(location.pathname);
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
  var origDataLayerPush = window.dataLayer.push ? window.dataLayer.push.bind(window.dataLayer) : null;
  function isSuppressedCall(args) {
    if (isAdminPath(location.pathname)) return true;
    for (var i = 0; i < args.length; i++) {
      var arg = args[i];
      if (typeof arg === "string") {
        var s = arg.toLowerCase();
        if (s.indexOf("/admin") !== -1 || s.indexOf("admin_") === 0 || s === "admin" || s.indexOf("_admin") !== -1) return true;
      }
      if (arg && typeof arg === "object") {
        if (typeof arg.page_location === "string" && arg.page_location.indexOf("/admin") !== -1) return true;
        if (typeof arg.page_path === "string" && arg.page_path.indexOf("/admin") !== -1) return true;
      }
    }
    return false;
  }
  function gtag() {
    if (isSuppressedCall(arguments)) return;
    window.dataLayer.push(arguments);
  }
  window.gtag = window.gtag || gtag;
  if (origDataLayerPush) {
    window.dataLayer.push = function() {
      if (isSuppressedCall(arguments)) return window.dataLayer.length;
      return origDataLayerPush.apply(window.dataLayer, arguments);
    };
  }

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

  // ── Consent Mode v2 + strict loader ───────────────────────────────────────
  // Consent Mode can legally send cookieless pings while storage is denied,
  // but that is surprising when a visitor explicitly declines analytics. The
  // loader therefore stays completely inactive until consent is granted. This
  // still applies Consent Mode defaults before gtag.js is injected for the
  // granted path, and means a decline produces no Google request or cookie.
  var tagLoaded = false;
  var consentDefaultSet = false;

  function setConsentDefault() {
    if (disabled || consentDefaultSet) return;
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
      wait_for_update: 500,
    });
    consentDefaultSet = true;
  }

  function loadTag() {
    if (disabled || tagLoaded || readStored()?.analytics !== "granted") return false;
    setConsentDefault();
    gtag("consent", "update", { analytics_storage: "granted" });

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
    tagLoaded = true;
    return true;
  }

  // ── PostHog loader ────────────────────────────────────────────────────────
  // 🔴 GATED ON THE SAME STORED CHOICE AS gtag.js, AND FOR THE SAME REASON.
  // PostHog's own snippet initialises on execution: it sets a distinct_id in
  // storage and begins capturing immediately, so pasting it into <head> tracks
  // every visitor before the banner is even rendered — including the ones who
  // then click Decline. That contradicts the consent banner and the DPDP
  // section of /privacy. Calling the stub IS the load (it injects array.js),
  // so the gate is simply: do not call it until analytics consent is granted.
  //
  // `disabled` is reused deliberately, which carries the /admin and localhost
  // skips across unchanged: the operator console must not leak internal path
  // names into a third-party product-analytics property either.
  var phLoaded = false;

  function loadPostHog() {
    if (disabled || !PH_KEY || phLoaded) return false;
    if (readStored()?.analytics !== "granted") return false;
    try {
      !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}p||((p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.onerror=function(){p=null},(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r));var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="vu fu pu gu bu init Hu zu qu ju Gu Xa Bu Qu Du eh ih nh sh rh oh capture getExtension Uu cu hh calculateEventProperties uh register register_once register_for_session unregister unregister_for_session gh Nu dh getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync mh identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset yh shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty fh Xu createPersonProfile setInternalOrTestUser ph wu opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Ju debug Ya Os getPageViewId captureTraceFeedback captureTraceMetric Ru".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
      window.posthog.init(PH_KEY, {
        api_host: PH_HOST,
        defaults: "2026-05-30",
        person_profiles: "identified_only",
      });
      if (window.posthog && typeof window.posthog.capture === "function") {
        var origPhCapture = window.posthog.capture.bind(window.posthog);
        window.posthog.capture = function(eventName, properties, options) {
          if (isAdminPath(location.pathname)) return;
          if (properties && typeof properties === "object") {
            if (typeof properties.$current_url === "string" && properties.$current_url.indexOf("/admin") !== -1) return;
            if (typeof properties.path === "string" && properties.path.indexOf("/admin") !== -1) return;
          }
          return origPhCapture(eventName, properties, options);
        };
      }
      phLoaded = true;
      return true;
    } catch (e) { return false; }
  }

  // Best-effort teardown on withdrawal, mirroring the _ga cookie sweep below.
  // opt_out_capturing() stops further capture AND is what PostHog itself reads
  // on the next page load; reset() drops the distinct_id so the visitor is no
  // longer identifiable browser-side. Neither can reach data already sent —
  // that is a PostHog-account-side deletion, not something a page can do.
  function stopPostHog() {
    try {
      if (window.posthog && typeof window.posthog.opt_out_capturing === "function") {
        window.posthog.opt_out_capturing();
        if (typeof window.posthog.reset === "function") window.posthog.reset();
      }
    } catch (e) { /* ignore */ }
    try {
      document.cookie.split(";").forEach(function (part) {
        var name = part.split("=")[0].trim();
        if (name.indexOf("ph_") === 0) {
          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
        }
      });
    } catch (e) { /* ignore */ }
  }

  // Suppress all background / third-party trackers when entering /admin
  function suppressAdminTrackers() {
    try {
      if (window.posthog) {
        if (typeof window.posthog.stopSessionRecording === "function") {
          window.posthog.stopSessionRecording();
        }
        if (typeof window.posthog.opt_out_capturing === "function") {
          window.posthog.opt_out_capturing();
        }
      }
    } catch (e) {}
  }

  // Resume allowed tracking when navigating away from /admin back to a public page
  function resumeTrackers() {
    try {
      if (isAdminPath(location.pathname)) return;
      if (readStored()?.analytics === "granted" && window.posthog) {
        if (typeof window.posthog.opt_in_capturing === "function") {
          window.posthog.opt_in_capturing();
        }
        if (typeof window.posthog.startSessionRecording === "function") {
          window.posthog.startSessionRecording();
        }
      }
    } catch (e) {}
  }

  window.__datiqSuppressAdminTrackers = suppressAdminTrackers;
  window.__datiqResumeTrackers = resumeTrackers;

  // A previously granted choice can activate immediately. No choice and a
  // stored denial deliberately leave gtag.js AND PostHog unloaded.
  loadTag();
  loadPostHog();

  // ── Public API ────────────────────────────────────────────────────────────
  // src/lib/consentService.js talks to this, so React never touches gtag and
  // its unit tests never need a gtag stub.
  window.__datiqConsent = {
    measurementId: MEASUREMENT_ID,
    enabled: !disabled,
    active: function () { return tagLoaded && !isAdminPath(location.pathname); },
    posthogActive: function () { return phLoaded && !isAdminPath(location.pathname); },
    suppressAdminTrackers: suppressAdminTrackers,
    resumeTrackers: resumeTrackers,
    get: function () { return readStored(); },
    set: function (choice) {
      if (choice !== "granted" && choice !== "denied") return;
      if (disabled) return;
      if (choice === "granted") {
        loadTag();
        loadPostHog();
      }
      gtag("consent", "update", {
        analytics_storage: choice === "granted" ? "granted" : "denied",
      });
      if (choice === "denied") {
        stopPostHog();
        // GA cookies are first-party and can be removed by the page. This is
        // best-effort; it cannot remove HttpOnly cookies or data already held
        // by Google, but it prevents continued browser-side identification.
        document.cookie.split(";").forEach(function (part) {
          var name = part.split("=")[0].trim();
          if (/^_ga(?:_|$)/.test(name)) {
            document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
          }
        });
      }
      window.dispatchEvent(new CustomEvent(
        choice === "granted" ? "datiq:analytics-enabled" : "datiq:analytics-disabled",
      ));
    },
    // The GA4 User Deletion API keys on client_id, so we capture it at consent
    // time. Without it a later "erase my analytics data" request has no handle
    // on the Google side. Callback-based because that is gtag's own signature.
    clientId: function (cb) {
      if (disabled || !tagLoaded || typeof cb !== "function") { return void (cb && cb(null)); }
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
