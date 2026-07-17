// src/components/FeedbackWidget.jsx — Q5 (thumbs up/down) UI.
//
// Two-button widget with optional freeform comment. Records feedback to
// Supabase (fallback localStorage) and re-renders to show the user's
// current selection.

import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { submitFeedback, getLocalFeedback } from "../lib/feedbackService.js";

export default function FeedbackWidget({ extractionId, url, intent, disabled = false }) {
  const [fb, setFb] = useState(() => getLocalFeedback(extractionId));
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  // Sync comment text with the saved record on first open.
  useEffect(() => {
    if (open && fb?.comment) setComment(fb.comment);
  }, [open, fb?.comment]);

  if (!extractionId) return null;

  const handle = async (rating) => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const { feedback } = await submitFeedback({ extractionId, rating, comment: open ? comment : "" }, { url, intent });
      setFb(feedback);
      // Toggle comment box on first interaction; close after second click on the same rating.
      if (rating !== 0 && (open === false)) {
        // Always open the comment box on the user's first non-zero tap so they
        // can elaborate. They can dismiss it without saving.
        setOpen(true);
      }
    } catch (err) {
      if (typeof console !== "undefined") console.warn("[DatIQ feedback] submit failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Rating 0 is treated as "clear my vote" by the local mirror + DB upsert.
      const { feedback } = await submitFeedback({ extractionId, rating: 0, comment: "" }, { url, intent });
      setFb(feedback);
      setOpen(false);
      setComment("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"feedback-widget" + (fb ? " feedback-submitted" : "") + (open ? " feedback-open" : "")}>
      <div className="feedback-row">
        <span className="feedback-label">
          <Icon name="info" size={11} />
          Was this summary helpful?
        </span>
        <div className="feedback-buttons" role="group" aria-label="Rate this AI summary">
          <button
            type="button"
            className={"feedback-btn" + (fb?.rating === 1 ? " active up" : "")}
            onClick={() => handle(fb?.rating === 1 ? 0 : 1)}
            disabled={busy || disabled}
            aria-pressed={fb?.rating === 1}
            aria-label="Thumbs up"
            title="Helpful"
          >
            <Icon name="thumbs-up" size={14} />
            <span className="sr-only">Helpful</span>
          </button>
          <button
            type="button"
            className={"feedback-btn" + (fb?.rating === -1 ? " active down" : "")}
            onClick={() => handle(fb?.rating === -1 ? 0 : -1)}
            disabled={busy || disabled}
            aria-pressed={fb?.rating === -1}
            aria-label="Thumbs down"
            title="Not helpful"
          >
            <Icon name="thumbs-down" size={14} />
            <span className="sr-only">Not helpful</span>
          </button>
        </div>
        {fb && (
          <button
            type="button"
            className="feedback-clear"
            onClick={handleClear}
            disabled={busy}
            title="Clear your feedback"
          >
            <Icon name="x" size={11} />
            Clear
          </button>
        )}
        {fb && !open && (
          <button
            type="button"
            className="feedback-comment-toggle"
            onClick={() => setOpen(true)}
            disabled={busy}
          >
            {fb.comment ? "Edit comment" : "Add a comment"}
          </button>
        )}
      </div>
      {open && (
        <div className="feedback-comment">
          <textarea
            rows={2}
            placeholder="Tell us what was off (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            aria-label="Feedback comment"
          />
          <div className="feedback-comment-actions">
            <span className="feedback-comment-count">{comment.length}/2000</span>
            <button
              type="button"
              className="feedback-comment-save"
              onClick={() => handle(fb?.rating || 1)}
              disabled={busy}
            >
              <Icon name="check" size={12} /> Save
            </button>
            <button
              type="button"
              className="feedback-comment-cancel"
              onClick={() => { setOpen(false); setComment(fb?.comment || ""); }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
