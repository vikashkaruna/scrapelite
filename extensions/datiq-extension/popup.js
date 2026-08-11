// extensions/datiq-extension/popup.js
//
// Popup UI: shows the connect form when no API key is set; shows the
// extract button + result when one is. Talks to the background service
// worker via chrome.runtime.sendMessage — the worker holds the storage
// and makes the API call.

const connectView = document.getElementById("connect-view");
const connectedView = document.getElementById("connected-view");
const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const connectError = document.getElementById("connect-error");
const keyHint = document.getElementById("key-hint");
const extractBtn = document.getElementById("extract-btn");
const resultEl = document.getElementById("result");
const signoutBtn = document.getElementById("signout-btn");

function showView(name) {
  connectView.hidden = name !== "connect";
  connectedView.hidden = name !== "connected";
}

function showError(msg) {
  connectError.textContent = msg;
  connectError.hidden = false;
}
function clearError() {
  connectError.hidden = true;
  connectError.textContent = "";
}

function showResult(msg, isError = false) {
  resultEl.textContent = msg;
  resultEl.hidden = false;
  resultEl.style.color = isError ? "var(--error)" : "var(--success)";
  resultEl.style.background = isError
    ? "rgba(185, 28, 28, 0.08)"
    : "rgba(4, 120, 87, 0.08)";
}

async function init() {
  const status = await chrome.runtime.sendMessage({ type: "get-api-key-status" });
  if (status?.ok && status.hasKey) {
    keyHint.textContent = `dq_live_…${status.keyHint || "xxxx"}`;
    showView("connected");
  } else {
    showView("connect");
  }
}

saveKeyBtn.addEventListener("click", async () => {
  clearError();
  const key = apiKeyInput.value.trim();
  if (!key) return showError("API key is required.");
  if (!key.startsWith("dq_live_")) return showError('Key must start with "dq_live_".');
  saveKeyBtn.disabled = true;
  const r = await chrome.runtime.sendMessage({ type: "set-api-key", key });
  saveKeyBtn.disabled = false;
  if (!r?.ok) return showError(r?.error || "Failed to save key.");
  apiKeyInput.value = "";
  init();
});

extractBtn.addEventListener("click", async () => {
  extractBtn.disabled = true;
  extractBtn.textContent = "Extracting…";
  showResult("Extracting…");
  const r = await chrome.runtime.sendMessage({ type: "extract-current" });
  extractBtn.disabled = false;
  extractBtn.textContent = "Extract this page";
  if (r?.ok) {
    showResult(`✓ Saved: ${r.title || r.url}. Opening DatIQ…`);
    setTimeout(() => {
      chrome.tabs.create({ url: `https://datiq.app/dashboard?id=${encodeURIComponent(r.id)}` });
      window.close();
    }, 800);
  } else {
    showResult(r?.error || "Extraction failed.", true);
  }
});

signoutBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-api-key" });
  init();
});

init();
