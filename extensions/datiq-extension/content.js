// extensions/datiq-extension/content.js
//
// Content script — runs on every page. Currently a no-op stub; left in
// place so the manifest's content_scripts declaration works (we need
// "matches": ["<all_urls>"] in case we add page-aware features later,
// e.g. inline highlight of a DatIQ-saved extraction).
//
// The right-click "extract" path doesn't actually need a content script
// — the background service worker uses chrome.tabs to get the active
// tab's URL, and the public API does the actual extraction. We keep this
// file for future expansion; if you remove it, also update
// manifest.json's content_scripts block.

(function () {
  // No-op for now. Reserved for future page-aware features.
  // Safe to no-op: we don't listen for any messages, we don't inject
  // anything into the page, and we don't touch the DOM.
  if (typeof window !== "undefined") {
    // Marker so tests can confirm the content script ran.
    window.__datiqContentScriptLoaded = true;
  }
})();
