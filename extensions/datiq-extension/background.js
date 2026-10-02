// extensions/datiq-extension/background.js
//
// DatIQ browser extension — service worker (MV3).
//
// Responsibilities:
//   • Register the right-click "Extract with DatIQ" context menu item.
//   • Handle the click: send a message to the content script to harvest
//     the page's URL + title, then open the DatIQ preview page with the
//     extraction pre-filled.
//   • Manage the OAuth flow: the user signs in to DatIQ once, the
//     resulting API key is stored in chrome.storage.local, and every
//     subsequent right-click is one click away from a saved extraction.
//
// All API calls go through the public DatIQ API (datiq.app/api/v1).
// See docs/DatIQ-Developer-API.md for the contract.

const DATIQ_BASE = "https://datiq.app";
const DATIQ_API_BASE = "https://datiq.app/api/v1";
const STORAGE_KEY = "datiq_api_key";

async function getApiKey() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || null;
}

async function setApiKey(key) {
  if (key) await chrome.storage.local.set({ [STORAGE_KEY]: key });
  else await chrome.storage.local.remove(STORAGE_KEY);
}

function openOrFocusPreview(url) {
  const target = `${DATIQ_BASE}/preview?url=${encodeURIComponent(url)}`;
  chrome.tabs.query({ url: `${DATIQ_BASE}/*` }, (tabs) => {
    if (tabs && tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { url: target, active: true });
    } else {
      chrome.tabs.create({ url: target });
    }
  });
}

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "datiq-extract-page",
      title: "Extract this page with DatIQ",
      contexts: ["page", "link", "selection"],
    });
    chrome.contextMenus.create({
      id: "datiq-extract-link",
      title: "Extract this link with DatIQ",
      contexts: ["link"],
    });
  });
}

chrome.runtime.onInstalled.addListener(createContextMenu);
chrome.runtime.onStartup.addListener(createContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let url;
  if (info.menuItemId === "datiq-extract-link" && info.linkUrl) {
    url = info.linkUrl;
  } else if (info.pageUrl) {
    url = info.pageUrl;
  } else if (tab && tab.url) {
    url = tab.url;
  }
  if (!url) return;

  // If the user has an API key, fire the extraction immediately and surface
  // a notification. Otherwise, open the DatIQ UI so they can sign in.
  const apiKey = await getApiKey();
  if (apiKey) {
    const result = await callExtract(url, apiKey);
    if (result.ok) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-48.png",
        title: "DatIQ: extraction saved",
        message: `Extracted ${result.title || url}. Open the DatIQ dashboard to view.`,
      });
    } else {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon-48.png",
        title: "DatIQ: extraction failed",
        message: result.error || "Unknown error. Try again from the DatIQ dashboard.",
      });
    }
  } else {
    openOrFocusPreview(url);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  // The popup is the primary entry; this is a fallback for users who
  // haven't installed the popup yet. Forward to the dashboard.
  if (tab && tab.url) {
    openOrFocusPreview(tab.url);
  }
});

// ── Message handler: popup + content scripts ──────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "get-api-key-status") {
        const key = await getApiKey();
        sendResponse({ ok: true, hasKey: !!key, keyHint: key ? key.slice(-4) : null });
        return;
      }
      if (msg?.type === "set-api-key") {
        if (typeof msg.key !== "string" || !msg.key.startsWith("dq_live_")) {
          sendResponse({ ok: false, error: "Key must start with dq_live_" });
          return;
        }
        await setApiKey(msg.key);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "clear-api-key") {
        await setApiKey(null);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "extract-current") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url) {
          sendResponse({ ok: false, error: "No active tab." });
          return;
        }
        const apiKey = await getApiKey();
        if (!apiKey) {
          sendResponse({ ok: false, error: "No API key. Set one in the popup first." });
          return;
        }
        const result = await callExtract(tab.url, apiKey);
        sendResponse(result);
        return;
      }
      sendResponse({ ok: false, error: `Unknown message: ${msg?.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || "background error" });
    }
  })();
  return true; // keep the channel open for async response
});

// ── Public REST API call (datiq.app/api/v1/extractions) ──────────────────
async function callExtract(url, apiKey) {
  try {
    const res = await fetch(`${DATIQ_API_BASE}/extractions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, intent: "summary" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id, title: data.title, url: data.url };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}
