// HomeInlineProgress.jsx — inline extraction progress + "Preview" CTA shown
// in the Home page's preview area (just below the hero composer textarea).
//
// Replaces the full-screen LoadingScreen for extractions that start on Home.
// The same four-step indicator is used so the UX is consistent regardless of
// where the user is when the round-trip ends. On completion, the right side
// reveals a "Preview" button styled like the hero composer's "Extract" button.
//
// States:
//   - extracting  → animated orb on the left + step list
//   - completed   → animated orb → checkmark + step list (all done) + Preview button
//   - error       → "Couldn't extract" message + step list with last step marked failed
//
// Used by Home.jsx when `progress` is non-null in the ExtractionContext.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

const STEPS = [
  "Fetching webpage",
  "Parsing structure",
  "Extracting links",
  "Summarizing with AI",
];

/**
 * Render the inline progress card. The parent decides visibility — this
 * component just renders whatever `progress` state is passed in.
 *
 * @param progress  null | { url, step, completed, error }
 * @param onPreview clicked the Preview button — parent usually navigates
 * @param onRetry   clicked the "Try again" button in the error state
 */
export default function HomeInlineProgress({ progress, onPreview, onRetry }) {
  const navigate = useNavigate();
  // While the extraction is in flight, auto-advance the active step on a
  // timer so the indicator doesn't sit on "Fetching webpage" for 6 seconds
  // if the network call is slow. The provider sets step=2 when the structure
  // returns, so this only fills the gap between 0→1 and 1→2.
  const [autoStep, setAutoStep] = useState(0);
  useEffect(() => {
    if (!progress || progress.completed || progress.error) return;
    setAutoStep(0);
    const t1 = setTimeout(() => setAutoStep(1), 700);
    const t2 = setTimeout(() => setAutoStep(2), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [progress?.url, progress?.completed, progress?.error]);

  if (!progress) return null;

  const { url, step, completed, error } = progress;
  // Provider-set step wins once it's past 2 (so we don't show "Parsing" while
  // the AI is summarizing). Otherwise fall back to the auto-advanced step.
  const activeStep = Math.max(step, autoStep);

  return (
    <div
      className={
        "home-inline-progress" +
        (completed ? " is-completed" : "") +
        (error ? " is-error" : "")
      }
      role="status"
      aria-live="polite"
    >
      <div className="home-inline-progress-orb" aria-hidden="true">
        {completed ? (
          <Icon name="check" size={20} strokeWidth={2.5} />
        ) : error ? (
          <Icon name="alert-triangle" size={20} strokeWidth={2.5} />
        ) : (
          <>
            <div className="spinner" style={{ "--sp-size": "30px", borderWidth: "2.5px" }} />
            <Icon name="layers" size={16} className="home-inline-progress-orb-icon" />
          </>
        )}
      </div>

      <div className="home-inline-progress-body">
        <div className="home-inline-progress-title">
          {error
            ? "Couldn't extract this page"
            : completed
            ? "Ready to preview"
            : "Extracting…"}
        </div>
        <div className="home-inline-progress-url" title={url}>
          <Icon name="globe" size={12} />
          <span>{url}</span>
        </div>

        {!error && (
          <ul className="home-inline-progress-steps" aria-label="Extraction steps">
            {STEPS.map((s, i) => {
              const done = completed || i < activeStep;
              const active = !completed && i === activeStep;
              return (
                <li
                  key={s}
                  className={
                    "home-inline-progress-step" +
                    (done ? " is-done" : "") +
                    (active ? " is-active" : "")
                  }
                >
                  <span className="home-inline-progress-dot">
                    {done ? (
                      <Icon name="check" size={10} strokeWidth={3} />
                    ) : active ? (
                      <span
                        className="spinner"
                        style={{ "--sp-size": "11px", borderWidth: "1.6px" }}
                      />
                    ) : (
                      <span className="home-inline-progress-dot-idle" />
                    )}
                  </span>
                  <span>{s}</span>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <div className="home-inline-progress-error">
            {error}
          </div>
        )}
      </div>

      <div className="home-inline-progress-action">
        {error ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onRetry}
            style={{ justifyContent: "center" }}
          >
            <Icon name="rotate-cw" size={14} />
            Try again
          </button>
        ) : completed ? (
          <button
            type="button"
            className="btn btn-primary btn-sm home-inline-progress-preview-btn"
            onClick={() => (onPreview ? onPreview() : navigate("/preview"))}
            style={{ justifyContent: "center" }}
          >
            <Icon name="arrow-right" size={14} />
            Preview
          </button>
        ) : null}
      </div>
    </div>
  );
}
