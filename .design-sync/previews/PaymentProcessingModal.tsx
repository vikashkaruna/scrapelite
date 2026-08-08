import { createPortal } from "react-dom";
import { PaymentProcessingModal } from "datiq";

// PAYMENT_STAGE values, mirrored from src/lib/paymentService.js (stable string
// literals — preparing / verifying / activating / cancelled / error).

// PaymentProcessingModal renders its own `position: fixed` backdrop inline
// (no portal). The preview harness's single-story wrapper (#r0.ds-single)
// establishes a new containing block for fixed-position descendants, which
// traps the full-viewport overlay inside that small wrapper box instead of
// the real viewport. Portaling the story's render to document.body sidesteps
// the harness artifact — this mirrors how sibling modals in this codebase
// (PlanChangeWarning.jsx, InvoiceModal.jsx) already render via
// createPortal(..., document.body) for the same reason.
const portal = (node: React.ReactNode) => createPortal(node, document.body);

export function Preparing() {
  return portal(
    <PaymentProcessingModal
      stage="preparing"
      stageMsg="Creating your checkout session…"
      planName="Pro"
      onRetry={() => {}}
      onCancel={() => {}}
    />
  );
}

export function Verifying() {
  return portal(
    <PaymentProcessingModal
      stage="verifying"
      stageMsg="Verifying your payment…"
      planName="Business"
      onRetry={() => {}}
      onCancel={() => {}}
    />
  );
}

export function Activating() {
  return portal(
    <PaymentProcessingModal
      stage="activating"
      stageMsg="Activating your plan…"
      planName="Agency"
      onRetry={() => {}}
      onCancel={() => {}}
    />
  );
}

export function PaymentFailed() {
  return portal(
    <PaymentProcessingModal
      stage="error"
      stageMsg="Your card was declined by the issuing bank. No amount has been charged."
      planName="Pro"
      onRetry={() => {}}
      onCancel={() => {}}
    />
  );
}

export function PaymentCancelled() {
  return portal(
    <PaymentProcessingModal
      stage="cancelled"
      stageMsg="Payment cancelled — no charge was made."
      planName="Select"
      onRetry={() => {}}
      onCancel={() => {}}
    />
  );
}
