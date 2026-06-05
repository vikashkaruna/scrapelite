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
function ErrorModal({ title, message, detail, onClose, onRetry }) {
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
            {onRetry ? "Dismiss" : "Close"}
          </Button>
          {onRetry && (
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
          onClose={close}
          onRetry={handleRetry}
        />
      )}
    </ErrorModalContext.Provider>
  );
}
