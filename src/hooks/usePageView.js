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
// ── Why consent is not checked here ───────────────────────────────────────
// It is enforced one level down, by Consent Mode: with analytics_storage denied
// gtag sends a cookieless, non-identifying ping and stores nothing. Gating the
// call here as well would throw away the modelled aggregate traffic that
// default-denied Consent Mode is specifically designed to preserve.

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

  useEffect(() => {
    const path = `${location.pathname}${location.search || ""}`;
    if (path === lastPath.current) return;
    lastPath.current = path;

    if (isPrivatePath(location.pathname)) return;

    // One frame's delay so the route's useSeo has written document.title.
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(send)
        : setTimeout(send, 0);

    function send() {
      const title = typeof document !== "undefined" ? document.title : "";
      const href = typeof window !== "undefined" ? window.location.href : path;

      try {
        window.gtag?.("event", "page_view", {
          page_path: path,
          page_title: title,
          page_location: href,
        });
      } catch {
        /* analytics.js absent or blocked — never break navigation over a metric */
      }

      try {
        void lifecycle.pageView({ path, title });
      } catch {
        /* analyticsService already swallows its own errors; belt and braces */
      }
    }

    return () => {
      if (typeof cancelAnimationFrame === "function" && typeof raf === "number") {
        cancelAnimationFrame(raf);
      } else {
        clearTimeout(raf);
      }
    };
  }, [location.pathname, location.search]);
}

export default usePageView;
