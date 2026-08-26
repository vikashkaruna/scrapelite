// src/pages/Workspace.jsx — Q4 (logged-in → Projects/Lists workspace) page.
//
// "Command center" for signed-in users: recent extractions, active schedules,
// recent batch runs, and (now) collections — all in one place. Replaces the
// marketing home for logged-in users via the redirect in App.jsx.
//
// Tab structure:
//   /workspace                → Overview (default)
//   /workspace?tab=collections → Collections
//   /workspace?tab=schedules   → Schedules (a more detailed list than the
//                                "Active schedules" card on Overview)
//
// The Collections tab absorbs the previous /collections page — that route
// still exists as a backward-compat redirect in App.jsx.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { useBilling } from "../components/BillingProvider.jsx";
import { listExtractions } from "../lib/extractionsRepo.js";
import { listBatchRuns } from "../lib/batchRunsService.js";
import {
  listSchedules,
  listSchedulesLocal,
  cadenceLabel,
} from "../lib/schedulerService.js";
import { useSeo } from "../hooks/useSeo.js";
import WatchlistCard from "../components/WatchlistCard.jsx";
import CollectionsTab from "../components/workspace/CollectionsTab.jsx";
import TeamTab from "../components/workspace/TeamTab.jsx";

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

const TABS = [
  { key: "overview",    label: "Overview",    icon: "layout-grid" },
  { key: "collections", label: "Collections", icon: "folder" },
  { key: "schedules",   label: "Schedules",   icon: "calendar-clock" },
  { key: "team",        label: "Team",        icon: "users" },
];

function parseTab(raw) {
  const t = String(raw || "").toLowerCase();
  if (TABS.some((x) => x.key === t)) return t;
  return "overview";
}

export default function Workspace() {
  useSeo({
    title: "DatIQ Workspace — your team and usage at a glance | DatIQ.app",
    description:
      "DatIQ Workspace — your team's shared extractions, usage, and seats at a glance. DatIQ.app is the zero-code web data extraction platform for agencies and multi-seat teams.",
    canonical: "https://datiq.app/workspace",
  });
  const { user, userName } = useAuth();
  const { personaId } = usePersona();
  // Usage + plan come from the shared BillingProvider context (DB-hydrated,
  // reactive) rather than a one-off readUsage()/readSubscription() snapshot —
  // otherwise this page shows whatever the count was at mount and never
  // updates again during the session, drifting from Account.jsx.
  const { usage, plan } = useBilling();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const [recent, setRecent] = useState([]);
  const [batchRuns, setBatchRuns] = useState([]);
  // Schedule state is hydrated synchronously from localStorage so the user
  // sees their schedules on first paint — even if the server is slow or
  // unreachable. listSchedules() then reconciles with the server in the
  // background (and now preserves local-only items rather than wiping
  // them when the server returns [] — see schedulerService.js).
  const [schedules, setSchedules] = useState(() => listSchedulesLocal());
  const [schedulesLoading, setSchedulesLoading] = useState(true);

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
      setSchedulesLoading(true);
      try {
        const sched = await listSchedules();
        if (!cancel) {
          setSchedules(Array.isArray(sched) ? sched : []);
          setSchedulesLoading(false);
        }
      } catch {
        if (!cancel) {
          setSchedules(listSchedulesLocal());
          setSchedulesLoading(false);
        }
      }
    })();
    return () => { cancel = true; };
  }, [user?.id]);

  const greeting = useMemo(() => {
    const name = userName || user?.user_metadata?.name || user?.email?.split("@")[0];
    if (!name) return "Welcome back";
    return `Welcome back, ${name}`;
  }, [userName, user]);

  const planName = plan?.name || "Free";
  const setTab = (next) => {
    const sp = new URLSearchParams(searchParams);
    if (next === "overview") sp.delete("tab");
    else sp.set("tab", next);
    setSearchParams(sp, { replace: true });
  };

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

        {/* Tab nav — visible to logged-in users (WorkspaceRedirect handles
            the marketing teaser for logged-out). */}
        <nav className="ws-tabs rise" role="tablist" aria-label="Workspace sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`ws-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`ws-panel-${t.key}`}
              className={"ws-tab" + (tab === t.key ? " ws-tab-active" : "")}
              onClick={() => setTab(t.key)}
            >
              <Icon name={t.icon} size={14} />
              <span>{t.label}</span>
              {t.key === "schedules" && schedulesLoading && (
                <span className="ws-tab-spin" aria-label="Loading schedules">
                  <Icon name="loader" size={11} className="spin" />
                </span>
              )}
              {t.key === "schedules" && !schedulesLoading && schedules.length > 0 && (
                <span className="ws-tab-count">{schedules.length}</span>
              )}
            </button>
          ))}
        </nav>

        {tab === "overview" && (
          <div role="tabpanel" id="ws-panel-overview" aria-labelledby="ws-tab-overview" tabIndex={0}>
            <OverviewTab
              schedules={schedules}
              schedulesLoading={schedulesLoading}
              recent={recent}
              batchRuns={batchRuns}
              usage={usage}
              planName={planName}
              personaId={personaId}
              onSwitchToSchedules={() => setTab("schedules")}
              onSwitchToCollections={() => setTab("collections")}
            />
          </div>
        )}

        {tab === "collections" && (
          <div role="tabpanel" id="ws-panel-collections" aria-labelledby="ws-tab-collections" tabIndex={0}>
            <CollectionsTab />
          </div>
        )}

        {tab === "schedules" && (
          <div role="tabpanel" id="ws-panel-schedules" aria-labelledby="ws-tab-schedules" tabIndex={0}>
            <SchedulesTab
              schedules={schedules}
              schedulesLoading={schedulesLoading}
              onSwitchToOverview={() => setTab("overview")}
            />
          </div>
        )}

        {tab === "team" && (
          <div role="tabpanel" id="ws-panel-team" aria-labelledby="ws-tab-team" tabIndex={0}>
            <TeamTab />
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewTab({
  schedules, schedulesLoading, recent, batchRuns, usage, planName, personaId,
  onSwitchToSchedules, onSwitchToCollections,
}) {
  return (
    <>
      {/* FC1 — Watchlist card (logged-in only, only when there are schedules) */}
      {!schedulesLoading && schedules.length > 0 && (
        <WatchlistCard schedules={schedules} />
      )}

      <section className="ws-section rise" aria-labelledby="ws-quick-title">
        <h2 id="ws-quick-title" className="ws-section-title">
          <Icon name="zap" size={14} />
          Quick actions
        </h2>
        <div className="ws-quick-grid">
          <QuickLink to="/"          icon="plus"       title="New extraction" desc="Paste a URL and start a fresh scrape" />
          <QuickLink to="/batch"     icon="layers"     title="Batch run"      desc="Extract many URLs in parallel" />
          <QuickLink to="/dashboard" icon="layout-list" title="Dashboard"      desc="Browse your saved extractions" />
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

        <SchedulesSummaryCard
          schedules={schedules}
          loading={schedulesLoading}
          onSeeAll={onSwitchToSchedules}
        />

        <section className="ws-card rise" aria-labelledby="ws-collections-title">
          <header className="ws-card-head">
            <h2 id="ws-collections-title" className="ws-card-title">
              <Icon name="folder" size={14} />
              Collections
            </h2>
            <button type="button" className="ws-card-link" onClick={onSwitchToCollections}>
              Open <Icon name="arrow-right" size={11} />
            </button>
          </header>
          <CollectionsSummaryCard onOpen={onSwitchToCollections} />
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
    </>
  );
}

function SchedulesSummaryCard({ schedules, loading, onSeeAll }) {
  // Show up to 3 schedules on the Overview; the dedicated Schedules tab
  // has the full list with edit/pause/run-now controls.
  const visible = schedules.slice(0, 3);
  return (
    <section className="ws-card rise" aria-labelledby="ws-sched-title">
      <header className="ws-card-head">
        <h2 id="ws-sched-title" className="ws-card-title">
          <Icon name="calendar-clock" size={14} />
          Active schedules
        </h2>
        <button type="button" className="ws-card-link" onClick={onSeeAll}>
          Manage <Icon name="arrow-right" size={11} />
        </button>
      </header>
      {loading && schedules.length === 0 ? (
        <p className="ws-empty ws-empty-loading">
          <Icon name="loader" size={13} className="spin" /> Loading schedules…
        </p>
      ) : schedules.length === 0 ? (
        <p className="ws-empty">
          No schedules yet. <Link to="/schedules" className="ws-inline-link">Create one →</Link>
        </p>
      ) : (
        <ul className="ws-list">
          {visible.map((s) => (
            <li key={s.id} className="ws-list-item">
              <div className="ws-list-link as-row">
                <span className="ws-list-title">{s.label || s.target}</span>
                <span className="ws-list-meta">
                  <span className="ws-list-stat">{cadenceLabel(s) || "—"}</span>
                  <span className="ws-list-time">{timeAgo(s.createdAt || s.updatedAt)}</span>
                </span>
              </div>
            </li>
          ))}
          {schedules.length > 3 && (
            <li className="ws-list-item ws-list-overflow">
              <button type="button" className="ws-list-overflow-btn" onClick={onSeeAll}>
                +{schedules.length - 3} more — see all
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function CollectionsSummaryCard({ onOpen }) {
  // Lazy import to avoid a heavy import chain in the Overview mount path.
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancel = false;
    listExtractions()
      .then((rows) => { if (!cancel) setItems(rows || []); })
      .catch(() => { if (!cancel) setItems([]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const name = (it?.collection || "").trim();
      if (!name) continue;
      const e = map.get(name) || { name, count: 0, latestAt: "" };
      e.count += 1;
      if ((it?.created_at || "") > e.latestAt) e.latestAt = it.created_at;
      map.set(name, e);
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 4);
  }, [items]);
  const untagged = items.filter((it) => !it?.collection).length;
  return (
    <>
      {loading ? (
        <p className="ws-empty ws-empty-loading">
          <Icon name="loader" size={13} className="spin" /> Loading collections…
        </p>
      ) : groups.length === 0 ? (
        <p className="ws-empty">
          No collections yet. Open a row on the Dashboard and pick a collection from the dropdown to start grouping extractions.
        </p>
      ) : (
        <>
          <ul className="ws-list">
            {groups.map((c) => (
              <li key={c.name} className="ws-list-item">
                <button type="button" className="ws-list-link as-row" onClick={onOpen}>
                  <span className="ws-list-title">
                    <Icon name="folder" size={12} /> {c.name}
                  </span>
                  <span className="ws-list-meta">
                    <span className="ws-list-stat">{c.count} item{c.count === 1 ? "" : "s"}</span>
                  </span>
                </button>
              </li>
            ))}
            {untagged > 0 && (
              <li className="ws-list-item">
                <button type="button" className="ws-list-link as-row" onClick={onOpen}>
                  <span className="ws-list-title">
                    <Icon name="inbox" size={12} /> Untagged
                  </span>
                  <span className="ws-list-meta">
                    <span className="ws-list-stat">{untagged} item{untagged === 1 ? "" : "s"}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </>
  );
}

function SchedulesTab({ schedules, schedulesLoading, onSwitchToOverview }) {
  return (
    <section className="ws-section rise" aria-labelledby="ws-schedules-tab-title">
      <header className="ws-section-head">
        <h2 id="ws-schedules-tab-title" className="ws-section-title">
          <Icon name="calendar-clock" size={14} />
          Active schedules
        </h2>
        <div className="ws-section-actions">
          <Link to="/schedules" className="ws-card-link">
            Open full editor <Icon name="arrow-right" size={11} />
          </Link>
        </div>
      </header>

      {schedulesLoading && schedules.length === 0 ? (
        <p className="ws-empty ws-empty-loading">
          <Icon name="loader" size={13} className="spin" /> Loading schedules…
        </p>
      ) : schedules.length === 0 ? (
        <p className="ws-empty">
          No schedules yet. <Link to="/schedules" className="ws-inline-link">Create one →</Link>
        </p>
      ) : (
        <ul className="ws-list ws-list-tall">
          {schedules.map((s) => {
            const isBatch = s.type === "batch";
            return (
              <li key={s.id} className="ws-list-item">
                <Link
                  to={isBatch ? "/schedules" : `/preview?url=${encodeURIComponent(s.target || "")}`}
                  className="ws-list-link as-row"
                >
                  <span className="ws-list-title">{s.label || s.target}</span>
                  <span className="ws-list-meta">
                    <span className="ws-list-stat">{cadenceLabel(s) || "—"}</span>
                    {s.lastRunAt && (
                      <span className="ws-list-stat ok">last run {timeAgo(s.lastRunAt)}</span>
                    )}
                    {s.status === "paused" && (
                      <span className="ws-list-stat bad">paused</span>
                    )}
                    <span className="ws-list-time">{timeAgo(s.createdAt || s.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
