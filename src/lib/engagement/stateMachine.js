// src/lib/engagement/stateMachine.js — Prospect Engagement State Machine
//
// Implements the deterministic state machine specified in DatIQ - Prospect Engagement Engine.md:
//   New ➔ Queued ➔ Sent ➔ Delivered ➔ Opened/Read ➔ Clicked ➔ Replied ➔ Follow-up Due ➔ Converted
//   Terminal / special states: Converted, Unresponsive, Opted-out
//
// Invariants:
// 1. All transitions are validated against the TRANSITION_GRAPH. Invalid backward jumps are rejected.
// 2. Opted-out is a compliance boundary: once opted out, automated sequences CANNOT contact.
// 3. Every valid transition emits an activity log payload and computes an engagement score.
// 4. Stale states (e.g. Delivered/Opened with no reply after N days) transition to Follow-up Due.

export const PROSPECT_STATUSES = {
  NEW: "new",
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  OPENED: "opened",
  CLICKED: "clicked",
  REPLIED: "replied",
  FOLLOWUP_DUE: "followup_due",
  CONVERTED: "converted",
  UNRESPONSIVE: "unresponsive",
  OPTED_OUT: "opted_out",
};

export const STATUS_METADATA = {
  [PROSPECT_STATUSES.NEW]: { label: "New", color: "var(--text-muted)", icon: "inbox" },
  [PROSPECT_STATUSES.QUEUED]: { label: "Queued", color: "var(--accent)", icon: "clock" },
  [PROSPECT_STATUSES.SENT]: { label: "Sent", color: "var(--info, #3b82f6)", icon: "send" },
  [PROSPECT_STATUSES.DELIVERED]: { label: "Delivered", color: "var(--info, #3b82f6)", icon: "check" },
  [PROSPECT_STATUSES.OPENED]: { label: "Opened", color: "var(--warning, #f59e0b)", icon: "eye" },
  [PROSPECT_STATUSES.CLICKED]: { label: "Clicked", color: "var(--warning, #f59e0b)", icon: "external-link" },
  [PROSPECT_STATUSES.REPLIED]: { label: "Replied", color: "var(--success, #10b981)", icon: "message-circle" },
  [PROSPECT_STATUSES.FOLLOWUP_DUE]: { label: "Follow-up Due", color: "var(--accent-warm, #ec4899)", icon: "phone-call" },
  [PROSPECT_STATUSES.CONVERTED]: { label: "Converted", color: "var(--success, #10b981)", icon: "thumbs-up" },
  [PROSPECT_STATUSES.UNRESPONSIVE]: { label: "Unresponsive", color: "var(--text-muted)", icon: "thumbs-down" },
  [PROSPECT_STATUSES.OPTED_OUT]: { label: "Opted Out", color: "var(--danger, #ef4444)", icon: "alert-circle" },
};

// Transition validation graph
export const TRANSITION_GRAPH = {
  [PROSPECT_STATUSES.NEW]: [
    PROSPECT_STATUSES.QUEUED,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.QUEUED]: [
    PROSPECT_STATUSES.SENT,
    PROSPECT_STATUSES.NEW,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.SENT]: [
    PROSPECT_STATUSES.DELIVERED,
    PROSPECT_STATUSES.OPENED, // some channels jump straight to opened if delivery webhook is delayed
    PROSPECT_STATUSES.CLICKED,
    PROSPECT_STATUSES.REPLIED,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.DELIVERED]: [
    PROSPECT_STATUSES.OPENED,
    PROSPECT_STATUSES.CLICKED,
    PROSPECT_STATUSES.REPLIED,
    PROSPECT_STATUSES.FOLLOWUP_DUE,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.OPENED]: [
    PROSPECT_STATUSES.CLICKED,
    PROSPECT_STATUSES.REPLIED,
    PROSPECT_STATUSES.FOLLOWUP_DUE,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.CLICKED]: [
    PROSPECT_STATUSES.REPLIED,
    PROSPECT_STATUSES.CONVERTED,
    PROSPECT_STATUSES.FOLLOWUP_DUE,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.REPLIED]: [
    PROSPECT_STATUSES.CONVERTED,
    PROSPECT_STATUSES.FOLLOWUP_DUE,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.FOLLOWUP_DUE]: [
    PROSPECT_STATUSES.QUEUED,
    PROSPECT_STATUSES.SENT,
    PROSPECT_STATUSES.REPLIED,
    PROSPECT_STATUSES.CONVERTED,
    PROSPECT_STATUSES.UNRESPONSIVE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.CONVERTED]: [
    PROSPECT_STATUSES.FOLLOWUP_DUE,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.UNRESPONSIVE]: [
    PROSPECT_STATUSES.QUEUED,
    PROSPECT_STATUSES.NEW,
    PROSPECT_STATUSES.OPTED_OUT,
  ],
  [PROSPECT_STATUSES.OPTED_OUT]: [], // Terminal compliance boundary: no automatic reactivation
};

// Point weights for engagement score
export const SCORE_DELTAS = {
  [PROSPECT_STATUSES.NEW]: 0,
  [PROSPECT_STATUSES.QUEUED]: 0,
  [PROSPECT_STATUSES.SENT]: 2,
  [PROSPECT_STATUSES.DELIVERED]: 5,
  [PROSPECT_STATUSES.OPENED]: 15,
  [PROSPECT_STATUSES.CLICKED]: 30,
  [PROSPECT_STATUSES.REPLIED]: 50,
  [PROSPECT_STATUSES.FOLLOWUP_DUE]: 0,
  [PROSPECT_STATUSES.CONVERTED]: 100,
  [PROSPECT_STATUSES.UNRESPONSIVE]: -10,
  [PROSPECT_STATUSES.OPTED_OUT]: -50,
};

/**
 * Validates whether a state transition from `fromStatus` to `toStatus` is permissible.
 *
 * @param {string} fromStatus Current status of the prospect
 * @param {string} toStatus Desired target status
 * @returns {boolean}
 */
export function isValidTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  if (fromStatus === toStatus) return true; // idempotent self-transition
  const allowed = TRANSITION_GRAPH[fromStatus];
  if (!allowed) return false;
  return allowed.includes(toStatus);
}

/**
 * Calculates updated engagement score for a prospect transition.
 *
 * @param {number} currentScore Existing engagement score
 * @param {string} toStatus Target status
 * @returns {number} Non-negative integer score
 */
export function calculateEngagementScore(currentScore = 0, toStatus) {
  const delta = SCORE_DELTAS[toStatus] || 0;
  return Math.max(0, currentScore + delta);
}

/**
 * Applies a transition to a prospect object, validating rules, updating scores,
 * setting timestamps, and returning the updated prospect + activity log entry.
 *
 * @param {object} prospect
 * @param {string} toStatus
 * @param {object} meta Optional metadata (channel, eventType, details, messageId)
 * @returns {{ ok: boolean, error?: string, prospect?: object, activity?: object }}
 */
export function transitionProspect(prospect, toStatus, meta = {}) {
  if (!prospect || typeof prospect !== "object") {
    return { ok: false, error: "invalid_prospect_record" };
  }

  const fromStatus = prospect.status || PROSPECT_STATUSES.NEW;

  // Enforce opt-out compliance: if prospect is already opted_out and not explicit admin override
  if (fromStatus === PROSPECT_STATUSES.OPTED_OUT && !meta.adminOverride) {
    return {
      ok: false,
      error: "compliance_violation_opted_out",
      reason: "Prospect has opted out. Automated sequences cannot modify status without explicit manual re-consent.",
    };
  }

  if (!isValidTransition(fromStatus, toStatus) && !meta.adminOverride) {
    return {
      ok: false,
      error: "illegal_state_transition",
      reason: `Cannot transition prospect from "${fromStatus}" to "${toStatus}".`,
    };
  }

  const now = new Date().toISOString();
  const newScore = calculateEngagementScore(prospect.engagement_score || 0, toStatus);

  const updatedProspect = {
    ...prospect,
    status: toStatus,
    engagement_score: newScore,
    last_contacted_at:
      toStatus === PROSPECT_STATUSES.SENT || toStatus === PROSPECT_STATUSES.DELIVERED
        ? now
        : prospect.last_contacted_at,
    updated_at: now,
  };

  const activity = {
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    event_type: meta.eventType || `status_change_${toStatus}`,
    channel: meta.channel || prospect.channel_preference || null,
    from_status: fromStatus,
    to_status: toStatus,
    message_id: meta.messageId || null,
    details: {
      score_delta: (SCORE_DELTAS[toStatus] || 0),
      new_score: newScore,
      ...(meta.details || {}),
    },
    timestamp: now,
  };

  return {
    ok: true,
    prospect: updatedProspect,
    activity,
  };
}

/**
 * Scans prospects to find any that are stale and due for follow-up.
 *
 * @param {Array<object>} prospects
 * @param {number} followupDelayDays Default 4 days
 * @returns {Array<object>} Prospects that qualify for FOLLOWUP_DUE
 */
export function detectStaleProspects(prospects = [], followupDelayDays = 4) {
  if (!Array.isArray(prospects)) return [];
  const now = Date.now();
  const thresholdMs = followupDelayDays * 24 * 60 * 60 * 1000;

  return prospects.filter((p) => {
    // Only candidates in sent, delivered, or opened that haven't replied or converted
    const eligibleStatus = [
      PROSPECT_STATUSES.SENT,
      PROSPECT_STATUSES.DELIVERED,
      PROSPECT_STATUSES.OPENED,
      PROSPECT_STATUSES.CLICKED,
    ].includes(p.status);

    if (!eligibleStatus) return false;
    const lastActive = p.last_contacted_at ? new Date(p.last_contacted_at).getTime() : 0;
    return lastActive > 0 && now - lastActive >= thresholdMs;
  });
}
