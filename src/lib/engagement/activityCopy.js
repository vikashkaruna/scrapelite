// src/lib/engagement/activityCopy.js — one activity-log row, in words.
//
// PURE. The drawer used to read `log.action` and `log.created_at`, neither of
// which exists — the table's columns are `event_type` and `timestamp` — so
// every entry rendered as a blank title, "Invalid Date" and the raw `details`
// JSON (`{"note":"…"}`). The note had been saved all along.
//
// Every event type the server writes has an entry here; anything unknown still
// renders readably (its name de-snaked, no JSON).

import { STATUS_METADATA } from "./stateMachine.js";

const CHANNEL = { email: "Email", whatsapp: "WhatsApp", sms: "SMS", telegram: "Telegram" };
const REASON = {
  unsubscribe: "the contact unsubscribed", stop_keyword: "the contact replied STOP",
  bounce: "the address bounced", complaint: "the contact reported spam", manual: "your team",
};
const SKIP = {
  opted_out: "the contact has opted out", no_address: "no address on file", channel_not_enabled: "that channel isn't live",
  prospect_missing: "the prospect was deleted", campaign_missing: "the campaign was deleted",
};

const status = (s) => STATUS_METADATA[s]?.label || String(s || "").replace(/_/g, " ");
const channel = (c) => CHANNEL[c] || (c ? String(c) : "");
const skipReason = (code = "") => code.startsWith("suppressed_")
  ? REASON[code.slice("suppressed_".length)] || "the address is opted out"
  : SKIP[code] || code.replace(/_/g, " ");

/** @returns {{ icon: string, title: string, detail: string|null, at: string|null, tone: "neutral"|"good"|"bad"|"note" }} */
export function describeActivity(log = {}) {
  const d = log.details && typeof log.details === "object" ? log.details : {};
  const at = log.timestamp || log.created_at || null;
  const ch = channel(log.channel);
  const base = { at, detail: null, tone: "neutral" };

  switch (log.event_type) {
    case "note":
      return { ...base, icon: "file-text", title: "Note", detail: d.note || null, tone: "note" };
    case "message_approved":
      return { ...base, icon: "check", title: `${ch || "Message"} approved`, detail: d.edited ? "Edited by the reviewer" : null, tone: "good" };
    case "message_sent":
      return d.mock || d.provider === "mock"
        ? { ...base, icon: "flask", title: `${ch || "Message"} sent in test mode`, detail: "Simulated — nothing was delivered." }
        : { ...base, icon: "send", title: `${ch || "Message"} sent`, tone: "good" };
    case "message_skipped":
      return { ...base, icon: "slash", title: `${ch || "Message"} not sent`, detail: d.code ? `Because ${skipReason(d.code)}.` : null, tone: "bad" };
    case "message_failed":
      return { ...base, icon: "alert-triangle", title: `${ch || "Message"} failed`, detail: d.code ? d.code.replace(/_/g, " ") : null, tone: "bad" };
    case "channel_opted_out":
      return { ...base, icon: "slash", title: `Opted out of ${ch || "a channel"}`, detail: d.reason ? `By ${REASON[d.reason] || d.reason}${d.note ? ` — ${d.note}` : ""}.` : null, tone: "bad" };
    case "channel_opt_out_lifted":
      return { ...base, icon: "check-circle", title: `${ch || "Channel"} opt-out removed`, tone: "good" };
    case "details_edited": {
      const LABEL = { first_name: "first name", last_name: "last name", email: "email", phone: "phone", company: "company", role: "role", industry: "industry", country: "country" };
      const f = Array.isArray(d.fields) ? d.fields.map((k) => LABEL[k] || k) : [];
      return { ...base, icon: "pencil", title: "Details edited", detail: f.length ? `Changed: ${f.join(", ")}.` : null };
    }
    case "opted_out_all_channels":
      return { ...base, icon: "slash", title: "Opted out of every channel", tone: "bad" };
    default: {
      if (log.to_status) {
        const from = log.from_status && log.from_status !== log.to_status ? `${status(log.from_status)} → ` : "";
        const score = Number(d.score_delta) > 0 ? ` · +${d.score_delta} score` : "";
        const note = d.note ? ` — ${d.note}` : "";
        const title = String(log.event_type || "").startsWith("webhook_")
          ? `${ch || "Email"} ${String(log.event_type).slice("webhook_".length)}`
          : "Stage changed";
        return { ...base, icon: "arrow-right", title, detail: `${from}${status(log.to_status)}${score}${note}` };
      }
      const name = String(log.event_type || "Activity").replace(/_/g, " ");
      return { ...base, icon: "activity", title: name.charAt(0).toUpperCase() + name.slice(1) };
    }
  }
}

/** A timestamp for the timeline: relative when recent, a date otherwise, never "Invalid Date". */
export function activityTime(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

