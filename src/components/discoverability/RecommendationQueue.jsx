// RecommendationQueue.jsx — the action queue.
//
// The difference between a report and a tool. Every row carries who does it,
// what it costs, what it is worth, and — where one exists — something the user
// can copy and paste.

import { useState } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { copyTextToClipboard } from "../../lib/utils.js";
import { useToast } from "../Toast.jsx";
import { hasPlaceholders } from "../../lib/discoverability/constructTemplates.js";

const OWNER_META = {
  content:     { label: "Content", icon: "file-text" },
  seo:         { label: "SEO", icon: "scan-search" },
  engineering: { label: "Engineering", icon: "file-code" },
  brand:       { label: "Brand", icon: "fingerprint" },
  product:     { label: "Product", icon: "shopping-bag" },
};

const STATUS_LABEL = { open: "Open", accepted: "Accepted", dismissed: "Dismissed", done: "Done" };

function ConstructBlock({ asset }) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  if (!asset?.body) return null;
  const draft = hasPlaceholders(asset);

  return (
    <div className="dsc-construct">
      <button type="button" className="dsc-construct-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
        <Icon name="file-code" size={14} />
        {asset.label}
        {draft && (
          // The badge is not decoration. These blocks are pasted into live
          // sites; anything we could not observe is a TODO the author must
          // fill, and shipping it unread would publish a placeholder.
          <span className="dsc-construct-draft" title="Contains TODO placeholders for details this audit could not observe. Fill them in before publishing.">
            needs your details
          </span>
        )}
      </button>
      {open && (
        <div className="dsc-construct-body">
          {asset.note && <p className="dsc-construct-note">{asset.note}</p>}
          <pre className="dsc-construct-pre"><code>{asset.body}</code></pre>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              const ok = await copyTextToClipboard(asset.body);
              showToast(ok ? "Copied to clipboard" : "Could not copy — select and copy manually");
            }}
          >
            <Icon name="clipboard-copy" size={14} /> Copy
          </Button>
        </div>
      )}
    </div>
  );
}

function DismissDialog({ rec, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length > 0;
  return (
    <div className="dsc-dismiss">
      <label htmlFor={`dismiss-${rec.id}`} className="dsc-dismiss-label">
        Why are you dismissing this?
      </label>
      <input
        id={`dismiss-${rec.id}`}
        className="dsc-dismiss-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Deliberate — this page is intentionally not indexed"
        autoFocus
      />
      <p className="dsc-dismiss-hint">
        Required. Three months from now a dismissal with no reason is
        indistinguishable from a mis-click.
      </p>
      <div className="dsc-dismiss-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="danger" disabled={!valid} onClick={() => onConfirm(reason.trim())}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export default function RecommendationQueue({
  recommendations = [], framework = "overall", onStatusChange, busyId,
}) {
  const [dismissing, setDismissing] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  const owners = [...new Set(recommendations.map((r) => r.owner).filter(Boolean))];

  let shown = recommendations;
  if (framework && framework !== "overall") {
    shown = shown.filter((r) => (r.frameworks || []).includes(framework) || (r.frameworks || []).includes("common"));
  }
  if (ownerFilter) shown = shown.filter((r) => r.owner === ownerFilter);
  if (!showResolved) shown = shown.filter((r) => r.status === "open" || !r.status);

  const openCount = recommendations.filter((r) => r.status === "open" || !r.status).length;

  if (recommendations.length === 0) {
    return (
      <div className="dsc-empty dsc-empty-good">
        <Icon name="check-circle" size={22} />
        <p>Nothing outstanding. This page is doing what it can with the signals we could measure.</p>
      </div>
    );
  }

  return (
    <div className="dsc-queue">
      <div className="dsc-queue-filters">
        <span className="dsc-queue-count">{openCount} open</span>
        {owners.map((o) => (
          <button
            key={o}
            type="button"
            className={`dsc-owner-chip${ownerFilter === o ? " dsc-owner-chip-on" : ""}`}
            onClick={() => setOwnerFilter(ownerFilter === o ? null : o)}
            aria-pressed={ownerFilter === o}
          >
            <Icon name={OWNER_META[o]?.icon || "user-circle"} size={13} />
            {OWNER_META[o]?.label || o}
          </button>
        ))}
        <label className="dsc-queue-toggle">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="dsc-muted">Nothing matches this filter.</p>
      ) : (
        <ol className="dsc-queue-list">
          {shown.map((r) => {
            const resolved = r.status && r.status !== "open";
            return (
              <li
                key={r.id || r.code}
                className={`dsc-rec${resolved ? " dsc-rec-resolved" : ""}${r.blockedBy && !resolved ? " dsc-rec-blocked-row" : ""}`}
              >
                <div className="dsc-rec-main">
                  <span className={`dsc-priority dsc-priority-${r.priority}`}>{r.priority}</span>
                  <div className="dsc-rec-text">
                    <p className="dsc-rec-title">{r.title}</p>
                    {r.issueTitle && <p className="dsc-rec-issue">{r.issueTitle}</p>}
                    {r.evidence && <p className="dsc-rec-evidence">{r.evidence}</p>}
                    {r.rationale && <p className="dsc-rec-why">{r.rationale}</p>}
                  </div>
                </div>

                <div className="dsc-rec-meta">
                  <span className="dsc-rec-chip">
                    <Icon name={OWNER_META[r.owner]?.icon || "user-circle"} size={12} />
                    {OWNER_META[r.owner]?.label || r.owner || "—"}
                  </span>
                  {Number.isFinite(r.estimatedLift) && r.estimatedLift > 0 && (
                    <span className="dsc-rec-chip" title="Estimated score points recovered by this fix, including any blocker it clears. Signals interact, so treat it as an upper bound.">
                      <Icon name="trending-up" size={12} /> up to +{r.estimatedLift}
                    </span>
                  )}
                  <span className="dsc-rec-chip" title="Relative effort, not hours.">
                    effort {r.effortScore ?? "—"}/100
                  </span>
                  <span className="dsc-rec-chip" title="How certain we are this finding is correct. Anything a model inferred sits lower than a measured fact.">
                    confidence {r.confidenceScore ?? "—"}%
                  </span>
                  {(r.frameworks || []).map((f) => (
                    <span key={f} className="dsc-rec-fw">{f.toUpperCase()}</span>
                  ))}
                  {resolved && <span className="dsc-rec-status">{STATUS_LABEL[r.status]}</span>}
                </div>

                {r.blockedBy && !resolved && (
                  // Without this, a blocked item looks like ordinary work and
                  // somebody spends an afternoon writing an answer block that
                  // no non-rendering crawler will ever see.
                  <p className="dsc-rec-blocked">
                    <Icon name="alert-circle" size={13} />
                    Waiting on <strong>{r.blockedBy}</strong> — this fix cannot pay off until that is resolved.
                  </p>
                )}

                <ConstructBlock asset={r.implementationAsset} />

                {dismissing === r.id ? (
                  <DismissDialog
                    rec={r}
                    onCancel={() => setDismissing(null)}
                    onConfirm={(reason) => { setDismissing(null); onStatusChange?.(r, "dismissed", reason); }}
                  />
                ) : (
                  <div className="dsc-rec-actions">
                    {!resolved && (
                      <>
                        <Button size="sm" variant="secondary" loading={busyId === r.id}
                          onClick={() => onStatusChange?.(r, "accepted")}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onStatusChange?.(r, "done")}>
                          Mark done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDismissing(r.id)}>
                          Dismiss
                        </Button>
                      </>
                    )}
                    {resolved && (
                      <Button size="sm" variant="ghost" onClick={() => onStatusChange?.(r, "open")}>
                        Reopen
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
