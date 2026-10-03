// Dashboard.jsx — historical view of saved extractions (route "/dashboard").
import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router";
import WorkflowRunHistory from "../components/WorkflowRunHistory.jsx";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import BrandLoader from "../components/BrandLoader.jsx";
import EmailModal from "../components/EmailModal.jsx";
import ContentModal from "../components/ContentModal.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import CollectionPicker from "../components/CollectionPicker.jsx";
import ExportIntegrations from "../components/ExportIntegrations.jsx";
import ExportMenu from "../components/ExportMenu.jsx";
import LocalDataNotice from "../components/LocalDataNotice.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { resolveTemplateUserId, readBrandKit } from "../lib/whiteLabelTemplate.js";
import { useToast } from "../components/Toast.jsx";
import { useErrorModal } from "../components/ErrorModal.jsx";
import { LOAD_ERROR, DELETE_ERROR } from "../lib/errorMessages.js";
import { listExtractions, deleteExtraction, saveExtraction } from "../lib/extractionsRepo.js";
import { listBatchRuns, readBatchMap, deleteBatchRun } from "../lib/batchRunsService.js";
import { apiClient } from "../lib/apiClient.js";
import { summariseCollections, normalizeCollectionName } from "../lib/collectionsService.js";
import { hostOf, pathOf, fmtDate, timeAgo, snippet, csvDownload, excelDownload, markdownDownload, jsonDownload, copyToClipboard } from "../lib/utils.js";
import { readEnrichments } from "../lib/enrichmentStore.js";
import { useSeo } from "../hooks/useSeo.js";
import { lifecycle as analytics } from "../lib/analyticsService.js";

// Merge an item's stored enrichments (Supabase column + local cache, newest per
// capability) so exports include every capability run against the URL.
function withEnrichments(item) {
  const merged = { ...(item.enrichments || {}) };
  for (const [key, entry] of Object.entries(readEnrichments(item.url))) {
    const prev = merged[key];
    if (!prev || new Date(entry.created_at || 0) >= new Date(prev.created_at || 0)) {
      merged[key] = entry;
    }
  }
  return Object.keys(merged).length ? { ...item, enrichments: merged } : item;
}

const ROW_PX = 66;
const CHROME_PX = 360;
const MIN_ROWS = 4;
const MAX_ROWS = 24;

function rowsForViewport() {
  if (typeof window === "undefined") return 8;
  const fit = Math.floor((window.innerHeight - CHROME_PX) / ROW_PX);
  return Math.max(MIN_ROWS, Math.min(MAX_ROWS, fit));
}

function persistLayout(layout) {
  try { localStorage.setItem("datiq.dashLayout", layout); } catch { /* ignore */ }
}
function initialLayout() {
  try {
    const v = localStorage.getItem("datiq.dashLayout");
    if (v === "cards" || v === "table") return v;
  } catch { /* ignore */ }
  return "table";
}

function haystack(it) {
  return [it.page_title, it.url, it.ai_summary, ...(it.headings || []).map((h) => h.text), ...(it.links || []).flatMap((l) => [l.text, l.href])]
    .filter(Boolean).join(" ").toLowerCase();
}

function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set([1, total, current, current - 1, current + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of pages) {
    if (p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

function Check({ checked, indeterminate, onChange, title }) {
  return (
    <button
      type="button"
      className={"dash-check" + (checked ? " on" : indeterminate ? " ind" : "")}
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      role="checkbox"
      aria-checked={indeterminate && !checked ? "mixed" : checked}
      title={title}
    >
      {checked ? <Icon name="check" size={13} strokeWidth={3} /> : indeterminate ? <Icon name="minus" size={13} strokeWidth={3} /> : null}
    </button>
  );
}

function Pager({ page, totalPages, start, shown, total, onPage }) {
  if (totalPages <= 1) return null;
  return (
    <div className="dash-pager">
      <span className="dash-pager-info">
        Showing <b>{shown === 0 ? 0 : start + 1}</b>–<b>{start + shown}</b> of <b>{total}</b>
      </span>
      <div className="dash-pager-ctrls">
        <button className="pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <Icon name="chevron-left" size={16} />
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={"ell" + i} className="pager-ellipsis">…</span>
          ) : (
            <button key={p} className={"pager-btn" + (p === page ? " on" : "")} onClick={() => onPage(p)} aria-current={p === page ? "page" : undefined}>
              {p}
            </button>
          ),
        )}
        <button className="pager-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </div>
  );
}

function readLocalItems() {
  try {
    const raw = localStorage.getItem("datiq.saved");
    if (!raw) return [];
    return JSON.parse(raw)
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((r) => ({ ...r, _saved: true }));
  } catch { return []; }
}

function DemoBadge() {
  return <span className="demo-badge"><Icon name="flask" size={11} /> Demo</span>;
}

// ── Source category (Single · Batch · Scheduled) ──────────────────────────────
const CATEGORY_META = {
  single:   { label: "Single",    icon: "globe",         cls: "cat-single" },
  batch:    { label: "Batch",     icon: "layers-2",      cls: "cat-batch" },
  schedule: { label: "Scheduled", icon: "calendar-clock", cls: "cat-schedule" },
};

function CategoryChip({ category }) {
  const m = CATEGORY_META[category] || CATEGORY_META.single;
  return (
    <span className={"cat-chip " + m.cls} title={`${m.label} extraction`}>
      <Icon name={m.icon} size={10} /> {m.label}
    </span>
  );
}

function RowActions({ item, onView, onDelete, compact, collectionProps }) {
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      {collectionProps && (
        <CollectionPicker
          value={item.collection}
          collections={collectionProps.collections}
          onSelect={collectionProps.onSelect}
          onCreate={collectionProps.onCreate}
        />
      )}
      <Button variant="secondary" size="sm" icon="arrow-up-right" onClick={() => onView(item)}>
        {compact ? "" : "View"}
      </Button>
      {!item._demo && (
        <Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(item)} title="Delete" className="del-btn" />
      )}
    </div>
  );
}

function DashCard({ item, selected, onToggle, onView, onDelete, category }) {
  return (
    <div className={"dash-card card" + (selected ? " sel" : "") + (item._demo ? " demo-item" : "")} onClick={() => onView(item)}>
      <div className="dash-card-top">
        <FaviconDot url={item.url} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="dash-card-title">
            {item.page_title}{item._demo && <DemoBadge />}
            {category !== "single" && <CategoryChip category={category} />}
          </div>
          <div className="dash-card-url">{hostOf(item.url)}{pathOf(item.url) !== "/" ? pathOf(item.url) : ""}</div>
        </div>
        {!item._demo && (
          <div className="dash-card-check">
            <Check checked={selected} onChange={() => onToggle(item.id)} title="Select extraction" />
          </div>
        )}
      </div>
      <p className="dash-card-summary">{snippet(item.ai_summary)}</p>
      <div className="dash-card-foot">
        <div className="dash-meta">
          <span title="Headings"><Icon name="hash" size={14} /> {item.headings.length}</span>
          <span title="Links"><Icon name="link" size={14} /> {item.links.length}</span>
          <span title="Extracted"><Icon name="clock" size={14} /> {timeAgo(item.created_at)}</span>
        </div>
        <RowActions item={item} onView={onView} onDelete={onDelete} compact />
      </div>
    </div>
  );
}

// ── Export Dropdown ───────────────────────────────────────────────────────────
function ExportDropdown({ onCsv, onExcel, onPdf, onMarkdown, onJson, onCopyCsv, onCopyMarkdown, onCopyJson, disabled, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="export-dropdown" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        icon="download"
        iconRight="chevron-down"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={`Export ${label}`}
      >
        Export
      </Button>
      {open && (
        <div className="export-dropdown-menu">
          <div className="export-dropdown-section">
            <div className="export-dropdown-section-label">Download</div>
            <button className="export-dropdown-item" onClick={() => { onCsv(); setOpen(false); }}>
              <Icon name="download" size={14} /> <span><b>CSV</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onExcel && onExcel(); setOpen(false); }}>
              <Icon name="sheet" size={14} /> <span><b>Excel Worksheet (.xls)</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onPdf(); setOpen(false); }}>
              <Icon name="file" size={14} /> <span><b>PDF</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onMarkdown(); setOpen(false); }}>
              <Icon name="file-code" size={14} /> <span><b>Markdown</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onJson(); setOpen(false); }}>
              <Icon name="file-json" size={14} /> <span><b>JSON</b></span>
            </button>
          </div>
          <div className="export-dropdown-section">
            <div className="export-dropdown-section-label">Copy to clipboard</div>
            <button className="export-dropdown-item" onClick={() => { onCopyCsv && onCopyCsv(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy CSV</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onCopyMarkdown && onCopyMarkdown(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy Markdown</b></span>
            </button>
            <button className="export-dropdown-item" onClick={() => { onCopyJson && onCopyJson(); setOpen(false); }}>
              <Icon name="clipboard-copy" size={14} /> <span><b>Copy JSON</b></span>
            </button>
          </div>
          {/* No "Send to" section — destinations live on the Push button, which
              now carries Google Sheets too. Export ▾ is downloads + clipboard. */}
        </div>
      )}
    </div>
  );
}

// ── Batch Runs history dropdown ───────────────────────────────────────────────
function BatchRunsDropdown({ runs, activeRunId, onSelect, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const active = runs.find((r) => r.id === activeRunId);

  return (
    <div className="batch-runs-dropdown" ref={ref}>
      <button
        className={"batch-runs-btn" + (activeRunId ? " batch-runs-btn--active" : "")}
        onClick={() => setOpen((v) => !v)}
        title="Filter by batch run"
        type="button"
      >
        <Icon name="layers-2" size={14} />
        {activeRunId && active ? active.label.split(" · ")[0] : "Batch runs"}
        {runs.length > 0 && !activeRunId && (
          <span className="batch-runs-count">{runs.length}</span>
        )}
        <Icon name="chevron-down" size={12} />
      </button>
      {open && (
        <div className="batch-runs-menu">
          {runs.length === 0 ? (
            <div className="batch-runs-empty">
              <Icon name="layers-2" size={16} />
              <span>No batch runs yet</span>
              <a href="/batch" style={{ color: "var(--accent)", fontSize: ".82em" }}>Start a batch →</a>
            </div>
          ) : (
            <>
              {activeRunId && (
                <button
                  className="batch-runs-item batch-runs-clear"
                  onClick={() => { onSelect(null); setOpen(false); }}
                >
                  <Icon name="x" size={13} /> Show all extractions
                </button>
              )}
              {runs.map((run) => (
                <div
                  key={run.id}
                  className={"batch-runs-item" + (run.id === activeRunId ? " batch-runs-item--active" : "")}
                >
                  <button
                    className="batch-runs-item-body"
                    onClick={() => { onSelect(run.id); setOpen(false); }}
                  >
                    <div className="batch-runs-item-label">{run.label}</div>
                    <div className="batch-runs-item-meta">
                      <span className="batch-runs-ok"><Icon name="check" size={11} /> {run.successCount} saved</span>
                      {run.failedCount > 0 && (
                        <span className="batch-runs-fail"><Icon name="x" size={11} /> {run.failedCount} failed</span>
                      )}
                    </div>
                  </button>
                  <button
                    className="batch-runs-item-del"
                    onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                    title="Remove from history"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Groke QW#2 — tag filter chips (top 8 tags by usage) ──────────────────
function TagFilter({ items, value, onChange }) {
  const counts = useMemo(() => {
    const map = new Map();
    for (const it of items || []) {
      for (const t of it?.tags || []) {
        if (t) map.set(t, (map.get(t) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8);
  }, [items]);
  if (counts.length === 0) return null;
  return (
    <div className="tag-filter">
      <span className="tag-filter-eyebrow">
        <Icon name="tag" size={11} /> Tags
      </span>
      <div className="tag-filter-chips">
        {counts.map(([t, n]) => (
          <button
            key={t}
            type="button"
            className={"tag-filter-chip" + (value === t ? " on" : "")}
            onClick={() => onChange(value === t ? "" : t)}
            title={`Filter by tag: ${t} (${n} item${n !== 1 ? "s" : ""})`}
          >
            {t}
            <span className="tag-filter-count">{n}</span>
          </button>
        ))}
        {value && (
          <button
            type="button"
            className="tag-filter-clear"
            onClick={() => onChange("")}
            title="Clear tag filter"
            aria-label="Clear tag filter"
          >
            <Icon name="x" size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Groke QW#3 — collection filter dropdown ───────────────────────────────
function CollectionFilter({ items, value, onChange }) {
  const collections = useMemo(() => summariseCollections(items), [items]);
  const untaggedCount = useMemo(
    () => (items || []).filter((it) => !it?.collection).length,
    [items]
  );
  if (collections.length === 0 && untaggedCount === 0) return null;
  return (
    <div className="collection-filter">
      <span className="tag-filter-eyebrow">
        <Icon name="folder" size={11} /> Collection
      </span>
      <select
        className="collection-filter-select"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by collection"
      >
        <option value="">All ({items?.length || 0})</option>
        {collections.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.count})
          </option>
        ))}
        {untaggedCount > 0 && (
          <option value="__untagged__">Untagged ({untaggedCount})</option>
        )}
      </select>
    </div>
  );
}

export default function Dashboard() {
  useSeo({
    title: "DatIQ Dashboard — your saved extractions | DatIQ.app",
    description:
      "DatIQ Dashboard — your saved extractions, search and filter, batch runs, collection grouping, CSV and PDF export, and integrations. DatIQ.app is the AI-enabled web data extraction platform.",
    canonical: "https://datiq.app/dashboard",
  });
  const navigate = useNavigate();
  const showToast = useToast();
  const showError = useErrorModal();
  const { view } = useExtraction();
  const { personaId } = usePersona();
  const { checkCanExport, checkCanEmail } = useBilling();
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;

  const [items, setItems] = useState(readLocalItems);
  const [loading, setLoading] = useState(() => !localStorage.getItem("datiq.saved"));
  const [refreshing, setRefreshing] = useState(false);
  const [layout, setLayout] = useState(initialLayout);
  // BH-01: persist search filter to URL search params so goBack()/goForward()
  // naturally restores it. Other dashboard filters stay in local state — only
  // the search box is part of the BH-01 back/forward contract today.
  const [searchParams, setSearchParams] = useSearchParams();
  // Two things live on this page now: SAVED EXTRACTIONS (rows) and WORKFLOW
  // RUNS (template executions). They are genuinely different objects — a run
  // can fail and be worth seeing, while only successes are ever saved as
  // extractions — so they get their own view rather than one merged table
  // that would have to explain which kind each row is.
  //
  // Driven by ?view= so a link to the run history is shareable and survives a
  // reload, the same reason /batch?run= and /discoverability?view=history are.
  // `dashView`, not `view` — useExtraction() already exports a `view`, and
  // shadowing it would have been a silent bug rather than a compile error
  // if the two had happened to be used in different scopes.
  const dashView = searchParams.get("view") === "runs" ? "runs" : "saved";
  const setDashView = (next) => {
    const p = new URLSearchParams(searchParams);
    if (next === "runs") p.set("view", "runs"); else p.delete("view");
    setSearchParams(p, { replace: true });
  };
  const [query, setQueryState] = useState(() => searchParams.get("q") || "");
  const setQuery = (value) => {
    setQueryState(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true }
    );
  };
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [emailOpen, setEmailOpen] = useState(false);
  const [contentItem, setContentItem] = useState(null);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const [pageSize, setPageSize] = useState(rowsForViewport);

  // Batch run history (localStorage-backed)
  const [batchRuns, setBatchRuns] = useState(() => listBatchRuns());
  const [batchFilter, setBatchFilter] = useState(null); // null = no filter
  const [typeFilter, setTypeFilter] = useState("all");  // all | single | batch | schedule
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const batchMap = useRef(readBatchMap()); // { extractionId: batchRunId | schrun_<id> }

  // Groke QW#2 — tag filter
  const [tagFilter, setTagFilter] = useState(() => searchParams.get("tag") || "");
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tagFilter) next.set("tag", tagFilter);
        else next.delete("tag");
        return next;
      },
      { replace: true }
    );
  }, [tagFilter, setSearchParams]);
  // Groke QW#3 — collection filter
  const [collectionFilter, setCollectionFilter] = useState(() => searchParams.get("collection") || "");
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (collectionFilter) next.set("collection", collectionFilter);
        else next.delete("collection");
        return next;
      },
      { replace: true }
    );
  }, [collectionFilter, setSearchParams]);

  // Reload batch map when filtering changes (picks up runs saved mid-session)
  useEffect(() => {
    setBatchRuns(listBatchRuns());
    batchMap.current = readBatchMap();
  }, [batchFilter, items]);

  // Resolve a run group's kind (batch vs scheduled) for categorisation.
  const runKindOf = (gid) => {
    if (!gid) return null;
    const run = batchRuns.find((r) => r.id === gid);
    return run?.kind || (String(gid).startsWith("schrun_") ? "schedule" : "batch");
  };
  const categoryOf = (id) => {
    const gid = batchMap.current[id];
    if (!gid) return "single";
    return runKindOf(gid) === "schedule" ? "schedule" : "batch";
  };
  const toggleGroup = (gid) =>
    setExpandedGroups((s) => { const n = new Set(s); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });

  useEffect(() => {
    const onResize = () => setPageSize(rowsForViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    listExtractions()
      .then((rows) => { if (alive) setItems(rows); })
      .catch((err) => { console.error("[DatIQ] Failed to load extractions:", err); if (alive) showError(err, LOAD_ERROR); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    setRefreshing(true);
    try {
      const rows = await listExtractions();
      setItems(rows);
      showToast("Refreshed", "check-circle");
    } catch {
      showToast("Refresh failed. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const showingDemo = false;

  // Groke QW#3 — collection summaries (recomputed whenever items change)
  const collectionSummaries = useMemo(() => summariseCollections(items), [items]);
  const handleSetCollection = async (it, name) => {
    const next = { ...it };
    const clean = normalizeCollectionName(name);
    if (clean) next.collection = clean;
    else delete next.collection;
    try {
      await saveExtraction(next);
      setItems((prev) => prev.map((x) => (x.id === it.id ? next : x)));
      showToast(clean ? `Added to "${clean}"` : "Removed from collection", "folder");
    } catch (e) {
      showToast("Couldn't update collection. Please try again.");
    }
  };

  const filtered = useMemo(() => {
    let result = items;
    // Batch run filter — show only items from the selected run
    if (batchFilter) {
      result = result.filter((it) => batchMap.current[it.id] === batchFilter);
    }
    // Category filter — single / batch / scheduled
    if (typeFilter !== "all") {
      result = result.filter((it) => categoryOf(it.id) === typeFilter);
    }
    // Groke QW#2 — tag filter
    if (tagFilter) {
      const want = tagFilter.toLowerCase();
      result = result.filter((it) => Array.isArray(it.tags) && it.tags.includes(want));
    }
    // Groke QW#3 — collection filter
    if (collectionFilter) {
      if (collectionFilter === "__untagged__") {
        result = result.filter((it) => !it.collection);
      } else {
        result = result.filter((it) => it.collection === collectionFilter);
      }
    }
    const q = query.trim().toLowerCase();
    if (!q) return result;
    const terms = q.split(/\s+/);
    return result.filter((it) => { const hay = haystack(it); return terms.every((t) => hay.includes(t)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, batchFilter, typeFilter, tagFilter, collectionFilter, batchRuns]);

  // ── Group rows by their originating job/run (collapsible) ───────────────────
  // Each "block" is either a standalone single extraction or a run group (batch /
  // scheduled) holding its child extractions. Blocks are sorted newest-first and
  // paginated, so grouping never breaks the pager.
  const blocks = useMemo(() => {
    const map = batchMap.current;
    const groups = new Map();
    const out = [];
    for (const it of filtered) {
      const gid = map[it.id];
      if (gid) {
        if (!groups.has(gid)) {
          const run = batchRuns.find((r) => r.id === gid);
          const block = {
            type: "group", groupId: gid,
            kind: runKindOf(gid),
            label: run?.label || (String(gid).startsWith("schrun_") ? "Scheduled run" : "Batch run"),
            items: [], date: it.created_at,
          };
          groups.set(gid, block);
          out.push(block);
        }
        const g = groups.get(gid);
        g.items.push(it);
        if (new Date(it.created_at) > new Date(g.date)) g.date = it.created_at;
      } else {
        out.push({ type: "single", item: it, date: it.created_at });
      }
    }
    out.sort((a, b) => new Date(b.date) - new Date(a.date));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, batchRuns]);

  const totalPages = Math.max(1, Math.ceil(blocks.length / pageSize));
  useEffect(() => { setPage(1); }, [query, typeFilter, batchFilter, tagFilter, collectionFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const pageBlocks = blocks.slice(start, start + pageSize);
  // Flatten the page's blocks back to the items shown (for select-all + card view).
  const pageItems = pageBlocks.flatMap((b) => (b.type === "group" ? b.items : [b.item]));

  const pageIds = pageItems.map((it) => it.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));
  const selectedItems = items.filter((it) => selected.has(it.id));

  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togglePage = () => setSelected((s) => { const n = new Set(s); if (pageAllSelected) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; });
  const clearSelection = () => setSelected(new Set());

  const changeLayout = (l) => { setLayout(l); persistLayout(l); };

  const onDelete = async (item) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    setSelected((s) => { if (!s.has(item.id)) return s; const n = new Set(s); n.delete(item.id); return n; });
    try {
      await deleteExtraction(item.id);
      showToast("Extraction deleted", "trash");
    } catch (err) {
      console.error("[DatIQ] Delete failed:", err);
      setItems(prev);
      showError(err, DELETE_ERROR, () => onDelete(item));
    }
  };

  const handleSend = async (emails, format) => {
    if (!checkCanEmail()) { showToast("Email export isn't available on your current plan."); setEmailOpen(false); return; }
    if (!checkCanExport(format)) { showToast(`${format.toUpperCase()} export is not available on your current plan.`); return; }
    try {
      const res = await apiClient.sendExportEmail({ to: emails, items: selectedItems.map(withEnrichments), format, brandKit: readBrandKit() });
      setEmailOpen(false);
      setSelected(new Set());
      showToast(`Email sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""}`, "mail");
      return res;
    } catch (err) {
      throw err; // re-throw so EmailModal can show the error
    }
  };

  const exportTargets = () => (selected.size ? selectedItems : filtered).map(withEnrichments);
  const exportItems = exportTargets();

  const onExportCsv = () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    csvDownload(targets, { brandKit: readBrandKit() });
    analytics.exported({ format: "csv", count: targets.length, source: "dashboard" });
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to CSV`, "download");
  };

  const onExportExcel = () => {
    if (!checkCanExport("csv")) { showToast("Spreadsheet export is not available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    excelDownload(targets, { brandKit: readBrandKit() });
    analytics.exported({ format: "excel", count: targets.length, source: "dashboard" });
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to Excel Worksheet`, "sheet");
  };

  const onExportPdf = async () => {
    if (!checkCanExport("pdf")) { showToast("PDF export isn't available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      // White-label PDF (Business + Agency): paint the user's uploaded
      // template as the page background, when one is set. We never let a
      // bad template fail the whole export — if the read throws, we
      // silently fall back to a plain PDF.
      let template = null;
      try {
        const { readTemplate } = await import("../lib/whiteLabelTemplate.js");
        const tplRes = await readTemplate({ userId: resolveTemplateUserId() });
        if (tplRes?.ok && tplRes.value?.bytes) template = tplRes.value.bytes;
      } catch { /* plain PDF is fine */ }
      extractionsToPdf(targets, { template, brandKit: readBrandKit() });
      analytics.exported({ format: "pdf", count: targets.length, source: "dashboard" });
      showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to PDF`, "file");
    } catch (err) {
      console.error("[DatIQ] PDF export failed:", err);
      if (/dynamically imported/i.test(err?.message || "")) {
        showToast("App updated — please refresh the page and try again.", "info");
      } else {
        showError(err);
      }
    }
  };

  const onExportMarkdown = () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export isn't available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    markdownDownload(targets, { brandKit: readBrandKit() });
    analytics.exported({ format: "markdown", count: targets.length, source: "dashboard" });
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to Markdown`, "file-code");
  };

  const onExportJson = () => {
    if (!checkCanExport("json")) { showToast("JSON export isn't available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    jsonDownload(targets, { brandKit: readBrandKit() });
    analytics.exported({ format: "json", count: targets.length, source: "dashboard" });
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to JSON`, "file-json");
  };

  // F01 — Clipboard copy. Plan-gate the same way as the file download.
  const onCopyCsv = async () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    const out = await copyToClipboard(targets, "csv");
    if (out.ok) {
      analytics.exported({ format: "clipboard-csv", count: targets.length, source: "dashboard" });
      showToast(`Copied ${targets.length} page${targets.length > 1 ? "s" : ""} to clipboard (CSV)`, "clipboard-copy");
    } else {
      showToast(`Copy failed (${out.reason || "unknown"}). Use the CSV download instead.`, "alert-triangle");
    }
  };
  const onCopyMarkdown = async () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export isn't available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    const out = await copyToClipboard(targets, "markdown");
    if (out.ok) {
      analytics.exported({ format: "clipboard-markdown", count: targets.length, source: "dashboard" });
      showToast(`Copied ${targets.length} page${targets.length > 1 ? "s" : ""} to clipboard (Markdown)`, "clipboard-copy");
    } else {
      showToast(`Copy failed (${out.reason || "unknown"}). Use the Markdown download instead.`, "alert-triangle");
    }
  };
  const onCopyJson = async () => {
    if (!checkCanExport("json")) { showToast("JSON export isn't available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    const out = await copyToClipboard(targets, "json");
    if (out.ok) {
      analytics.exported({ format: "clipboard-json", count: targets.length, source: "dashboard" });
      showToast(`Copied ${targets.length} page${targets.length > 1 ? "s" : ""} to clipboard (JSON)`, "clipboard-copy");
    } else {
      showToast(`Copy failed (${out.reason || "unknown"}). Use the JSON download instead.`, "alert-triangle");
    }
  };

  const handleDeleteBatchRun = (id) => {
    deleteBatchRun(id);
    setBatchRuns(listBatchRuns());
    if (batchFilter === id) setBatchFilter(null);
    batchMap.current = readBatchMap();
  };

  const hasItems = items.length > 0;
  const exportCount = selected.size || filtered.length;
  const exportLabel = selected.size ? `${selected.size} selected` : `all ${filtered.length}`;

  // Render one extraction row (used for standalone singles AND group children).
  const renderItemRow = (it, child) => (
    <tr
      key={it.id}
      className={(selected.has(it.id) ? "sel" : "") + (it._demo ? " demo-row" : "") + (child ? " dash-child-row" : "")}
      onClick={() => view(it)}
    >
      <td className="col-check" onClick={(e) => e.stopPropagation()}>
        {!it._demo && <Check checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} title="Select extraction" />}
      </td>
      <td>
        <div className="td-page">
          <FaviconDot url={it.url} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="td-title">{it.page_title}{it._demo && <DemoBadge />}</div>
            <div className="td-url">{hostOf(it.url)}{pathOf(it.url) !== "/" ? pathOf(it.url) : ""}</div>
          </div>
        </div>
      </td>
      <td className="col-type"><CategoryChip category={categoryOf(it.id)} /></td>
      <td className="col-sum"><span className="td-sum">{snippet(it.ai_summary, 150)}</span></td>
      <td className="col-struct">
        <div className="td-struct">
          <span><b>{it.headings.length}</b> headings</span>
          <span><b>{it.links.length}</b> links</span>
        </div>
      </td>
      <td className="col-date"><span className="td-date">{fmtDate(it.created_at)}</span></td>
      <td className="col-act">
        <RowActions
          item={it}
          onView={view}
          onDelete={onDelete}
          collectionProps={{
            collections: collectionSummaries,
            onSelect: (name) => handleSetCollection(it, name),
            onCreate: (name) => handleSetCollection(it, name),
          }}
        />
      </td>
    </tr>
  );

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 36, paddingBottom: 72 }}>
        {/* Guest rows live in localStorage only — say so, and claim them on
            sign-in. See extractionsRepo.shouldFallback's 401 branch. */}
        <LocalDataNotice onClaimed={refreshData} />
        <div className="dash-tabs" role="tablist" aria-label="Dashboard views">
          <button role="tab" aria-selected={dashView === "saved"}
            className={"dash-tab" + (dashView === "saved" ? " active" : "")}
            // "Extractions", not "Saved pages": the page's own eyebrow already
            // reads "Saved", so a tab containing that word was both redundant
            // on screen and ambiguous to anything matching on it. It also
            // pairs better with "Workflow runs" — extractions and runs are the
            // two different objects this page holds.
            onClick={() => setDashView("saved")}>Extractions</button>
          <button role="tab" aria-selected={dashView === "runs"}
            className={"dash-tab" + (dashView === "runs" ? " active" : "")}
            onClick={() => setDashView("runs")}>Workflow runs</button>
        </div>

        {dashView === "runs" ? (
          <section className="card card-pad dash-runs">
            <div className="dash-header">
              <div>
                <div className="eyebrow"><Icon name="layout-list" size={13} /> Workflow runs</div>
                <h1 className="dash-h1">Every template run</h1>
                <p className="dash-sub">
                  Including the ones that failed — those were never saved as extractions,
                  so this is the only place they appear.
                </p>
              </div>
            </div>
            <WorkflowRunHistory />
          </section>
        ) : (
        <>
        <div className="dash-header">
          <div>
            <div className="eyebrow">
              <Icon name="bookmark" size={13} /> Saved
            </div>
            <h1 className="dash-h1">{persona ? persona.dashboardLabel : "Your extractions"}</h1>
            <p className="dash-sub">
              {loading ? "Loading…" : items.length === 0 ? "No saved extractions yet." : `${items.length} saved ${items.length === 1 ? "page" : "pages"}, newest first.`}
            </p>
          </div>
          <div className="dash-header-actions">
            <BatchRunsDropdown
              runs={batchRuns}
              activeRunId={batchFilter}
              onSelect={setBatchFilter}
              onDelete={handleDeleteBatchRun}
            />
            {/* Groke QW#2 — tag filter chips */}
            <TagFilter
              items={items}
              value={tagFilter}
              onChange={setTagFilter}
            />
            {/* Groke QW#3 — collection filter dropdown */}
            <CollectionFilter
              items={items}
              value={collectionFilter}
              onChange={setCollectionFilter}
            />
            <div className="seg-filter layout-seg">
              <button className={"seg-opt" + (layout === "table" ? " on" : "")} onClick={() => changeLayout("table")} title="Table view">
                <Icon name="table" size={15} />
              </button>
              <button className={"seg-opt" + (layout === "cards" ? " on" : "")} onClick={() => changeLayout("cards")} title="Card view">
                <Icon name="grid" size={15} />
              </button>
            </div>
            {/* Export and Push share selection semantics (exportTargets: the
                selection when there is one, otherwise everything filtered) —
                which is why they are one component now. Push used to live only
                in the floating selection bar, which is why that bar existed. */}
            {hasItems && (
              <ExportMenu
                items={exportItems}
                label={exportLabel}
                buttonVariant="secondary"
                disabled={exportCount === 0}
                onPushAdvanced={() => exportCount > 0 && setIntegrationsOpen(true)}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              icon="refresh"
              onClick={refreshData}
              disabled={refreshing}
              title="Refresh from database"
            >
              {refreshing ? "…" : "Refresh"}
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate("/")}>
              New extraction
            </Button>
          </div>
        </div>

        {/* Active batch run filter banner */}
        {batchFilter && (() => {
          const run = batchRuns.find((r) => r.id === batchFilter);
          return run ? (
            <div className="batch-filter-banner">
              <Icon name="layers-2" size={14} />
              <span>
                Showing <b>{run.label}</b> — {run.successCount} saved
                {run.failedCount > 0 && `, ${run.failedCount} failed`}
              </span>
              {/* Dashboard only holds the SAVED pages — failures were never
                  saved as extractions, so the run's own results view is the
                  only place to see them (and retry them). */}
              {run.failedCount > 0 && (
                <button className="batch-filter-clear" onClick={() => navigate(`/batch?run=${run.id}`)} title="Open this run's results">
                  <Icon name="arrow-up-right" size={13} /> View run
                </button>
              )}
              <button className="batch-filter-clear" onClick={() => setBatchFilter(null)} title="Clear filter">
                <Icon name="x" size={13} /> Show all
              </button>
            </div>
          ) : null;
        })()}

        {/* search toolbar */}
        {!loading && hasItems && (
          <div className="dash-toolbar">
            <div className="field-shell dash-search">
              <span className="field-lead"><Icon name="search" size={18} /></span>
              <input
                className="field-input"
                type="text"
                placeholder="Search titles, URLs, summaries, headings & links…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search extractions"
              />
              {query && (
                <button className="dash-search-clear" onClick={() => setQuery("")} aria-label="Clear search" title="Clear search">
                  <Icon name="x" size={15} />
                </button>
              )}
            </div>
            <div className="seg-filter dash-type-filter">
              {[
                { k: "all", label: "All", icon: "list-checks" },
                { k: "single", label: "Single", icon: "globe" },
                { k: "batch", label: "Batch", icon: "layers-2" },
                { k: "schedule", label: "Scheduled", icon: "calendar-clock" },
              ].map((t) => (
                <button
                  key={t.k}
                  className={"seg-opt" + (typeFilter === t.k ? " on" : "")}
                  onClick={() => setTypeFilter(t.k)}
                  title={`Show ${t.label.toLowerCase()} extractions`}
                >
                  <Icon name={t.icon} size={13} /> <span className="dash-type-label">{t.label}</span>
                </button>
              ))}
            </div>
            <div className="dash-toolbar-right">
              {selected.size > 0 ? (
                <>
                  <span className="dash-count">{selected.size} selected</span>
                  <button className="dash-sel-action-btn" onClick={() => selectedItems.length > 0 && setContentItem(selectedItems[0])}>
                    <Icon name="wand" size={14} /> Generate
                  </button>
                  <button className="dash-sel-action-btn" onClick={() => selectedItems.length > 0 && setEmailOpen(true)}>
                    <Icon name="mail" size={14} /> Email
                  </button>
                  <button
                    className="dash-sel-action-btn"
                    onClick={() => {
                      const prospectsToEngage = selectedItems.map((it) => ({
                        company: it.page_title || "",
                        domain: hostOf(it.url),
                        source_url: it.url,
                      }));
                      navigate("/engagement", { state: { importProspects: prospectsToEngage } });
                    }}
                    title="Send selected targets to Prospect Engagement Engine"
                  >
                    <Icon name="send" size={14} /> Engage
                  </button>
                  <button className="dash-sel-action-btn" onClick={clearSelection} title="Clear selection">
                    <Icon name="x" size={13} />
                  </button>
                </>
              ) : (
                <span className="dash-count">
                  {query ? `${filtered.length} of ${items.length}` : `${items.length} total`}
                </span>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <BrandLoader className="card rise" title="Loading your extractions…" sub="Fetching your saved pages" />
        ) : items.length === 0 ? (
          <div className="empty-state card rise">
            <div className="empty-orb"><Icon name="bookmark" size={28} /></div>
            <h2>Nothing saved yet</h2>
            <p>Extract a page and save it to build your library.</p>
            <Button variant="primary" icon="globe" onClick={() => navigate("/")}>Extract a page</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state card rise">
            <div className="empty-orb"><Icon name="search" size={28} /></div>
            <h2>No matches</h2>
            <p>No saved extractions match "{query}".</p>
            <Button variant="secondary" icon="x" onClick={() => setQuery("")}>Clear search</Button>
          </div>
        ) : layout === "cards" ? (
          <>
            <div className="dash-grid rise">
              {pageItems.map((it) => (
                <DashCard key={it.id} item={it} selected={selected.has(it.id)} onToggle={toggleOne} onView={view} onDelete={onDelete} category={categoryOf(it.id)} />
              ))}
            </div>
            <Pager page={page} totalPages={totalPages} start={start} shown={pageItems.length} total={filtered.length} onPage={setPage} />
          </>
        ) : (
          <>
            <div className="card rise table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <Check checked={pageAllSelected} indeterminate={pageSomeSelected && !pageAllSelected} onChange={togglePage} title="Select all on this page" />
                    </th>
                    <th>Page</th>
                    <th className="col-type">Type</th>
                    <th className="col-sum">AI summary</th>
                    <th className="col-struct">Structure</th>
                    <th className="col-date">Extracted</th>
                    <th className="col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageBlocks.map((b) => {
                    // ── Standalone single extraction ──
                    if (b.type === "single") return renderItemRow(b.item, false);
                    // ── Collapsible run group (batch / scheduled) ──
                    const open = expandedGroups.has(b.groupId);
                    const cat = b.kind === "schedule" ? "schedule" : "batch";
                    return (
                      <Fragment key={b.groupId}>
                        <tr className={"dash-group-row" + (open ? " open" : "")} onClick={() => toggleGroup(b.groupId)}>
                          <td className="col-check"><Icon name={open ? "chevron-down" : "chevron-right"} size={16} className="dash-group-caret" /></td>
                          <td colSpan={6}>
                            <div className="dash-group-head">
                              <CategoryChip category={cat} />
                              <span className="dash-group-label">{b.label}</span>
                              <span className="dash-group-count"><Icon name="globe" size={11} /> {b.items.length} page{b.items.length !== 1 ? "s" : ""}</span>
                              <span className="dash-group-date">{fmtDate(b.date)}</span>
                            </div>
                          </td>
                        </tr>
                        {open && b.items.map((it) => renderItemRow(it, true))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={totalPages} start={start} shown={pageItems.length} total={filtered.length} onPage={setPage} />
          </>
        )}
        </>
        )}
      </div>


      {emailOpen && selectedItems.length > 0 && (
        <EmailModal
          items={selectedItems}
          hint="Sent as a real attached file — pick a format below."
          formats={["csv", "pdf", "markdown", "json"].filter(checkCanExport)}
          onSend={handleSend}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {contentItem && (
        <ContentModal item={contentItem} onClose={() => setContentItem(null)} />
      )}

      {integrationsOpen && (
        <ExportIntegrations
          items={exportItems || []}
          onClose={() => setIntegrationsOpen(false)}
        />
      )}
    </div>
  );
}
