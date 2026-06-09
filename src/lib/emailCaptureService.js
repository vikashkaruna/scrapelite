// emailCaptureService.js — save subscriber emails to localStorage and forward
// to the n8n webhook (VITE_WEBHOOK_URL) as a fire-and-forget side-effect.
import { WEBHOOK_URL } from "./config.js";

const LS_KEY = "datiq.subscribers";

export function getSubscribers() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

export async function captureEmail(email, source = "newsletter") {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return { ok: false, error: "Invalid email" };
  }

  const entry = { email: normalized, source, ts: Date.now() };
  let alreadySubscribed = false;

  // Persist to localStorage first
  try {
    const existing = getSubscribers();
    if (existing.find((s) => s.email === normalized)) {
      alreadySubscribed = true;
    } else {
      existing.push(entry);
      localStorage.setItem(LS_KEY, JSON.stringify(existing));
    }
  } catch { /* private browsing — continue to webhook */ }

  // Forward to n8n webhook (fire-and-forget)
  if (WEBHOOK_URL && !alreadySubscribed) {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "email_capture", ...entry }),
      });
    } catch { /* network error — ignore */ }
  }

  return { ok: true, alreadySubscribed };
}
