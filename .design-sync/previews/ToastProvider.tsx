import { ToastProvider, useToast } from "datiq";
import { useEffect } from "react";

// ToastProvider renders nothing itself — the toast only appears once a
// descendant calls useToast(). Both are now re-exported from the bundle
// entry, so this trigger child calls the hook on mount to produce a real,
// visible toast — the composition a DS author would actually write, per
// the "compose context-required leaves inside their parent" rule.
//
// The real .toast rule is `position:fixed; bottom:28px` (screens.css:470) —
// same containing-block trap as the fixed-position modals in this project
// (see NOTES.md): the capture harness's `.ds-single{transform:translateZ(0)}`
// wrapper becomes the containing block, so `bottom:28px` resolves against a
// near-zero-height box instead of the real viewport and the toast renders
// off the top edge instead of near the bottom. Neutralized the same way.
function ResetCaptureTransform() {
  return <style>{".ds-single{transform:none!important}"}</style>;
}

function TriggerSuccessToast() {
  const showToast = useToast();
  useEffect(() => {
    showToast("Saved to Dashboard");
  }, [showToast]);
  return null;
}

function TriggerCustomIconToast() {
  const showToast = useToast();
  useEffect(() => {
    showToast("Schedule paused", "pause");
  }, [showToast]);
  return null;
}

export function SuccessToast() {
  return (
    <ToastProvider>
      <ResetCaptureTransform />
      <TriggerSuccessToast />
    </ToastProvider>
  );
}

export function CustomIconToast() {
  return (
    <ToastProvider>
      <ResetCaptureTransform />
      <TriggerCustomIconToast />
    </ToastProvider>
  );
}
