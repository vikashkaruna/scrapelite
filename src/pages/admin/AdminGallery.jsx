// AdminGallery.jsx — the human-verification gate for the public gallery.
//
// Every report here was already shared publicly by its user (public_reports,
// is_public=true) — this screen doesn't publish anything new. It exists so an
// admin can actually LOOK at a report's rendered content before tagging it
// with a persona and promoting it into the curated showcase on /gallery.
// "Preview" renders PublicReportArticle — the exact component the public
// /p/:slug page uses — so what's reviewed here is what a visitor will see,
// not a separate approximation of it.

import { useEffect, useState } from "react";
import {
  fetchGalleryReports, curateGalleryReport, uncurateGalleryReport,
} from "../../lib/adminConfigService.js";
import { PERSONAS, PERSONA_BY_ID } from "../../lib/personaConfig.js";
import PublicReportArticle from "../../components/PublicReportArticle.jsx";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";
import { buildPublicUrl } from "../../lib/shareService.js";

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function ReportRow({ report, onCurated, onUncurated }) {
  const [expanded, setExpanded] = useState(false);
  const [persona, setPersona] = useState(report.persona || "");
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  async function handleCurate() {
    if (!persona) { showToast("Pick a persona first."); return; }
    setBusy(true);
    try {
      await curateGalleryReport(report.id, persona);
      showToast(`Curated under "${PERSONA_BY_ID[persona]?.label || persona}".`);
      onCurated(report.id, persona);
    } catch (e) {
      showToast(e.message || "Curate failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUncurate() {
    setBusy(true);
    try {
      await uncurateGalleryReport(report.id);
      showToast("Removed from the showcase — the report itself is still public.");
      onUncurated(report.id);
    } catch (e) {
      showToast(e.message || "Uncurate failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad admin-gallery-row">
      <div className="admin-gallery-row-head">
        <div className="admin-gallery-row-main">
          <div className="admin-gallery-row-title">
            {report.title || report.url}
            {report.curated && (
              <span className="admin-gallery-curated-pill">
                <Icon name="check-circle" size={12} />
                Curated{report.persona ? ` · ${PERSONA_BY_ID[report.persona]?.label || report.persona}` : ""}
              </span>
            )}
          </div>
          <p className="admin-gallery-row-meta">
            <Icon name="globe" size={11} /> {report.url} · {timeAgo(report.created_at)}
            {report.intent ? ` · ${report.intent}` : ""}
          </p>
          {report.slug && (
            <a
              className="admin-gallery-public-link"
              href={buildPublicUrl(report.slug)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={11} /> Open public report
            </a>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide preview" : "Preview"}
        </Button>
      </div>

      {expanded && (
        <div className="admin-gallery-preview">
          <PublicReportArticle ext={report.data} interactive={false} />
        </div>
      )}

      <div className="admin-gallery-row-actions">
        <div className="cf-field admin-gallery-persona-field">
          <select value={persona} onChange={(e) => setPersona(e.target.value)} disabled={busy}>
            <option value="">Choose a persona…</option>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <Button variant="primary" size="sm" onClick={handleCurate} disabled={busy || !persona}>
          {report.curated ? "Update persona" : "Curate"}
        </Button>
        {report.curated && (
          <Button variant="ghost" size="sm" onClick={handleUncurate} disabled={busy}>
            Remove from showcase
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AdminGallery() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [filter, setFilter] = useState("all"); // all | curated | uncurated
  const showToast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchGalleryReports();
      setReports(data.reports || []);
      setWarning(data.warning || "");
    } catch (e) {
      setError(e.message || "Failed to load gallery reports.");
    } finally {
      setLoading(false);
    }
  }

  function patchLocal(id, patch) {
    setReports((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const visible = reports.filter((r) => {
    if (filter === "curated") return r.curated;
    if (filter === "uncurated") return !r.curated;
    return true;
  });
  const coverage = PERSONAS.map((p) => ({
    ...p,
    count: reports.filter((r) => r.curated && r.persona === p.id).length,
  }));

  if (loading) {
    return (
      <div className="admin-section">
        <div className="admin-ai-loading">
          <Icon name="loader" size={18} className="spin" /> Loading shared reports…
        </div>
      </div>
    );
  }

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <div>
          <h2 className="admin-section-title">Gallery curation</h2>
          <p className="admin-section-sub">
            Every report below was already shared publicly by its user — nothing here changes
            that. Preview a report, then tag it with a persona to promote it into the showcase
            on <code>/gallery</code>. Un-curating removes it from the showcase only; the report
            stays shared.
          </p>
        </div>
        <Button variant="ghost" size="sm" icon="refresh" onClick={load}>Reload</Button>
      </div>

      {warning && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-triangle" size={15} /><span>{warning}</span>
        </div>
      )}
      {error && (
        <div className="admin-ai-notice warn">
          <Icon name="alert-circle" size={15} /><span>{error}</span>
        </div>
      )}

      <div className="admin-gallery-coverage" aria-label="Gallery persona coverage">
        {coverage.map((p) => (
          <span key={p.id} className={`admin-gallery-coverage-pill${p.count ? " covered" : " missing"}`}>
            <Icon name={p.count ? "check-circle" : "alert-circle"} size={12} />
            {p.label}: {p.count}
          </span>
        ))}
      </div>

      <div className="admin-gallery-filter-row">
        {[
          { id: "all", label: "All" },
          { id: "curated", label: "Curated" },
          { id: "uncurated", label: "Not yet curated" },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            className={`admin-gallery-filter-btn${filter === f.id ? " active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card card-pad admin-gallery-empty">
          <Icon name="inbox" size={28} />
          <p>No shared reports match this filter yet.</p>
        </div>
      ) : (
        <div className="admin-gallery-list">
          {visible.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              onCurated={(id, persona) => patchLocal(id, { curated: true, persona })}
              onUncurated={(id) => patchLocal(id, { curated: false })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
