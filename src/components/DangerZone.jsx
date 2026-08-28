// src/components/DangerZone.jsx — freeze or delete this account.
//
// ── THE TWO ACTIONS ARE NOT VARIANTS OF EACH OTHER ─────────────────────────
// Freezing is reversible, keeps everything, and keeps billing running. Deleting
// is a scheduled, irreversible removal of the account and everything in it.
// Presenting them as two buttons in a row would invite the reading that one is
// a milder version of the other, so they are separated, worded differently, and
// only deletion asks for a typed confirmation.
//
// ── WHAT THE COPY HAS TO GET RIGHT ─────────────────────────────────────────
// Two things people reliably assume, both wrong, and both expensive:
//   * that freezing pauses billing. It does not, and saying so once in small
//     print is not enough — it is stated on the button's own explanation and
//     again in the confirmation.
//   * that deletion is instant. It is a 30-day scheduled purge, which is good
//     news, and the countdown plus a visible cancel is what makes it read as
//     recoverable rather than as a failure to delete.

import { useState } from "react";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";
import { useToast } from "./Toast.jsx";
import { useBilling } from "./BillingProvider.jsx";
import {
  DELETE_CONFIRMATION,
  freezeAccount, unfreezeAccount,
  requestAccountDeletion, cancelAccountDeletion,
} from "../lib/accountStateService.js";

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/** Whole days from now until `iso`, floored at 0. */
export function daysUntil(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 86400000));
}

const DEFAULT_GRACE_DAYS = 30;

/**
 * Preview of the purge date a `request_account_deletion` call would compute
 * — see supabase/migrations/0033_deletion_period_end_gate.sql, which this
 * mirrors exactly (GREATEST(period_end, now + grace) for an active paid
 * plan; flat now + grace otherwise). Display-only: the server recomputes the
 * real value on confirm, this just lets the copy tell the truth BEFORE the
 * user commits to anything.
 */
export function previewDeletionDate(state, now = Date.now(), graceDays = DEFAULT_GRACE_DAYS) {
  const graceEnd = now + graceDays * 86400000;
  const hasActivePaidPlan = state?.planId && state.planId !== "free" && state.status === "active";
  const periodEndMs = state?.periodEnd ? new Date(state.periodEnd).getTime() : NaN;
  if (hasActivePaidPlan && Number.isFinite(periodEndMs)) {
    return new Date(Math.max(periodEndMs, graceEnd)).toISOString();
  }
  return new Date(graceEnd).toISOString();
}

export default function DangerZone({ state, onChange }) {
  const showToast = useToast();
  const refreshEntitlement = useBilling()?.refreshEntitlement;
  const [busy, setBusy] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  if (!state?.available) return null;

  const frozen = Boolean(state.frozen);
  const deleting = Boolean(state.deletionRequestedAt);
  const daysLeft = daysUntil(state.deletionPurgeAfter);
  const hasActivePaidPlan = Boolean(state.planId) && state.planId !== "free" && state.status === "active";
  const previewPurgeAt = previewDeletionDate(state);
  const planLabel = hasActivePaidPlan
    ? state.planId.charAt(0).toUpperCase() + state.planId.slice(1)
    : null;

  async function run(label, fn) {
    setBusy(label);
    const r = await fn();
    setBusy(null);
    if (!r.ok) { showToast(r.error); return; }
    onChange?.(r.state);
    // BillingProvider's cached entitlement (frozen_at / deletion_requested_at)
    // is what every client-side pre-flight check (checkCanExtract, ...) reads.
    // Without this, freezing or cancelling a deletion here is invisible to
    // those checks for up to the cache's 60s TTL — the user could freeze their
    // account and still see Extract behave as if nothing changed.
    refreshEntitlement?.();
    return r;
  }

  return (
    <div className="card card-pad danger-zone">
      <h3 className="danger-zone-title">
        <Icon name="alert-triangle" size={15} />
        Danger zone
      </h3>

      {/* ── Scheduled deletion takes over the panel ─────────────────────────
          When a deletion is pending it is the only thing that matters here, and
          the one control that must be impossible to miss is Cancel. */}
      {deleting ? (
        <div className="danger-row danger-row-active">
          <div className="danger-row-body">
            <div className="danger-row-head">This account is scheduled for deletion</div>
            <p className="danger-row-desc">
              Everything — extractions, audits, schedules, workspaces and team
              members — will be permanently deleted on{" "}
              <b>{formatDate(state.deletionPurgeAfter)}</b>
              {daysLeft !== null && <> ({daysLeft} day{daysLeft === 1 ? "" : "s"} from now)</>}.
              Your account is frozen until then, so nothing new is charged for usage.
              You can still read and export your data.
            </p>
            <p className="danger-row-desc">
              Changed your mind? Cancelling restores full access immediately.
            </p>
          </div>
          <Button
            variant="secondary"
            loading={busy === "cancel"}
            onClick={() => run("cancel", cancelAccountDeletion).then((r) => {
              if (r?.ok) showToast("Deletion cancelled — your account is active again.");
            })}
          >
            Cancel deletion
          </Button>
        </div>
      ) : (
        <>
          {/* ── Freeze ─────────────────────────────────────────────────────── */}
          <div className={"danger-row" + (frozen ? " danger-row-active" : "")}>
            <div className="danger-row-body">
              <div className="danger-row-head">
                {frozen ? "This account is frozen" : "Freeze this account"}
              </div>
              <p className="danger-row-desc">
                {frozen ? (
                  <>
                    Nobody on this account — you or any team member — can run
                    extractions, enrichments or discoverability audits. Reading and
                    exporting still work. <b>Billing is unaffected and continues
                    as normal.</b>
                  </>
                ) : (
                  <>
                    Stops everything that consumes usage — extractions, enrichments
                    and discoverability audits — for you and every team member.
                    Reading and exporting keep working, and you can unfreeze at any
                    time. <b>Your subscription continues to be charged.</b>
                  </>
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              loading={busy === "freeze"}
              onClick={() => run("freeze", () => (frozen ? unfreezeAccount() : freezeAccount("user_requested")))
                .then((r) => { if (r?.ok) showToast(frozen ? "Account unfrozen." : "Account frozen."); })}
            >
              {frozen ? "Unfreeze account" : "Freeze account"}
            </Button>
          </div>

          {/* ── Delete ─────────────────────────────────────────────────────── */}
          <div className="danger-row danger-row-destructive">
            <div className="danger-row-body">
              <div className="danger-row-head">Delete this account</div>
              <p className="danger-row-desc">
                Permanently deletes your account and everything in it — extractions,
                audits, schedules, workspaces and team members. Cancellable any time
                before the date below. Invoices are kept, because we are required to
                keep them.
              </p>
              {hasActivePaidPlan ? (
                <p className="danger-row-desc">
                  Your <b>{planLabel}</b> plan is active until{" "}
                  <b>{formatDate(state.periodEnd)}</b>. If you delete your account
                  now, it will remain active until then and be permanently removed
                  on <b>{formatDate(previewPurgeAt)}</b>.
                </p>
              ) : (
                <p className="danger-row-desc">
                  Scheduled for <b>{formatDate(previewPurgeAt)}</b> ({DEFAULT_GRACE_DAYS} days out).
                </p>
              )}

              {showDelete && (
                <div className="danger-confirm">
                  <p className="danger-row-desc">
                    Your account will be deleted on <b>{formatDate(previewPurgeAt)}</b>.
                    You can cancel any time before then from this page.
                  </p>
                  <label className="danger-confirm-label" htmlFor="danger-confirm-input">
                    Type <b>{DELETE_CONFIRMATION}</b> to confirm
                  </label>
                  <input
                    id="danger-confirm-input"
                    className="danger-confirm-input"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={DELETE_CONFIRMATION}
                  />
                </div>
              )}
            </div>

            {showDelete ? (
              <div className="danger-row-actions">
                <Button
                  variant="ghost"
                  onClick={() => { setShowDelete(false); setConfirmText(""); }}
                >
                  Keep my account
                </Button>
                <Button
                  variant="danger"
                  disabled={confirmText !== DELETE_CONFIRMATION}
                  loading={busy === "delete"}
                  onClick={() => run("delete", () => requestAccountDeletion(confirmText)).then((r) => {
                    if (r?.ok) {
                      setShowDelete(false);
                      setConfirmText("");
                      showToast("Deletion scheduled. You can cancel it any time in the next 30 days.");
                    }
                  })}
                >
                  Schedule deletion
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setShowDelete(true)}>
                Delete account…
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
