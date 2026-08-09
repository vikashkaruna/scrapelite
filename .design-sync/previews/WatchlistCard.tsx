import { WatchlistCard } from "datiq";

// WatchlistCard reads a real localStorage watermark ("datiq.workspaceLastVisitedAt")
// on mount via readLastVisitedAt(), and the capture harness's browser profile
// persists localStorage ACROSS separate capture runs (not just across cells on
// one page) — an earlier run's writeLastVisitedAt() leaks in and pins every row
// as stale forever. Clear it at module scope, before the component ever mounts,
// so this preview's classification is deterministic. See NOTES.md.
try {
  localStorage.removeItem("datiq.workspaceLastVisitedAt");
} catch {
  /* no-op outside a browser */
}

// Relative to render-time Date.now() — the component itself reads
// Date.now() internally (formatNextRun, classifyDelta), so offsets computed
// from any other fixed instant drift into nonsense ("in 813d") the moment
// the two clocks disagree.
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();

// One realistic mixed watchlist — changed / unchanged / never-run rows
// together, same as a real user's dashboard. Deliberately the ONLY story:
// WatchlistCard's own useEffect writes a real "last visited" watermark to
// localStorage on mount, shared across every instance on the page — a
// second WatchlistCard preview cell mounting after this one would read the
// watermark THIS cell just wrote and misclassify its own rows as stale.
// See .design-sync/NOTES.md.
const MIXED_SCHEDULES = [
  {
    id: "sch_1",
    label: "Competitor pricing page",
    type: "single",
    target: "https://acme.example.com/pricing",
    lastRunAt: hoursAgo(2),
    lastChangeAt: hoursAgo(2),
    lastStatus: "changed",
    nextRunAt: hoursFromNow(22),
  },
  {
    id: "sch_2",
    label: "YC company directory",
    type: "batch",
    target: Array.from({ length: 48 }, (_, i) => `https://ycombinator.com/companies/${i}`),
    lastRunAt: hoursAgo(6),
    lastChangeAt: hoursAgo(96),
    lastStatus: "unchanged",
    nextRunAt: hoursFromNow(18),
  },
  {
    id: "sch_3",
    label: "Job postings — Series B startups",
    type: "batch",
    target: Array.from({ length: 12 }, (_, i) => `https://jobs.example.com/${i}`),
    lastRunAt: hoursAgo(30),
    lastChangeAt: hoursAgo(240),
    lastStatus: "unchanged",
    nextRunAt: hoursFromNow(2),
  },
  {
    id: "sch_4",
    label: "Homepage hero monitor",
    type: "single",
    target: "https://example.com",
    lastRunAt: null,
    lastChangeAt: null,
    lastStatus: null,
    nextRunAt: hoursFromNow(1),
  },
];

export function MixedWatchlist() {
  return <WatchlistCard schedules={MIXED_SCHEDULES} />;
}
