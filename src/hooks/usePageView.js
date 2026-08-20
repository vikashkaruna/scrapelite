// src/hooks/usePageView.js — SPA page-view tracking.
//
// Called once from Shell. Fires on every route change, to BOTH sinks:
//   * Google Analytics 4, via gtag
//   * the in-house Supabase event log, via analyticsService.lifecycle.pageView
//     — which existed but had no caller at all until this hook, leaving the
//     custom funnel with no top-of-funnel stage.
//
// ── Why the page_view is manual ───────────────────────────────────────────
// public/analytics.js configures gtag with `send_page_view: false` on the SPA.
// The obvious alternative — GA4's Enhanced Measurement "Page changes based on
// browser history events" — fires on the History API call itself, which in
// React Router happens BEFORE the new route renders and before useSeo has set
// document.title. Every hit would carry the PREVIOUS page's title. Firing here,
// after a frame, gets the right one.
//
// ⚠️ Consequence: "Page changes based on browser history events" must be OFF in
// the GA4 data stream. With both enabled every SPA navigation is counted twice.
//
// ── Consent boundary ───────────────────────────────────────────────────────
// The public analytics bridge strictly gates Google Analytics until consent is
// granted. This hook still records DatIQ's first-party page_view independently,
// but defers the Google page_view and replays it once the visitor opts in.

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { lifecycle } from "../lib/analyticsService.js";

/** Never send the operator console's paths to a third-party analytics product. */
function isPrivatePath(pathname) {
  return typeof pathname === "string" && pathname.indexOf("/admin") === 0;
}

export function usePageView() {
  const location = useLocation();
  // The path we last reported. Guards against double-firing when a component
  // re-renders without the location actually changing (provider state churn,
  // StrictMode's double-invoke in development).
  const lastPath = useRef(null);
  const lastGooglePath = useRef(null);

  useEffect(() => {
    const path = `${location.pathname}${location.search || ""}`;
    if (path === lastPath.current) return;

    // ⚠️ lastPath is marked inside send(), NOT here.
    //
    // Marking it at SCHEDULE time loses the event entirely under React
    // StrictMode, which double-invokes effects as mount → cleanup → mount:
    // the first pass marks the path and queues the frame, the cleanup cancels
    // that frame, and the remount then sees path === lastPath and returns
    // early. Net result: no page_view is ever sent. Production has no
    // StrictMode so this "worked", but any effect re-run inside a single frame
    // reproduces it.
    //
    // Recording the send when it actually happens makes a cancelled schedule
    // harmless — the next run simply schedules again.

    if (isPrivatePath(location.pathname)) return;

    // A macrotask, NOT requestAnimationFrame.
    //
    // rAF is throttled to zero in any backgrounded tab, so a page opened via
    // middle-click or "open in new tab" would never record a view until the
    // user focused it. Verified: in a headless browser the callback never runs
    // at all, and no page_view was ever sent.
    //
    // The delay is only there so document.title is settled. React flushes CHILD
    // effects before parent ones — the route's useSeo runs before Shell's
    // usePageView — so the title is already correct by now; this tick is
    // belt-and-braces for a route that sets its title asynchronously.
    const timer = setTimeout(send, 0);

    // A visitor may grant consent after the initial route has rendered. The
    // internal DatIQ event is already recorded, but the first Google pageview
    // must wait until the tag is active and then be sent exactly once.
    window.addEventListener("datiq:analytics-enabled", sendGoogle);

    function send() {
      // Claim it here, at the moment the event goes out — see the note above.
      // Also guards the double-fire case: if two frames somehow both run, the
      // second sees the path already claimed.
      if (path === lastPath.current) return;
      lastPath.current = path;

      const title = typeof document !== "undefined" ? document.title : "";
      const href = typeof window !== "undefined" ? window.location.href : path;

      sendGoogle({ title, href });

      try {
        void lifecycle.pageView({ path, title });
      } catch {
        /* analyticsService already swallows its own errors; belt and braces */
      }
    }

    function sendGoogle(details = {}) {
      const consent = window.__datiqConsent;
      // In production the bridge is present and strict-gates the tag. The
      // fallback keeps this hook harmless in tests/builds without analytics.js.
      if (consent && consent.active && !consent.active()) return;
      if (path === lastGooglePath.current) return;
      lastGooglePath.current = path;
      const googleTitle = details.title || (typeof document !== "undefined" ? document.title : "");
      const googleHref = details.href || (typeof window !== "undefined" ? window.location.href : path);
      try {
        window.gtag?.("event", "page_view", {
          page_path: path,
          page_title: googleTitle,
          page_location: googleHref,
        });
      } catch {
        /* analytics.js absent or blocked — never break navigation over a metric */
      }
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener("datiq:analytics-enabled", sendGoogle);
    };
  }, [location.pathname, location.search]);
}

export default usePageView;
