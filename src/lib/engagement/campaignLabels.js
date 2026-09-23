// src/lib/engagement/campaignLabels.js — how a campaign is named on screen.
//
// PURE. The campaign selector is the only thing between a person and sending to
// the wrong list, so an option must identify ONE campaign. New names are unique
// per account (the server refuses duplicates), but accounts created before that
// rule can still hold two "Q4 outreach" campaigns — those get the creation date,
// and a short id if even that is shared.

import { fmtDate } from "../utils.js";

export const campaignNameKey = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

/** The existing campaign `name` would collide with, or null. Mirrors the server's rule. */
export function findNameClash(name, campaigns = [], exceptId = null) {
  const key = campaignNameKey(name);
  if (!key) return null;
  return campaigns.find((c) => c.id !== exceptId && campaignNameKey(c.name) === key) || null;
}

export function campaignOptionLabel(campaign, campaigns = []) {
  if (!campaign) return "";
  const key = campaignNameKey(campaign.name);
  const twins = campaigns.filter((c) => campaignNameKey(c.name) === key);
  let label = campaign.name || "Untitled campaign";
  if (twins.length > 1) {
    const created = campaign.created_at ? fmtDate(campaign.created_at) : null;
    const sameDay = created && twins.filter((c) => c.created_at && fmtDate(c.created_at) === created).length > 1;
    if (created) label += ` · created ${created}`;
    if (!created || sameDay) label += ` · #${String(campaign.id || "").slice(0, 6)}`;
  }
  if (campaign.status && campaign.status !== "active") label += ` (${campaign.status})`;
  return label;
}
