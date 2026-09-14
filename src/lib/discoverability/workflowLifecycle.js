// workflowLifecycle.js — the states a recommendation moves through. W8.
//
// PURE. Shared by React and `netlify/`.
//
// Shipped states were `open | accepted | dismissed | done`. The PRD's lifecycle
// is Open → Accepted → Assigned → In progress → Implemented → Validation
// scheduled → Validated, and the gap is the difference between a checklist and
// a workflow: nothing could say a fix was underway, and nothing could say it
// had been VERIFIED rather than merely claimed.
//
// ── TEN STATES, INCLUDING THREE MEASURED OUTCOMES ───────────────────────────
// The approval path names seven stages. A queue you cannot decline an item from forces the user
// to do work they judged unnecessary or leave it open for ever, and the
// mandatory dismissal reason this codebase already enforces is some of the most
// useful data in the table.
// P3 adds two honest validation outcomes: no measurable change and regressed.
//
// ── `done` AND `implemented` ARE ONE STATE UNDER TWO NAMES ─────────────────
// Every stored row, export and webhook payload uses `done`. Renaming it would
// rewrite history for no gain. `implemented` is the PRD's word; both are
// accepted and both render as one label.

export const TERMINAL_STATES = Object.freeze([
  "validated", "no_measurable_change", "regressed", "dismissed",
]);

/**
 * Every state, with what it means and what may follow.
 *
 * `next` is guidance for the UI, not enforcement. An operator who needs to jump
 * from `open` straight to `validated` — because the fix was already live and
 * the re-audit proves it — should not be blocked by a state machine that knows
 * less about their week than they do. `canTransition` says so explicitly.
 */
export const WORKFLOW_STATES = Object.freeze({
  open: {
    id: "open", label: "Open", order: 0, active: true,
    describes: "Nobody has picked this up.",
    next: ["accepted", "assigned", "dismissed"],
  },
  accepted: {
    id: "accepted", label: "Accepted", order: 1, active: true,
    describes: "Agreed as worth doing. Not yet anybody's.",
    next: ["assigned", "in_progress", "dismissed"],
  },
  assigned: {
    id: "assigned", label: "Assigned", order: 2, active: true,
    describes: "Somebody owns it. W5.5's assignee is what makes this state real.",
    next: ["in_progress", "accepted", "dismissed"],
  },
  in_progress: {
    id: "in_progress", label: "In progress", order: 3, active: true,
    describes: "Being worked on now.",
    next: ["implemented", "assigned", "dismissed"],
  },
  implemented: {
    id: "implemented", label: "Implemented", order: 4, active: false,
    describes: "The change is live. A claim by whoever made it — not yet measured.",
    next: ["validation_scheduled", "validated", "in_progress"],
  },
  done: {
    id: "done", label: "Implemented", order: 4, active: false,
    alias_of: "implemented",
    describes: "The shipped name for `implemented`. Kept because every stored row uses it.",
    next: ["validation_scheduled", "validated", "in_progress"],
  },
  validation_scheduled: {
    id: "validation_scheduled", label: "Validation scheduled", order: 5, active: false,
    describes: "A re-audit is queued to check it.",
    next: ["validated", "no_measurable_change", "regressed", "in_progress"],
  },
  validated: {
    id: "validated", label: "Validated", order: 6, active: false,
    describes: "A later audit re-measured the signal and the fix holds.",
    next: ["in_progress"],
  },
  no_measurable_change: {
    id: "no_measurable_change", label: "No measurable change", order: 7, active: false,
    describes: "A later audit found no meaningful movement in the intended metric.",
    next: ["in_progress", "dismissed"],
  },
  regressed: {
    id: "regressed", label: "Regressed", order: 8, active: false,
    describes: "A later audit measured a worse outcome after implementation.",
    next: ["in_progress", "dismissed"],
  },
  dismissed: {
    id: "dismissed", label: "Dismissed", order: 9, active: false,
    describes: "Declined, with a reason. Ours, not the PRD's, and load-bearing.",
    next: ["open"],
  },
});

export const WORKFLOW_STATE_IDS = Object.freeze(Object.keys(WORKFLOW_STATES));

/** The states where somebody still has to do something. Drives the queue count. */
export const ACTIVE_STATE_IDS = Object.freeze(
  WORKFLOW_STATE_IDS.filter((id) => WORKFLOW_STATES[id].active),
);

/** `done` and `implemented` are one state; everything else is itself. */
export function canonicalState(id) {
  const s = WORKFLOW_STATES[id];
  if (!s) return null;
  return s.alias_of || s.id;
}

export function workflowState(id) {
  return WORKFLOW_STATES[id] || null;
}

/** Is this a state a recommendation may hold? */
export function isWorkflowState(id) {
  return Boolean(WORKFLOW_STATES[id]);
}

/**
 * May this transition happen?
 *
 * ⚠️ ALWAYS TRUE FOR A KNOWN STATE, AND THAT IS THE DESIGN. `next` is what the
 * UI should OFFER; it is not a gate. A state machine that refuses a legitimate
 * jump teaches people to work around the tool — and the person moving the item
 * knows more about their week than this table does. The return carries
 * `suggested` so a UI can distinguish the common path from the unusual one
 * without forbidding either.
 */
export function canTransition(from, to) {
  if (!isWorkflowState(to)) {
    return { allowed: false, suggested: false, reason: `${to} is not a workflow state.` };
  }
  if (!isWorkflowState(from)) {
    return { allowed: true, suggested: false, reason: null };
  }
  const suggested = WORKFLOW_STATES[from].next.includes(canonicalState(to))
    || WORKFLOW_STATES[from].next.includes(to);
  return { allowed: true, suggested, reason: null };
}

/**
 * What a state change requires before it may be recorded.
 *
 * Two rules, and both already existed in the codebase in one form or another —
 * this states them in one place so the API, the UI and any future importer
 * cannot disagree about them.
 */
export function requirementsFor(state, ctx = {}) {
  const missing = [];
  const s = canonicalState(state);

  // Pre-existing and enforced server-side since the queue shipped.
  if (s === "dismissed" && !String(ctx.reason || "").trim()) {
    missing.push("A dismissal needs a reason — three months from now one without is indistinguishable from a mis-click.");
  }
  // 🔴 The rule that makes `validated` mean anything. Without a re-measuring
  // audit it is a second word for `implemented`: a claim by the same person who
  // did the work, which is exactly what the validation loop exists to replace.
  if (["validated", "no_measurable_change", "regressed"].includes(s) && !ctx.validatedByAuditId) {
    missing.push("Validation needs the audit that re-measured the signal — otherwise it is a claim, not a measurement.");
  }
  if (s === "assigned" && !ctx.assignee) {
    missing.push("Assigning needs somebody to assign it to.");
  }

  return { ok: missing.length === 0, missing };
}

/** Group a queue by state, in lifecycle order, for a board view. */
export function groupByState(recommendations = []) {
  const groups = Object.fromEntries(
    [...new Set(WORKFLOW_STATE_IDS.map(canonicalState))].map((id) => [id, []]),
  );
  for (const r of Array.isArray(recommendations) ? recommendations : []) {
    const id = canonicalState(r.status) || "open";
    (groups[id] = groups[id] || []).push(r);
  }
  return groups;
}

/** Items past their due date and still needing work. */
export function overdue(recommendations = [], now = Date.now()) {
  return (Array.isArray(recommendations) ? recommendations : []).filter((r) => {
    if (!r?.due_at) return false;
    if (!ACTIVE_STATE_IDS.includes(canonicalState(r.status))) return false;
    const t = Date.parse(r.due_at);
    return Number.isFinite(t) && t < now;
  });
}
