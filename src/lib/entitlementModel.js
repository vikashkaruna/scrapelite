// entitlementModel.js — the single source of truth for "what may this user do?".
//
// PURE. Zero I/O: no localStorage, no fetch, no Date.now() side effects (the
// clock is always injected). That is deliberate — this exact module is imported
// by BOTH the React app and the Netlify functions, so the browser and the
// server can never disagree about an authorization decision. There is
// precedent for the cross-import: netlify/functions/extract.js already imports
// buildCacheKey from src/lib/resultCache.js.
//
// TWO AXES, NEVER CONFLATED
//   plan_id → what the user bought        ('free' | 'select' | 'pro' | ...)
//   status  → where they are in lifecycle ('active' | 'suspended' | ...)
//
// Lifecycle is checked BEFORE the plan is ever looked at. This is not stylistic:
// getEffectivePlanById() in pricingOverrides.js falls back to the Free plan for
// any unknown id, so modelling suspension as a "suspended" pseudo-plan would
// silently GRANT Free-tier access to a lapsed user instead of denying them.

/** Every capability the product gates. Keep in sync with the switch in can(). */
export const CAPS = Object.freeze([
  "extract",
  "extract.batch",
  "batch",
  // Discoverability audits get their OWN monthly budget rather than debiting
  // extraction credits. An audit is several fetches, a PageSpeed lookup, a
  // citation sample and an AI call — materially more expensive than one
  // extraction — so quietly draining the extraction pool would leave a user who
  // ran ten audits unable to extract anything and unable to see why.
  "audit",
  "audit.benchmark",
  "audit.schedule",
  "audit.prompt_monitor",
  "enrich",
  "ai",
  "export.csv",
  "export.pdf",
  "export.markdown",
  "export.json",
  "export.email",
  "schedules",
  "integrations",
  "webhooks",
  // Entitlement flag only — no shipping product yet. Gates the /pricing and
  // /account "Browser extension" line so the plan matrix and the entitlement
  // model can never disagree about who it's promised to.
  "browser_extension",
  // New in 2026-08-02: Business and Agency both ship with white-label PDF +
  // priority support. These caps are how the rest of the app finds out
  // (PDF export, template uploader, support contact routing, badge rendering).
  "white_label_pdf",
  "priority_support",
  // Workspace add-on capabilities. An extra workspace inherits the parent
  // plan's feature set; the seat cap is enforced at invite time, not here.
  "workspace.extra",
  "workspace.team_seats",
  // Whether the user may create ANOTHER workspace at all — checked at
  // create-workspace time, before workspace.team_seats or workspace.extra
  // ever come into play (a workspace has to exist before it can have seats).
  "workspace.create",
  // ── Intelligence Workflows (docs/INTELLIGENCE-WORKFLOWS-IMPLEMENTATION-PLAN.md)
  // template.run      may execute a workflow template at all
  // template.duplicate  may fork a template and edit its prompts
  // report.share      may publish a report to ANY shared visibility
  // report.branding   may remove DatIQ attribution / apply the Brand Kit
  "template.run",
  "template.duplicate",
  "report.share",
  "report.branding",
]);

export const STATUS = Object.freeze({
  ACTIVE: "active",
  GRANT_EXPIRED: "grant_expired",
  SUSPENDED: "suspended",
  DEACTIVATED: "deactivated",
  PURGED: "purged",
});

/** Lifecycle windows, measured in days after period_end. */
export const DEACTIVATE_AFTER_DAYS = 30;
export const PURGE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Severity ordering, so "stricter of stored vs computed" is a max(). */
const SEVERITY = { active: 0, grant_expired: 1, suspended: 1, deactivated: 2, purged: 3 };

/**
 * While suspended or deactivated the user keeps FULL export of their own data,
 * in every format, regardless of what their plan normally allows.
 *
 * This is a deliberate over-grant. We are simultaneously telling the user their
 * content will be deleted on day 90; withholding their own data in that window
 * would be hostile and is a weak position under DPDP data-portability. The
 * theoretical abuse (lapse a Select plan to get JSON export) only ever applies
 * to data the user already created and paid to create.
 */
const EXPORT_CAPS = new Set([
  "export.csv",
  "export.pdf",
  "export.markdown",
  "export.json",
  "export.email",
]);

/**
 * Deny codes `can()` returns for a blocked ACCOUNT, as opposed to a plan or
 * quota limit. The distinction matters to every caller that turns a denial
 * into UI copy: "upgrade your plan" is nonsensical advice for an account that
 * is frozen, scheduled for deletion, or a paused seat — the fix is in Account
 * (or asking an owner), never in Pricing. Exported so both the client
 * (BillingProvider's pre-flight checks) and the server (requireEntitlement's
 * denyBody, which the discoverability audit UI reads via `err.lifecycle`)
 * make that call the same way.
 */
export const ACCOUNT_BLOCKED_CODES = new Set([
  "FROZEN", "DELETION_PENDING", "MEMBER_PAUSED",
  "SUSPENDED", "DEACTIVATED", "GRANT_EXPIRED", "PURGED",
]);
export const isAccountBlocked = (code) => ACCOUNT_BLOCKED_CODES.has(code);

const ok = (remaining = Infinity) => ({
  allowed: true,
  reason: null,
  code: null,
  remaining,
});
const deny = (code, reason, remaining = 0, upgradeTo = null) => ({
  allowed: false,
  reason,
  code,
  remaining,
  upgradeTo,
});

function toTime(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Is this account governed by the paid-subscription lifecycle at all?
 *
 * Free and never-paid accounts are NOT. They can never be suspended, never be
 * deactivated, and are never purged by the billing crons. Rows migrated from
 * the legacy `subscriptions` table land with source='migration' and a null
 * period_end precisely so that existing customers are not retro-suspended the
 * moment this ships — their lifecycle starts at their next real payment.
 */
export function isLifecycleManaged(ent) {
  return Boolean(ent && ent.source === "payment" && toTime(ent.period_end));
}

/**
 * Recompute lifecycle status from dates and return the STRICTER of the stored
 * status and the computed one.
 *
 * The "stricter" rule is the most important line in this module. The daily cron
 * is what normally advances status, but if it stalls (Netlify incident, bad
 * deploy, someone disables the schedule) the read path still self-heals and a
 * lapsed user cannot keep paid access indefinitely. It only ever tightens, so a
 * cron that has already suspended someone is never accidentally undone here.
 *
 * @param {object} ent  entitlements row
 * @param {Date|number} [now]
 */
export function computeLifecycle(ent, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const stored = ent?.status && SEVERITY[ent.status] != null ? ent.status : STATUS.ACTIVE;

  // Complimentary grants have a hard validity window, but are not paid
  // subscriptions: once they end, deny product capabilities without sending
  // renewal notices, suspending schedules through the paid lifecycle, or
  // entering the 90-day data-purge path.
  const grantEnd = ent?.source === "admin_coupon" ? toTime(ent.period_end) : null;
  if (grantEnd && nowMs >= grantEnd && stored === STATUS.ACTIVE) {
    return {
      status: STATUS.GRANT_EXPIRED,
      computed: STATUS.GRANT_EXPIRED,
      stored,
      periodEnd: grantEnd,
      deactivateAt: null,
      purgeAt: null,
      daysUntilPurge: null,
    };
  }

  if (!isLifecycleManaged(ent)) {
    // Not lifecycle-managed: an admin may still have set an explicit status
    // (manual suspension), so honour a stored non-active value, but never
    // synthesise one from dates.
    return {
      status: stored,
      computed: STATUS.ACTIVE,
      stored,
      periodEnd: null,
      deactivateAt: null,
      purgeAt: null,
      daysUntilPurge: null,
    };
  }

  const periodEnd = toTime(ent.period_end);
  const compUntil = toTime(ent.comp_until);
  const deactivateAt = periodEnd + DEACTIVATE_AFTER_DAYS * DAY_MS;
  const purgeAt = periodEnd + PURGE_AFTER_DAYS * DAY_MS;

  let computed;
  if (compUntil && compUntil > nowMs) computed = STATUS.ACTIVE; // admin grace
  else if (nowMs < periodEnd) computed = STATUS.ACTIVE;
  else if (nowMs < deactivateAt) computed = STATUS.SUSPENDED;
  else if (nowMs < purgeAt) computed = STATUS.DEACTIVATED;
  else computed = STATUS.PURGED;

  const status = SEVERITY[computed] >= SEVERITY[stored] ? computed : stored;

  return {
    status,
    computed,
    stored,
    periodEnd,
    deactivateAt,
    purgeAt,
    daysUntilPurge: Math.ceil((purgeAt - nowMs) / DAY_MS),
  };
}

function fmtDate(ms) {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/** User-facing copy for a non-active lifecycle state. */
export function lifecycleReason(life) {
  const ended = fmtDate(life.periodEnd);
  const purge = fmtDate(life.purgeAt);
  if (life.status === STATUS.GRANT_EXPIRED) {
    return `Your complimentary plan grant ended on ${ended}. Apply another grant or choose a paid plan to continue.`;
  }
  if (life.status === STATUS.PURGED) {
    return "This account's data was removed after 90 days without an active subscription. Choose a plan to start again.";
  }
  const tail = purge
    ? ` Your data is safe until ${purge} — you can still view and export everything you've saved.`
    : "";
  if (life.status === STATUS.DEACTIVATED) {
    return `Your subscription lapsed on ${ended} and the account is deactivated.${tail} Renew to resume extractions and schedules.`;
  }
  return `Your subscription lapsed on ${ended}.${tail} Renew to resume extractions and schedules.`;
}

/**
 * The one decision function. Never throws, never returns undefined.
 *
 * @param {object} ent  entitlements row ({ plan_id, status, period_end, ... })
 * @param {string} capability  one of CAPS
 * @param {object} ctx
 * @param {object} ctx.planMap        id → plan (with .limits). REQUIRED for plan-gated caps.
 * @param {object} [ctx.usage]        { extractions, enrichments } for quota caps
 * @param {number} [ctx.bonus]        bonus extractions
 * @param {number} [ctx.bonusBatchUrls]
 * @param {number} [ctx.urlCount]     for batch caps
 * @param {string} [ctx.url]          for enrich
 * @param {Date}   [ctx.now]
 * @returns {{allowed:boolean, reason:string|null, code:string|null, remaining:number, upgradeTo?:string|null}}
 */
export function can(ent, capability, ctx = {}) {
  const life = computeLifecycle(ent, ctx.now ?? new Date());

  // ── 1. Lifecycle gate — always before the plan lookup ──────────────────────
  if (life.status !== STATUS.ACTIVE) {
    if (life.status === STATUS.PURGED) {
      return deny("PURGED", lifecycleReason(life));
    }
    if (EXPORT_CAPS.has(capability)) return ok(); // data portability, see EXPORT_CAPS
    const lifecycleCode = life.status === STATUS.GRANT_EXPIRED
      ? "GRANT_EXPIRED"
      : life.status === STATUS.DEACTIVATED
        ? "DEACTIVATED"
        : "SUSPENDED";
    return deny(
      lifecycleCode,
      lifecycleReason(life),
    );
  }

  // ── 1b. Account freeze / member pause ─────────────────────────────────────
  //
  // A SEPARATE AXIS from `status`, deliberately. `status = 'suspended'` is the
  // BILLING lifecycle — it starts dunning and a day-90 purge countdown, and it
  // means "this account has lapsed". A freeze means the opposite: "keep
  // charging me, keep my data, just stop anyone consuming units". Modelling one
  // as the other would enrol a paying customer in a dunning sequence and start
  // a deletion clock on data they explicitly asked to keep.
  //
  // Same shape as scheduled_tasks.system_paused vs .status: one column records
  // the USER's intent, another the PLATFORM's, and neither is mistakable for
  // the other.
  //
  // Sits AFTER the lifecycle gate because a purged account is past caring about
  // a freeze, and BEFORE the plan lookup because a frozen account's plan is
  // irrelevant to the answer.
  //
  // It reuses the EXPORT_CAPS carve-out above rather than inventing a second
  // one: read and export stay available, which is exactly the "view-only until
  // unfrozen" behaviour the feature promises. `ctx.memberPaused` carries the
  // per-seat version of the same rule for a workspace member.
  const frozen = Boolean(ent?.frozen_at);
  const paused = Boolean(ctx.memberPaused);
  if (frozen || paused) {
    if (EXPORT_CAPS.has(capability)) return ok();
    const deleting = Boolean(ent?.deletion_requested_at);
    return deny(
      paused ? "MEMBER_PAUSED" : deleting ? "DELETION_PENDING" : "FROZEN",
      paused
        ? "Your seat in this workspace is paused. You can still read and export; ask an owner or admin to resume it."
        : deleting
          ? "This account is scheduled for deletion. You can still read and export your data. Cancel the deletion in Account to start working again."
          : "This account is frozen. You can still read and export your data — unfreeze it in Account to run extractions, enrichments and audits again.",
    );
  }

  // ── 2. Plan lookup — STRICT. No silent fallback to Free. ───────────────────
  const planId = ent?.plan_id || "free";
  const plan = ctx.planMap?.[planId];
  if (!plan?.limits) {
    return deny(
      "UNKNOWN_PLAN",
      "We couldn't verify your plan. Please refresh, or contact support if this persists.",
    );
  }
  const L = plan.limits;
  const usage = ctx.usage ?? { extractions: 0, enrichments: {} };

  // ── 3. Plan capability + quota ─────────────────────────────────────────────
  switch (capability) {
    case "extract": {
      const limit =
        L.extractions === Infinity ? Infinity : L.extractions + (ctx.bonus || 0);
      if (limit === Infinity) return ok(Infinity);
      const used = usage.extractions || 0;
      if (used >= limit) {
        return deny(
          "QUOTA_EXCEEDED",
          `You've used all ${limit} extraction${limit === 1 ? "" : "s"} this month. Upgrade or purchase a top-up bundle.`,
        );
      }
      return ok(limit - used);
    }

    case "extract.batch": {
      const urlCount = ctx.urlCount ?? 1;
      const limit =
        L.extractions === Infinity ? Infinity : L.extractions + (ctx.bonus || 0);
      if (limit === Infinity) return ok(Infinity);
      const remaining = limit - (usage.extractions || 0);
      if (remaining < urlCount) {
        return deny(
          "QUOTA_EXCEEDED",
          `You need ${urlCount} extraction${urlCount > 1 ? "s" : ""} but only have ${Math.max(0, remaining)} remaining this month. Upgrade or purchase a top-up bundle.`,
          Math.max(0, remaining),
        );
      }
      return ok(remaining);
    }

    case "batch": {
      const urlCount = ctx.urlCount ?? 1;
      const effective = (L.batch_max_urls || 0) + (ctx.bonusBatchUrls || 0);
      if (effective === 0) {
        return deny(
          "NOT_IN_PLAN",
          "Batch mode is not available on your current plan. Upgrade to unlock batch extraction.",
          0,
          "pro",
        );
      }
      if (urlCount > effective) {
        const hint =
          planId === "free"
            ? "Upgrade to Go (20 URLs), Select (50 URLs), Pro (100 URLs), Business (250 URLs), or Agency (500 URLs)."
            : planId === "go"
              ? "Upgrade to Select (50 URLs), Pro (100 URLs), Business (250 URLs), or Agency (500 URLs) for more."
              : planId === "select"
                ? "Upgrade to Pro (100 URLs), Business (250 URLs), or Agency (500 URLs) for more."
                : planId === "pro"
                  ? "Upgrade to Business (250 URLs) or Agency (500 URLs) for larger batches."
                  : `Your plan supports up to ${effective} URLs per batch. Reduce your list or upgrade.`;
        return deny(
          "PLAN_LIMIT",
          `You've reached your batch limit of ${effective} URL${effective === 1 ? "" : "s"}. ${hint}`,
          effective,
        );
      }
      return ok(effective - urlCount);
    }

    case "audit": {
      const count = ctx.auditCount ?? 1;
      const limit = L.audits === Infinity ? Infinity : (L.audits || 0) + (ctx.bonusAudits || 0);
      if (limit === Infinity) return ok(Infinity);
      if (limit <= 0) {
        return deny(
          "PLAN_REQUIRED",
          "Discoverability audits are not included in your plan.",
          0,
          "go",
        );
      }
      const used = usage.audits || 0;
      if (used + count > limit) {
        return deny(
          "QUOTA_EXCEEDED",
          used >= limit
            ? `You've used all ${limit} discoverability audit${limit === 1 ? "" : "s"} this month.`
            : `This needs ${count} audits but only ${Math.max(0, limit - used)} remain this month.`,
          Math.max(0, limit - used),
        );
      }
      return ok(limit - used - count);
    }

    // A benchmark audits several URLs at once, so it is gated on the audit
    // quota being able to cover the WHOLE set. Half a competitive comparison
    // is not a smaller comparison, it is a misleading one.
    case "audit.benchmark": {
      const urlCount = ctx.urlCount ?? 2;
      if (!L.audits) {
        return deny("PLAN_REQUIRED", "Competitive benchmarks are not included in your plan.", 0, "pro");
      }
      // Benchmarking is a paid-plan capability: the free taster exists to show
      // what a single audit looks like, not to run competitor sets.
      if (L.audits !== Infinity && L.audits < 25) {
        return deny(
          "PLAN_REQUIRED",
          "Competitive benchmarks are available from the Select plan upward.",
          0,
          "select",
        );
      }
      return can(ent, "audit", { ...ctx, auditCount: urlCount });
    }

    case "audit.schedule": {
      if (!L.audits) {
        return deny("PLAN_REQUIRED", "Scheduled monitoring is not included in your plan.", 0, "go");
      }
      // Reuses the extraction scheduler's own plan limit: a user who may keep
      // no schedules at all should not acquire the right to keep them by
      // pointing them at audits instead.
      if (!L.scheduled_monitoring) {
        return deny(
          "PLAN_REQUIRED",
          "Scheduled monitoring is not included in your plan.",
          0,
          "select",
        );
      }
      return ok(L.scheduled_monitoring);
    }

    case "audit.prompt_monitor": {
      // W6.5. Follows the `audit.schedule` precedent D9 names: map a new
      // capability onto the limits that already exist rather than inventing a
      // plan axis nobody bought.
      //
      // ⚠️ GATED BECAUSE IT SPENDS SOMEBODY ELSE'S QUOTA. A monitor makes real
      // answer-engine calls on a cadence, without a human present to notice
      // they are happening — which is exactly the shape of thing that should
      // not be ungated by default.
      if (!L.audits) {
        return deny("PLAN_REQUIRED", "Prompt monitoring is not included in your plan.", 0, "go");
      }
      if (!L.scheduled_monitoring) {
        return deny(
          "PLAN_REQUIRED",
          "Prompt monitoring needs a plan that includes scheduled monitoring.",
          0,
          "select",
        );
      }
      // Shares the scheduled-monitoring allowance rather than holding its own:
      // a user who may keep five recurring jobs should not get five more by
      // pointing them at prompts instead of pages.
      return ok(L.scheduled_monitoring);
    }

    case "enrich": {
      const limit = L.enrichments_per_extraction;
      if (limit === Infinity) return ok(Infinity);
      const used = usage.enrichments?.[ctx.url] ?? 0;
      if (used >= limit) {
        return deny(
          "PLAN_LIMIT",
          `Your ${plan.name} plan allows ${limit} enrichment${limit === 1 ? "" : "s"} per extraction. Upgrade to unlock more.`,
        );
      }
      return ok(limit - used);
    }

    case "export.csv":
    case "export.pdf":
    case "export.markdown":
    case "export.json": {
      const fmt = capability.slice("export.".length);
      return (L.exports || []).includes(fmt)
        ? ok()
        : deny("NOT_IN_PLAN", `${fmt.toUpperCase()} export is not available on your current plan.`);
    }

    case "export.email":
      return L.email_export
        ? ok()
        : deny("NOT_IN_PLAN", "Email export is not available on your current plan.");

    case "schedules":
      return (L.scheduled_monitoring || 0) > 0
        ? ok(L.scheduled_monitoring)
        : deny(
            "NOT_IN_PLAN",
            "Scheduled monitoring is not available on your current plan. Upgrade to Select to schedule recurring runs.",
            0,
            "select",
          );

    // White-label PDF: Business (2026-08-02) and Agency. The flag is what
    // unlocks the template uploader in /account and the background-merge
    // in extractionsToPdf / invoicePdf. Free / Go / Select / Pro get
    // a clean deny with an upgrade hint that points at the right tier.
    case "white_label_pdf":
      return L.white_label_pdf
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "White-label PDF is available on the Business plan and above. Upgrade to add your own template to exported PDFs.",
            0,
            "business",
          );

    // ── Intelligence Workflows ──────────────────────────────────────────
    // template.run is DELIBERATELY ungated by plan. PRD 1 exists to get a new
    // user to a meaningful first outcome inside five minutes; putting a
    // paywall in front of that would defeat the feature's entire purpose. The
    // real limit is the extraction/credit quota the run consumes, which the
    // `extract` and `enrich` cases above already enforce. A template is a
    // better-shaped way to spend a credit, not an extra thing to sell.
    case "template.run":
      return ok();

    // Duplicating a template means editing its prompts — the power-user path,
    // and the one that costs support time when it goes wrong. Paid only.
    case "template.duplicate":
      return L.template_duplicate
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "Duplicating and editing a template is available on the Go plan and above.",
            0,
            "go",
          );

    // ── Intelligence Workflows, Phases 4-6 (PRD 3, 4, 5) ────────────────────
    // These three shipped with NO entitlement check of any kind, which made
    // three of the BRD's own headline upgrade triggers ("bulk limits",
    // "monitored URLs", "automation volume") unenforceable, and left three
    // cost-bearing operations unmetered.
    //
    // Each reuses a limit the pricing page ALREADY sells rather than inventing
    // a new number. Choosing new per-tier allowances is a pricing decision for
    // the owner, not something to smuggle in with a security fix — and a limit
    // nobody has priced is worse than an honest reuse of one that is.

    // A bulk list is a batch of URLs by another name, so it answers to the
    // batch allowance. Giving it a separate, ungated path would let a user on
    // a 5-URL batch limit enrich 500 domains by using the other screen.
    case "bulk.enrich": {
      const rowCount = ctx.rowCount ?? 1;
      const effective = (L.batch_max_urls || 0) + (ctx.bonusBatchUrls || 0);
      if (effective === 0) {
        return deny(
          "NOT_IN_PLAN",
          "Bulk account intelligence is not available on your current plan.",
          0,
          "pro",
        );
      }
      if (rowCount > effective) {
        return deny(
          "PLAN_LIMIT",
          `Your plan supports up to ${effective} account${effective === 1 ? "" : "s"} per list. Reduce the list or upgrade for larger runs.`,
          effective,
        );
      }
      return ok(effective - rowCount);
    }

    // A watchlist IS a recurring monitor — it crawls on a cadence forever —
    // so it answers to the same allowance as every other scheduled job.
    // `audit.schedule` above reuses this limit for exactly the same reason:
    // a user who may keep no schedules must not acquire the right to keep
    // them by pointing them at a different object.
    case "watchlist.create": {
      const owned = ctx.watchlistCount ?? 0;
      const cap = L.scheduled_monitoring || 0;
      if (cap === 0) {
        return deny(
          "PLAN_REQUIRED",
          "Competitor watchlists require a plan that includes scheduled monitoring.",
          0,
          "select",
        );
      }
      if (cap !== Infinity && owned >= cap) {
        return deny(
          "PLAN_LIMIT",
          `You've reached your plan's limit of ${cap} monitored watchlist${cap === 1 ? "" : "s"}.`,
          0,
        );
      }
      return ok(cap === Infinity ? Infinity : cap - owned);
    }

    // A signal rule exists to push into HubSpot / Slack / a webhook. It is the
    // integrations capability wearing a different UI, and gating it anywhere
    // else would let a free user reach the four push providers that
    // `integrations` was explicitly added to gate.
    case "rule.create":
      return L.integrations
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "Signal routing rules are available on the Select plan and above.",
            0,
            "select",
          );

    // Sharing is likewise ungated: PRD 2's whole acquisition loop is a free
    // user sharing a report with someone who then signs up. Gating it would be
    // charging for our own distribution. What free tier does NOT get is
    // removing the DatIQ attribution — that is report.branding, below.
    case "report.share":
      return ok();

    // Removing DatIQ attribution / applying the Brand Kit to a shared report.
    // Same tier as white_label_pdf, and deliberately the same underlying
    // limit: a customer who has paid to brand their PDFs would not understand
    // being told their shared reports are a separate purchase.
    case "report.branding":
      return L.white_label_pdf
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "Custom report branding is available on the Business plan and above. Shared reports on your plan carry a DatIQ credit.",
            0,
            "business",
          );

    // Priority support: Business + Agency. Used by the contact form's
    // SLA copy (see contactRouting.js) and the support badge in the
    // account page. Free / Go / Select / Pro can still file tickets,
    // but they are routed through the general SLA.
    case "priority_support":
      return L.priority_support
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "Priority support is included on the Business plan and above. Upgrade for a faster response SLA.",
            0,
            "business",
          );

    // How many workspaces this user may OWN, total. Free/Go/Select/Pro/
    // Developer all ship `workspaces: 1` (their one default workspace,
    // created automatically); Agency ships `workspaces: 5`. Each purchased
    // "Extra Workspace" bundle (ctx.workspacesPurchased) adds one more on
    // top of the plan's base allotment, on any plan — see the bundle's own
    // description in pricingConfig.js ("adds a fully-featured client
    // workspace... capped at your plan's team-seats limit"), which is a
    // capacity add-on, not a plan requirement.
    case "workspace.create": {
      const cap = (L.workspaces || 1) + (ctx.workspacesPurchased || 0);
      const owned = ctx.workspacesOwned ?? 0;
      return owned < cap
        ? ok(cap - owned)
        : deny(
            "QUOTA_EXCEEDED",
            `You've reached your plan's workspace limit (${cap}). Add an Extra Workspace or upgrade to create another.`,
            0,
            planId === "agency" ? null : "agency",
          );
    }

    // Workspace add-on: only meaningful when the user has actually
    // purchased extra workspaces. The cap is consulted when the user
    // tries to INVITE a member into an extra workspace — invite
    // success then requires workspace.team_seats to be > 0 for that
    // workspace (the parent plan's team_seats is the actual cap, but
    // we mirror it here so the gating flow is symmetric).
    case "workspace.extra":
      // The entitlement row does not currently track per-workspace
      // counts; the workspace count is read from the add-on bundle
      // stack. The caller passes ctx.workspacesPurchased; we accept
      // any positive number as proof the user has the add-on.
      return (ctx.workspacesPurchased || 0) > 0
        ? ok(ctx.workspacesPurchased)
        : deny(
            "NOT_IN_PLAN",
            "Add an Extra Workspace from the pricing page to enable additional client workspaces.",
            0,
            null,
          );

    case "workspace.team_seats": {
      // The cap is the PARENT plan's team_seats. If the user is on
      // Business, that's 3; on Agency it's 5; etc. Extra workspaces
      // never expand this — they inherit it.
      const cap = L.team_seats || 0;
      if (cap <= 0) {
        return deny(
          "NOT_IN_PLAN",
          "Your plan does not include team seats. Upgrade to invite members into your workspace.",
          0,
          "select",
        );
      }
      const remaining = cap - (ctx.seatsUsed || 0);
      // cap>0 alone is not "there is room" — a workspace already at its cap
      // (seatsUsed === cap, or over it if the cap shrank after a downgrade)
      // must still be denied, or an invite silently overfills the workspace.
      if (remaining <= 0) {
        return deny(
          "QUOTA_EXCEEDED",
          `This workspace is at its seat limit (${cap}). Remove a member or upgrade for more seats.`,
          0,
          "agency",
        );
      }
      return ok(remaining);
    }

    // Not plan-gated today; listed so suspension still blocks them and so the
    // capability names exist before PR3 wires the UI.
    case "ai":
    case "webhooks":
      return ok();

    // Push integrations (HubSpot, Notion, Airtable, Slack). Free and Go are
    // taster tiers; Google Sheets stays available to everyone regardless —
    // it needs no connection and is not gated through this capability at all
    // (see PushIntegrationMenu's SHEETS_ROW, which is clientSide and never
    // calls checkCanIntegrations).
    case "integrations":
      return L.integrations
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "Push integrations (HubSpot, Notion, Airtable, Slack) are available from the Select plan upward.",
            0,
            "select",
          );

    // Entitlement flag only — see the CAPS comment. Same taster-tier split as
    // integrations: Free and Go don't get it, Select and up do.
    case "browser_extension":
      return L.browser_extension
        ? ok()
        : deny(
            "NOT_IN_PLAN",
            "The DatIQ browser extension is available from the Select plan upward.",
            0,
            "select",
          );

    default:
      return deny("UNKNOWN_CAPABILITY", `Unknown capability: ${capability}`);
  }
}

/** Convenience for callers that only need a boolean (kept for the bare-boolean gates). */
export function allows(ent, capability, ctx) {
  return can(ent, capability, ctx).allowed;
}

/**
 * Compute the EFFECTIVE limits for a workspace — the user's parent-plan limits
 * intersected with the parent plan's team_seats cap. The extra-workspace
 * add-on (pricingConfig.js → TOPUP_BUNDLES "workspace-addon") inherits
 * features but never headcount, so the seat ceiling stays the same.
 *
 * Returns null when the user has no team seats in their plan (e.g. Free)
 * or hasn't purchased any extra workspaces — the caller should hide the
 * "create extra workspace" affordance in that case.
 *
 * @param {object} ent                entitlements row
 * @param {object} planMap            id → plan (with .limits)
 * @param {number} workspacesPurchased number of extra workspaces the user owns
 * @returns {null | { teamSeats:number, exports:string[], batchMaxUrls:number,
 *   scheduledMonitoring:number, emailExport:boolean, apiAccess:boolean,
 *   whiteLabelPdf:boolean, prioritySupport:boolean, sourcePlanId:string }}
 */
export function workspaceAddonFeaturesForPlan(ent, planMap, workspacesPurchased = 0) {
  if (!workspacesPurchased || workspacesPurchased < 1) return null;
  const plan = planMap?.[ent?.plan_id || "free"];
  if (!plan?.limits) return null;
  const L = plan.limits;
  // Free / never-paid plans have no team seats; extra workspaces would be
  // empty rooms, so we refuse to model them.
  if (!L.team_seats || L.team_seats < 1) return null;
  return {
    sourcePlanId: plan.id,
    teamSeats: L.team_seats,
    exports: Array.isArray(L.exports) ? L.exports.slice() : [],
    batchMaxUrls: L.batch_max_urls || 0,
    scheduledMonitoring: L.scheduled_monitoring || 0,
    emailExport: !!L.email_export,
    apiAccess: !!L.api_access,
    whiteLabelPdf: !!L.white_label_pdf,
    prioritySupport: !!L.priority_support,
  };
}

/** A synthetic always-active entitlement, for callers that only know a plan id. */
export function activeEntitlement(planId) {
  return { plan_id: planId || "free", status: STATUS.ACTIVE, source: null, period_end: null };
}
