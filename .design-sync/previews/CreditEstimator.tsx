import { CreditEstimator } from "datiq";

// CreditEstimator is pure-props — it never touches context or localStorage,
// it just renders whatever `estimate` shape src/lib/creditEstimator.js's
// estimateCredits() produces. Rather than re-deriving that logic loosely,
// each mock below matches the exact fields + tone rules the real function
// computes (see creditEstimator.js's DEFAULT_LIMITS + tone thresholds), so
// these are the numbers the real component would actually receive from a
// Home/Batch pre-flight check.

export function OkBatchRun() {
  return (
    <CreditEstimator
      estimate={{
        required: 12,
        remaining: 459,
        afterRun: 447,
        allowed: true,
        planId: "select",
        planName: "Select",
        reason: null,
        overage: 0,
        message: "12 of 459 remaining will be used",
        tone: "ok",
        isUnlimited: false,
      }}
    />
  );
}

export function WarnNearingLimit() {
  return (
    <CreditEstimator
      estimate={{
        required: 48,
        remaining: 60,
        afterRun: 12,
        allowed: true,
        planId: "pro",
        planName: "Pro",
        reason: null,
        overage: 0,
        message: "48 of 60 remaining — 12 will be left after this run",
        tone: "warn",
        isUnlimited: false,
      }}
    />
  );
}

export function BlockedOverQuota() {
  return (
    <CreditEstimator
      estimate={{
        required: 6,
        remaining: 3,
        afterRun: 3,
        allowed: false,
        planId: "free",
        planName: "Free",
        reason:
          "You need 6 extractions but only 3 remain this month on Free. Upgrade or purchase a top-up bundle.",
        overage: 3,
        message: "Blocked — 3 remaining, 6 needed",
        tone: "block",
        isUnlimited: false,
      }}
    />
  );
}

export function CompactOk() {
  return (
    <CreditEstimator
      compact
      estimate={{
        required: 5,
        remaining: 50,
        afterRun: 45,
        allowed: true,
        planId: "go",
        planName: "Go",
        reason: null,
        overage: 0,
        message: "5 of 50 remaining will be used",
        tone: "ok",
        isUnlimited: false,
      }}
    />
  );
}

export function CompactWarn() {
  return (
    <CreditEstimator
      compact
      estimate={{
        required: 35,
        remaining: 40,
        afterRun: 5,
        allowed: true,
        planId: "select",
        planName: "Select",
        reason: null,
        overage: 0,
        message: "35 of 40 remaining — 5 will be left after this run",
        tone: "warn",
        isUnlimited: false,
      }}
    />
  );
}
