// src/pages/Workspace.jsx — Q4 (logged-in → Projects/Lists workspace) page.
//
// "Command center" for signed-in users: recent extractions, active schedules,
// recent batch runs, and quick links to the rest of the app. Replaces the
// marketing home for logged-in users via the redirect in App.jsx.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { readSubscription, readUsage } from "../lib/usageService.js";
import { listExtractions } from "../lib/extractionsRepo.js";
import { listBatchRuns } from "../lib/batchRunsService.js";
import { listSchedules } from "../lib/schedulerService.js";
import WatchlistCard from "../components/WatchlistCard.jsx";

function timeAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function QuickLink({ to, icon, title, desc }) {
  return (
    <Link to={to} className="ws-quick">
      <span className="ws-quick-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="ws-quick-text">
        <span className="ws-quick-title">{title}</span>
        <span className="ws-quick-desc">{desc}</span>
      </span>
      <Icon name="arrow-right" size={14} className="ws-quick-arrow" />
    </Link>
  );
}

export default function Workspace() {
  const { user, userName } = useAuth();
  const { personaId } = usePersona();
  const [usage, setUsage] = useState(() => readUsage());
  const [subscription, setSubscription] = useState(() => readSubscription());
  const [recent, setRecent] = useState([]);
  const [batchRuns, setBatchRuns] = useState([]);
  const [schedules, setSchedules] = useState([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const all = await listExtractions();
        if (!cancel) setRecent(all.slice(0, 5));
      } catch { /* fallback to empty */ }
      try {
        const runs = listBatchRuns();
        if (!cancel) setBatchRuns(runs.slice(0, 3));
      } catch { /* skip */ }
      try {
        const sched = listSchedules();
        if (!cancel) setSchedules((sched || []).slice(0, 3));
      } catch { /* skip */ }
      setUsage(readUsage());
      setSubscription(readSubscription());
    })();
    return () => { cancel = true; };
  }, [user?.id]);

  const greeting = useMemo(() => {
    const name = userName || user?.user_metadata?.name || user?.email?.split("@")[0];
    if (!name) return "Welcome back";
    return `Welcome back, ${name}`;
  }, [userName, user]);

  const planName = subscription?.planId
    ? (subscription.planId === "free" ? "Free" : subscription.planId.charAt(0).toUpperCase() + subscription.planId.slice(1))
    : "Free";

  return (
    <div className="page">
      <div className="container ws-container">
        <header className="ws-head rise">
          <div>
            <span className="ws-eyebrow">
              <Icon name="layout-grid" size={12} />
              Your workspace
            </span>
            <h1 className="ws-title">{greeting}</h1>
            <p className="ws-sub">
              Jump back into your work — {recent.length} recent extraction{recent.length === 1 ? "" : "s"},
              {" "}{batchRuns.length} batch run{batchRuns.length === 1 ? "" : "s"},
              {" "}{schedules.length} active schedule{schedules.length === 1 ? "" : "s"}.
            </p>
          </div>
          <div className="ws-plan-pill" title={`Plan: ${planName}`}>
            <Icon name="shield" size={12} />
            {planName} plan
          </div>
        </header>

        {/* FC1 — Watchlist card (logged-in only) */}
        {schedules.length > 0 && <WatchlistCard schedules={schedules} />}

        <section className="ws-section rise" aria-labelledby="ws-quick-title">
          <h2 id="ws-quick-title" className="ws-section-title">
            <Icon name="zap" size={14} />
            Quick actions
          </h2>
          <div className="ws-quick-grid">
            <QuickLink to="/"          icon="plus"       title="New extraction" desc="Paste a URL and start a fresh scrape" />
            <QuickLink to="/batch"     icon="layers"     title="Batch run"      desc="Extract many URLs in parallel" />
            <QuickLink to="/dashboard" icon="layout-list" title="Dashboard"      desc="Browse your saved extractions" />
            <QuickLink to="/collections" icon="folder"   title="Collections"    desc="Group related extractions" />
            <QuickLink to="/schedules" icon="calendar"   title="Schedules"      desc="Recurring monitoring & alerts" />
            <QuickLink to="/account"   icon="user"       title="Account & billing" desc="Plan, usage, payment history" />
          </div>
        </section>

        <div className="ws-grid">
          <section className="ws-card rise" aria-labelledby="ws-recent-title">
            <header className="ws-card-head">
              <h2 id="ws-recent-title" className="ws-card-title">
                <Icon name="history" size={14} />
                Recent extractions
              </h2>
              <Link to="/dashboard" className="ws-card-link">
                See all <Icon name="arrow-right" size={11} />
              </Link>
            </header>
            {recent.length === 0 ? (
              <p className="ws-empty">
                Nothing here yet. <Link to="/" className="ws-inline-link">Extract your first page →</Link>
              </p>
            ) : (
              <ul className="ws-list">
                {recent.map((item) => (
                  <li key={item.id} className="ws-list-item">
                    <Link to={`/preview?id=${item.id}`} className="ws-list-link">
                      <span className="ws-list-title">{item.title || item.url}</span>
                      <span className="ws-list-meta">
                        {item.url && (
                          <span className="ws-list-host">
                            {(() => { try { return new URL(item.url).hostname; } catch { return item.url; } })()}
                          </span>
                        )}
                        <span className="ws-list-time">{timeAgo(item.created_at || item.saved_at)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ws-card rise" aria-labelledby="ws-batch-title">
            <header className="ws-card-head">
              <h2 id="ws-batch-title" className="ws-card-title">
                <Icon name="layers" size={14} />
                Recent batch runs
              </h2>
              <Link to="/batch" className="ws-card-link">
                Open Batch <Icon name="arrow-right" size={11} />
              </Link>
            </header>
            {batchRuns.length === 0 ? (
              <p className="ws-empty">No batch runs yet.</p>
            ) : (
              <ul className="ws-list">
                {batchRuns.map((run) => (
                  <li key={run.id} className="ws-list-item">
                    <div className="ws-list-link as-row">
                      <span className="ws-list-title">{run.label || `${run.intent} batch`}</span>
                      <span className="ws-list-meta">
                        <span className="ws-list-stat ok">{run.successCount || 0} ok</span>
                        {(run.failedCount || 0) > 0 && (
                          <span className="ws-list-stat bad">{run.failedCount} fail</span>
                        )}
                        <span className="ws-list-time">{timeAgo(run.createdAt)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ws-card rise" aria-labelledby="ws-sched-title">
            <header className="ws-card-head">
              <h2 id="ws-sched-title" className="ws-card-title">
                <Icon name="calendar-clock" size={14} />
                Active schedules
              </h2>
              <Link to="/schedules" className="ws-card-link">
                Manage <Icon name="arrow-right" size={11} />
              </Link>
            </header>
            {schedules.length === 0 ? (
              <p className="ws-empty">No schedules yet.</p>
            ) : (
              <ul className="ws-list">
                {schedules.map((s) => (
                  <li key={s.id} className="ws-list-item">
                    <div className="ws-list-link as-row">
                      <span className="ws-list-title">{s.name || s.url}</span>
                      <span className="ws-list-meta">
                        <span className="ws-list-stat">{s.cadence || s.schedule || "—"}</span>
                        <span className="ws-list-time">{timeAgo(s.createdAt || s.updatedAt)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ws-card rise ws-usage-card" aria-labelledby="ws-usage-title">
            <header className="ws-card-head">
              <h2 id="ws-usage-title" className="ws-card-title">
                <Icon name="bar-chart-3" size={14} />
                This month
              </h2>
              <Link to="/account" className="ws-card-link">
                Usage details <Icon name="arrow-right" size={11} />
              </Link>
            </header>
            <div className="ws-usage-grid">
              <div className="ws-usage-cell">
                <span className="ws-usage-num">{usage?.extractions ?? 0}</span>
                <span className="ws-usage-label">Extractions</span>
              </div>
              <div className="ws-usage-cell">
                <span className="ws-usage-num">{usage?.batchRuns ?? 0}</span>
                <span className="ws-usage-label">Batch runs</span>
              </div>
              <div className="ws-usage-cell">
                <span className="ws-usage-num">{usage?.contentGenerations ?? 0}</span>
                <span className="ws-usage-label">Generated content</span>
              </div>
            </div>
            {personaId && (
              <p className="ws-foot">
                Persona: <strong>{personaId}</strong>
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
