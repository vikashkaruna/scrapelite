// src/components/WatchlistCard.jsx — FC1 (Watchlist Home — monitored URLs + deltas).
//
// The "Bloomberg-terminal opening screen" for logged-in users. Shows the
// top of /workspace. Renders the schedules that have changed since the
// user's last visit, the most recent ran-since-visit (no change), and a
// one-line "your next check fires in X" subtitle.
//
// Renders NOTHING when there are no schedules (so the Workspace doesn't
// show an empty card).

import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon.jsx";
import {
  summariseWatchlist,
  readLastVisitedAt,
  writeLastVisitedAt,
} from "../lib/watchlistDeltas.js";
import { hostOf, timeAgo } from "../lib/utils.js";

const DELTA_META = {
  changed_since_visit: { icon: "alert-circle",   cls: "wc-delta wc-delta-changed" },
  ran_since_visit:     { icon: "check-circle",   cls: "wc-delta wc-delta-ok" },
  stale:               { icon: "clock",          cls: "wc-delta wc-delta-stale" },
  never_run:           { icon: "loader",         cls: "wc-delta wc-delta-idle" },
  unknown:             { icon: "help-circle",    cls: "wc-delta wc-delta-unknown" },
};

function formatNextRun(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return null;
  if (ms < 60_000) return "in <1m";
  if (ms < 60 * 60_000) return `in ${Math.round(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `in ${Math.round(ms / (60 * 60_000))}h`;
  return `in ${Math.round(ms / (24 * 60 * 60_000))}d`;
}

export default function WatchlistCard({ schedules = [] }) {
  const lastVisitedAt = useMemo(() => readLastVisitedAt(), []);
  const summary = useMemo(
    () => summariseWatchlist(schedules, lastVisitedAt),
    [schedules, lastVisitedAt],
  );

  // Mark the visit so the next reload doesn't keep showing the same deltas.
  useEffect(() => {
    writeLastVisitedAt();
  }, []);

  if (!summary.total) return null;

  const top = summary.rows.slice(0, 6);
  const nextRun = formatNextRun(summary.nextRunAt);

  return (
    <section className="watchlist-card rise" aria-labelledby="watchlist-title">
      <header className="watchlist-head">
        <div>
          <span className="ws-eyebrow">
            <Icon name="radar" size={12} />
            Watchlist
          </span>
          <h2 id="watchlist-title" className="watchlist-title">Monitored URLs</h2>
          <p className="watchlist-sub">
            {summary.changed > 0
              ? `${summary.changed} changed since your last visit · `
              : "No changes since your last visit · "}
            {summary.total} total
            {nextRun ? ` · next check ${nextRun}` : ""}
          </p>
        </div>
        <Link to="/schedules" className="watchlist-link">
          All schedules <Icon name="arrow-right" size={12} />
        </Link>
      </header>
      <ul className="watchlist-list" role="list">
        {top.map(({ schedule, delta }) => {
          const meta = DELTA_META[delta.kind] || DELTA_META.unknown;
          return (
            <li key={schedule.id || schedule.label} className={meta.cls}>
              <span className="watchlist-icon" aria-hidden="true">
                <Icon name={meta.icon} size={14} />
              </span>
              <span className="watchlist-body">
                <span className="watchlist-label">{schedule.label}</span>
                <span className="watchlist-meta">
                  <Icon name="globe" size={10} />
                  {schedule.type === "batch"
                    ? `${(schedule.target || []).length} URLs`
                    : hostOf(schedule.target)}
                  <span className="watchlist-sep">·</span>
                  <span className="watchlist-delta-label">{delta.label}</span>
                  {schedule.lastRunAt && (
                    <>
                      <span className="watchlist-sep">·</span>
                      <span className="watchlist-ago">checked {timeAgo(schedule.lastRunAt)}</span>
                    </>
                  )}
                </span>
              </span>
              <Link
                to={schedule.type === "batch" ? "/schedules" : `/preview?url=${encodeURIComponent(schedule.target || "")}`}
                className="watchlist-cta"
                title="View"
              >
                <Icon name="arrow-right" size={12} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
