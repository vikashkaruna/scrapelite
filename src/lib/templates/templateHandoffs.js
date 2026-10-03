// templateHandoffs.js — templates that OPEN a module instead of running here.
//
// Moved out of Templates.jsx (2026-09-24) so the contract test can check both
// directions: every hand-off names a published template, and every template
// whose prompt_bundle is a module delegate has a hand-off. A published
// delegate with no hand-off would fall through to the page runner and run an
// extraction the template never described.
//
// A hand-off PREFILLS the module and starts nothing: no run row, no credits,
// no save. The module charges for its own work when the user presses its own
// button. `state(input)` builds the router state the module reads;
// `fromTemplate` lets the module link back to the hub.

const back = (key, title) => ({ fromTemplate: { key, title } });

export const HANDOFF = {
  discoverability_audit: {
    to: "/discoverability",
    module: "Discoverability",
    label: "Open in Discoverability",
    why: "This audit runs in the Discoverability module, which has the full four-pillar engine, history and re-audit comparison.",
    state: (input) => ({ auditUrl: input.domain ? `https://${input.domain}` : input.url }),
  },
  bulk_icp_enrichment: {
    to: "/lists",
    module: "Account lists",
    label: "Open in Bulk Account Lists",
    why: "Bulk enrichment runs in the Account Lists module, which provides deduplication, CSV/domain paste import, durable chunked execution, and ICP scoring.",
    state: (input) => ({ initialDomains: input.domains, icpProfile: input.icp_profile }),
  },
  competitor_change_monitor: {
    to: "/watchlists",
    module: "Watchlists",
    label: "Set up the watchlist",
    why: "Monitoring runs in Watchlists: it checks each page on your cadence and records every change with its evidence.",
    state: (input) => ({
      ...back("competitor_change_monitor", "Competitor Change Monitor"),
      newWatchlist: { name: "Competitor monitor", domains: input.domains || [], cadence: input.cadence || "daily" },
    }),
  },
  price_change_slack_alert: {
    to: "/rules",
    module: "Signal rules",
    label: "Set up the rule",
    why: "Alerts are signal rules: they fire on a watched field changing, not on every page edit.",
    state: (input) => ({
      ...back("price_change_slack_alert", "Price-change Alert to Slack"),
      newRule: {
        name: "Competitor price change → Slack",
        triggerSource: "watchlist",
        actionType: "slack",
        actionDest: input.channel || "#competitor-alerts",
        condition: { field: "category", op: "equals", value: "pricing" },
      },
    }),
  },
  account_research_outreach: {
    to: "/engagement",
    module: "Engagement",
    beta: true,
    label: "Create the campaign",
    why: "Outreach runs in Engagement (private beta): every draft is reviewed before it is sent, and consent is checked per channel at send time.",
    state: (input) => ({
      ...back("account_research_outreach", "Account Research → Outreach Campaign"),
      newCampaign: { name: input.campaign || "", description: "Outreach from account research" },
    }),
  },
  event_followup_campaign: {
    to: "/engagement",
    module: "Engagement",
    beta: true,
    label: "Create the campaign",
    why: "Follow-ups run in Engagement (private beta): import attendees, review each draft, then send.",
    state: (input) => ({
      ...back("event_followup_campaign", "Event / Webinar Follow-up"),
      newCampaign: { name: input.event ? `Follow-up: ${input.event}` : "Event follow-up", description: "Event / webinar follow-up" },
    }),
  },
  weekly_visibility_monitor: {
    to: "/schedules",
    module: "Schedules",
    label: "Set up the monitor",
    why: "Monitoring runs in Schedules: each weekly audit spends credits (19 per run) and adds a point to the trend.",
    state: (input) => ({
      ...back("weekly_visibility_monitor", "Weekly AI Visibility Monitor"),
      openEditor: true,
      draftSchedule: { jobKind: "discoverability", type: "track", target: input.url, cadenceKey: "weekly" },
    }),
  },
  local_directory_check: {
    to: "/discoverability/local",
    module: "Discoverability",
    label: "Open the local check",
    why: "The consistency check runs in Discoverability, against the directories you choose.",
    state: () => back("local_directory_check", "Local & Directory Consistency Check"),
  },
  business_truth_setup: {
    to: "/discoverability/truth",
    module: "Discoverability",
    label: "Open the truth record",
    why: "The truth record lives in Discoverability; audits of your domain are checked against it once it is approved.",
    state: () => back("business_truth_setup", "Business Truth Setup"),
  },
  icp_list_to_crm: {
    to: "/lists",
    module: "Account lists",
    label: "Open in Account lists",
    why: "Enrichment and ICP scoring run in Account lists; push the ranked list to your CRM from there.",
    state: (input) => ({ ...back("icp_list_to_crm", "ICP List → CRM"), initialDomains: input.domains }),
  },
};

export function handoffFor(templateKey) {
  return HANDOFF[templateKey] || null;
}
