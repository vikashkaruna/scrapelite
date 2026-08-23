// ErrorModal.jsx — friendly error popup with a collapsible technical-details panel.
//
// Usage anywhere in the tree:
//   const showError = useErrorModal();
//   showError(err);                          // auto-classified
//   showError(err, SAVE_ERROR);              // override title/message
//   showError(err, SAVE_ERROR, retryFn);     // show "Try again" button

import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { classifyError, formatDetail } from "../lib/errorMessages.js";
import Icon from "./Icon.jsx";
import Button from "./Button.jsx";

// ── Context ───────────────────────────────────────────────────────────────────
const ErrorModalContext = createContext(() => {});

export function useErrorModal() {
  return useContext(ErrorModalContext);
}

// ── Modal UI ──────────────────────────────────────────────────────────────────
function ErrorModal({ title, message, detail, onClose, onRetry, action }) {
  const [showDetail, setShowDetail] = useState(false);

  // Trap keyboard: Escape closes, Tab stays inside.
  const onKeyDown = (e) => {
    if (e.key === "Escape") onClose();
  };

  return createPortal(
    <div
      className="error-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="err-title"
      onKeyDown={onKeyDown}
      onClick={onClose}
    >
      <div
        className="error-modal card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          className="btn btn-ghost btn-icon btn-sm error-close"
          onClick={onClose}
          aria-label="Close error"
        >
          <Icon name="x" size={17} />
        </button>

        {/* Icon */}
        <div className="error-icon-wrap">
          <Icon name="alert-triangle" size={26} strokeWidth={2} />
        </div>

        {/* Copy */}
        <div className="error-body">
          <h2 className="error-title" id="err-title">{title}</h2>
          <p className="error-message">{message}</p>
        </div>

        {/* Technical details toggle */}
        {detail && (
          <div className="error-detail-section">
            <button
              className="error-detail-toggle"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
            >
              <Icon
                name={showDetail ? "chevron-down" : "chevron-right"}
                size={13}
                strokeWidth={2.5}
              />
              {showDetail ? "Hide" : "Show"} technical details
            </button>
            {showDetail && (
              <pre className="error-detail-pre scroll-y">{detail}</pre>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="error-actions">
          <Button variant="secondary" onClick={onClose}>
            {onRetry || action ? "Dismiss" : "Close"}
          </Button>
          {/* A message that tells the user what to do needs a way to do it.
              The compliance refusal for a signed-out visitor says "sign in and
              DatIQ can record that" — without this button that was a dead end,
              since the only control was Close. */}
          {action && (
            <Button variant="primary" icon={action.icon || "arrow-right"} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {onRetry && !action && (
            <Button variant="primary" icon="arrow-right" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function ErrorModalProvider({ children }) {
  const [modal, setModal] = useState(null);

  /**
   * Show the error modal.
   * @param {Error|string} error  — the raw caught error
   * @param {{ title?: string, message?: string }} [override]  — friendly copy override
   * @param {() => void} [onRetry]  — if provided, shows a "Try again" button
   */
  const showError = useCallback((error, override = {}, onRetry = null) => {
    const classified = classifyError(error);
    setModal({
      title: override.title || classified.title,
      message: override.message || classified.message,
      detail: formatDetail(error),
      onRetry,
      // { label, icon?, onClick } — a primary action for messages that tell the
      // user what to do next. Takes the place of "Try again", which is wrong for
      // anything that cannot succeed on a retry.
      action: override.action || null,
    });
  }, []);

  const close = useCallback(() => setModal(null), []);

  const handleRetry = modal?.onRetry
    ? () => {
        close();
        // Small delay so the modal unmounts before the retry kicks off.
        setTimeout(modal.onRetry, 80);
      }
    : null;

  return (
    <ErrorModalContext.Provider value={showError}>
      {children}
      {modal && (
        <ErrorModal
          title={modal.title}
          message={modal.message}
          detail={modal.detail}
          action={modal.action ? {
            ...modal.action,
            // Close first so the auth modal (or whatever the action opens) is
            // not stacked underneath this one.
            onClick: () => { close(); setTimeout(modal.action.onClick, 80); },
          } : null}
          onClose={close}
          onRetry={handleRetry}
        />
      )}
    </ErrorModalContext.Provider>
  );
}
