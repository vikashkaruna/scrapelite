// ExtractionProgressDock.jsx — a compact, NON-BLOCKING progress panel for
// background work. Rendered once, globally, in the Shell (outside <main>), it
// floats bottom-right and lets the user keep working — scroll, type, navigate —
// while an extraction runs.
//
// It handles BOTH job kinds so there is one progress surface in the product:
//
//   • Single extraction — stepped progress (Fetching → Parsing → Links → AI).
//     The steps are cosmetic pacing; a single scrape reports no real progress.
//   • Batch run — "Extracting 3 / 12 URLs…" with a REAL percentage from
//     completed/total, plus Cancel. /batch used to render its own in-page bar
//     with its own Cancel button, which meant leaving the page hid the run's
//     progress entirely (and, before the run was lifted into BatchRunProvider,
//     abandoned the run itself).
//
// Done state offers a way back to the result, and is only shown when the user
// has navigated away from wherever they launched it.
import { useExtraction } from "./ExtractionProvider.jsx";
import { useBatchRun } from "./BatchRunProvider.jsx";
import { useTemplateRun } from "./TemplateRunProvider.jsx";
import Icon from "./Icon.jsx";

const STEPS = ["Fetching webpage", "Parsing structure", "Extracting links", "Summarizing with AI"];

function DockShell({ done, title, subtitle, subtitleIcon, pct, footer, onDismiss, children }) {
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
          <div className="extract-dock-title">{title}</div>
          <div className="extract-dock-url" title={subtitle}>
            <Icon name={subtitleIcon} size={12} /> {subtitle}
          </div>
        </div>
        <button type="button" className="extract-dock-x" onClick={onDismiss} aria-label="Dismiss">
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
          {children}
        </>
      )}

      {footer}
    </div>
  );
}

export default function ExtractionProgressDock() {
  const { job, dismissJob, viewJob } = useExtraction();
  const batch = useBatchRun();
  const batchJob = batch?.job;
  const tpl = useTemplateRun();
  const tplJob = tpl?.job;

  // A batch run takes precedence: it's the longer-lived job, and the two can
  // only overlap if the user launched a single extraction mid-batch.
  if (batchJob) {
    const done = batchJob.status === "done";
    const pct = batchJob.total ? Math.round((batchJob.completed / batchJob.total) * 100) : 0;
    return (
      <DockShell
        done={done}
        title={done
          ? `Batch complete — ${batchJob.successCount} of ${batchJob.total}`
          : `Extracting ${batchJob.completed} / ${batchJob.total} URLs…`}
        subtitle={done
          ? (batchJob.failedCount ? `${batchJob.failedCount} failed` : "All URLs succeeded")
          : (batchJob.current || "Starting…")}
        subtitleIcon={done ? "layers-2" : "globe"}
        pct={pct}
        onDismiss={batch.clearBatchRun}
        footer={done && (
          <div className="extract-dock-actions">
            <button type="button" className="extract-dock-view" onClick={batch.viewBatchRun}>
              View results <Icon name="arrow-right" size={14} />
            </button>
          </div>
        )}
      >
        <div className="extract-dock-step extract-dock-step-row">
          <span>
            <Icon name="loader" size={12} className="spin" />
            {batchJob.completed} of {batchJob.total} done
          </span>
          <button type="button" className="extract-dock-cancel" onClick={batch.cancelBatchRun}>
            Cancel
          </button>
        </div>
      </DockShell>
    );
  }

  // A template run reports here too, so the product has ONE progress surface
  // for every long-running job rather than three visual languages for the same
  // shape of work. Its percent is REAL — executeRun() emits stage progress —
  // so unlike the single-extraction branch the bar is not cosmetic pacing.
  if (tplJob) {
    const done = tplJob.status === "done" || tplJob.status === "error";
    const failed = tplJob.status === "error";
    return (
      <DockShell
        done={done}
        title={failed ? "Template run failed" : done ? "Template run complete" : `Running ${tplJob.title || "template"}…`}
        subtitle={tplJob.message || "Working…"}
        subtitleIcon={failed ? "alert-circle" : done ? "check" : "layers-2"}
        pct={tplJob.percent || 0}
        onDismiss={tpl.clearTemplateRun}
        footer={done && !failed && (
          <div className="extract-dock-actions">
            <button type="button" className="extract-dock-view" onClick={tpl.viewTemplateRun}>
              View report <Icon name="arrow-right" size={14} />
            </button>
          </div>
        )}
      >
        <div className="extract-dock-step extract-dock-step-row">
          <span>
            <Icon name="loader" size={12} className="spin" />
            {tplJob.percent || 0}%
          </span>
        </div>
      </DockShell>
    );
  }

  if (!job) return null;

  const done = job.status === "done";
  const pct = done ? 100 : Math.round(((job.phase + 1) / STEPS.length) * 100);

  return (
    <DockShell
      done={done}
      title={done ? "Extraction ready" : "Extracting…"}
      subtitle={job.url}
      subtitleIcon="globe"
      pct={pct}
      onDismiss={dismissJob}
      footer={done && (
        <div className="extract-dock-actions">
          <button type="button" className="extract-dock-view" onClick={viewJob}>
            View extraction <Icon name="arrow-right" size={14} />
          </button>
        </div>
      )}
    >
      <div className="extract-dock-step">
        <Icon name="loader" size={12} className="spin" />
        {STEPS[job.phase] || STEPS[STEPS.length - 1]}
      </div>
    </DockShell>
  );
}
