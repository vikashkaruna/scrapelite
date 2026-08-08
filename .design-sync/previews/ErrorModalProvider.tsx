import { ErrorModalProvider, useErrorModal } from "datiq";
import { useEffect } from "react";

// ErrorModalProvider renders nothing itself — it only shows a modal when a
// descendant calls useErrorModal(). Both are now re-exported from the
// bundle entry, so this trigger child calls the hook on mount to produce a
// real, visible error state — the composition a DS author would actually
// write, per the "compose context-required leaves inside their parent" rule.
function TriggerNetworkError() {
  const showError = useErrorModal();
  useEffect(() => {
    showError(
      new Error("Failed to fetch: NetworkError when attempting to reach https://api.datiq.app/extract"),
    );
  }, [showError]);
  return null;
}

function TriggerRetryableError() {
  const showError = useErrorModal();
  useEffect(() => {
    showError(
      new Error("Request timed out after 30s"),
      { title: "Extraction timed out", message: "The page took too long to respond. This sometimes happens on slow or heavily protected sites." },
      () => {},
    );
  }, [showError]);
  return null;
}

export function NetworkError() {
  return (
    <ErrorModalProvider>
      <TriggerNetworkError />
    </ErrorModalProvider>
  );
}

export function RetryableError() {
  return (
    <ErrorModalProvider>
      <TriggerRetryableError />
    </ErrorModalProvider>
  );
}
