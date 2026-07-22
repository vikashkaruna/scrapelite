// ExtractionProgressDock.jsx — a compact, NON-BLOCKING progress panel for a
// single background extraction.
//
// It replaces the old full-screen LoadingScreen that blanked the entire app
// while an extraction ran. Rendered once, globally, in the Shell (outside
// <main>), it floats bottom-right and lets the user keep working — scroll,
// type, navigate — while the extraction runs in the background.
//
//   • Running → stepped progress (Fetching → Parsing → Links → AI) + the URL.
//   • Done (only shown if the user navigated away from the launch page) →
//     a "View extraction" button that opens /preview, plus a dismiss control.
import { useExtraction } from "./ExtractionProvider.jsx";
import Icon from "./Icon.jsx";

const STEPS = ["Fetching webpage", "Parsing structure", "Extracting links", "Summarizing with AI"];

export default function ExtractionProgressDock() {
  const { job, dismissJob, viewJob } = useExtraction();
  if (!job) return null;

  const done = job.status === "done";
  const pct = done ? 100 : Math.round(((job.phase + 1) / STEPS.length) * 100);

  return (
    <div
      className={"extract-dock" + (done ? " extract-dock-done" : "")}
      role="status"
      aria-live="polite"
    >
      <div className="extract-dock-top">
        <div className="extract-dock-orb">
          {done ? (
            <Icon name="check" size={16} strokeWidth={3} />
          ) : (
            <span className="spinner" style={{ "--sp-size": "18px", borderWidth: "2.5px" }} />
          )}
        </div>
        <div className="extract-dock-head">
          <div className="extract-dock-title">
            {done ? "Extraction ready" : "Extracting…"}
          </div>
          <div className="extract-dock-url" title={job.url}>
            <Icon name="globe" size={12} /> {job.url}
          </div>
        </div>
        <button
          type="button"
          className="extract-dock-x"
          onClick={dismissJob}
          aria-label="Dismiss"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      {!done && (
        <>
          <div className="extract-dock-bar-wrap">
            <div
              className="extract-dock-bar"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="extract-dock-step">
            <Icon name="loader" size={12} className="spin" />
            {STEPS[job.phase] || STEPS[STEPS.length - 1]}
          </div>
        </>
      )}

      {done && (
        <div className="extract-dock-actions">
          <button type="button" className="extract-dock-view" onClick={viewJob}>
            View extraction <Icon name="arrow-right" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
