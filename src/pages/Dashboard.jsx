// Dashboard.jsx — historical view of saved extractions (route "/dashboard").
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import BrandLoader from "../components/BrandLoader.jsx";
import EmailModal from "../components/EmailModal.jsx";
import ContentModal from "../components/ContentModal.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useErrorModal } from "../components/ErrorModal.jsx";
import { LOAD_ERROR, DELETE_ERROR } from "../lib/errorMessages.js";
import { listExtractions, deleteExtraction } from "../lib/extractionsRepo.js";
import { sendExtractionsEmail } from "../lib/emailService.js";
import { hostOf, pathOf, fmtDate, timeAgo, snippet, csvDownload, markdownDownload, jsonDownload } from "../lib/utils.js";
import { readEnrichments } from "../lib/enrichmentStore.js";

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

function RowActions({ item, onView, onDelete, compact }) {
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <Button variant="secondary" size="sm" icon="arrow-up-right" onClick={() => onView(item)}>
        {compact ? "" : "View"}
      </Button>
      {!item._demo && (
        <Button variant="ghost" size="sm" icon="trash" onClick={() => onDelete(item)} title="Delete" className="del-btn" />
      )}
    </div>
  );
}

function DashCard({ item, selected, onToggle, onView, onDelete }) {
  return (
    <div className={"dash-card card" + (selected ? " sel" : "") + (item._demo ? " demo-item" : "")} onClick={() => onView(item)}>
      <div className="dash-card-top">
        <FaviconDot url={item.url} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="dash-card-title">{item.page_title}{item._demo && <DemoBadge />}</div>
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
function ExportDropdown({ onCsv, onPdf, onMarkdown, onJson, disabled, label }) {
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
          <button className="export-dropdown-item" onClick={() => { onCsv(); setOpen(false); }}>
            <Icon name="download" size={14} /> <span><b>CSV</b><span className="export-plan-hint">All plans</span></span>
          </button>
          <button className="export-dropdown-item" onClick={() => { onPdf(); setOpen(false); }}>
            <Icon name="file" size={14} /> <span><b>PDF</b><span className="export-plan-hint">Select+</span></span>
          </button>
          <button className="export-dropdown-item" onClick={() => { onMarkdown(); setOpen(false); }}>
            <Icon name="file-code" size={14} /> <span><b>Markdown</b><span className="export-plan-hint">Select+</span></span>
          </button>
          <button className="export-dropdown-item" onClick={() => { onJson(); setOpen(false); }}>
            <Icon name="file-json" size={14} /> <span><b>JSON</b><span className="export-plan-hint">Pro+</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Floating selection action bar ─────────────────────────────────────────────
function SelectionBar({ count, selectedItems, onClear, onGenerate, onEmail, onCsv, onPdf, onMarkdown, onJson }) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  return (
    <div className="dash-float-bar" role="toolbar" aria-label="Selection actions">
      <div className="dash-float-left">
        <span className="dash-float-count">
          <Icon name="check-square" size={15} />
          {count} selected
        </span>
        <button className="dash-float-clear" onClick={onClear}>
          <Icon name="x" size={13} /> Clear
        </button>
      </div>
      <div className="dash-float-actions">
        <button className="dash-float-btn" onClick={onGenerate} title="Generate SEO outline, competitor summary or social posts">
          <Icon name="wand" size={15} />
          <span>Generate</span>
        </button>
        <button className="dash-float-btn" onClick={onEmail} title="Email selected extractions">
          <Icon name="mail" size={15} />
          <span>Email</span>
        </button>
        <div className="dash-float-export" ref={exportRef}>
          <button className="dash-float-btn" onClick={() => setExportOpen((v) => !v)} title="Export selected">
            <Icon name="download" size={15} />
            <span>Export</span>
            <Icon name="chevron-down" size={12} />
          </button>
          {exportOpen && (
            <div className="export-dropdown-menu export-dropdown-menu--up">
              <button className="export-dropdown-item" onClick={() => { onCsv(); setExportOpen(false); }}>
                <Icon name="download" size={14} /> <span><b>CSV</b><span className="export-plan-hint">All plans</span></span>
              </button>
              <button className="export-dropdown-item" onClick={() => { onPdf(); setExportOpen(false); }}>
                <Icon name="file" size={14} /> <span><b>PDF</b><span className="export-plan-hint">Select+</span></span>
              </button>
              <button className="export-dropdown-item" onClick={() => { onMarkdown(); setExportOpen(false); }}>
                <Icon name="file-code" size={14} /> <span><b>Markdown</b><span className="export-plan-hint">Select+</span></span>
              </button>
              <button className="export-dropdown-item" onClick={() => { onJson(); setExportOpen(false); }}>
                <Icon name="file-json" size={14} /> <span><b>JSON</b><span className="export-plan-hint">Pro+</span></span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const showToast = useToast();
  const showError = useErrorModal();
  const { view } = useExtraction();
  const { personaId } = usePersona();
  const { checkCanExport, checkCanEmail } = useBilling();
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;

  const [items, setItems] = useState(readLocalItems);
  const [loading, setLoading] = useState(() => readLocalItems().length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [layout, setLayout] = useState(initialLayout);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [emailOpen, setEmailOpen] = useState(false);
  const [contentItem, setContentItem] = useState(null);
  const [pageSize, setPageSize] = useState(rowsForViewport);

  useEffect(() => {
    const onResize = () => setPageSize(rowsForViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    listExtractions()
      .then((rows) => { if (alive) { setItems(rows); setLoading(false); } })
      .catch((err) => { console.error("[DatIQ] Failed to load extractions:", err); if (alive) { showError(err, LOAD_ERROR); setLoading(false); } })
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const terms = q.split(/\s+/);
    return items.filter((it) => { const hay = haystack(it); return terms.every((t) => hay.includes(t)); });
  }, [items, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

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

  const handleSend = async (emails) => {
    if (!checkCanEmail()) { showToast("Email export requires the Select plan or higher."); setEmailOpen(false); return; }
    try {
      const res = await sendExtractionsEmail({ to: emails, items: selectedItems });
      setEmailOpen(false);
      setSelected(new Set());
      showToast(
        res.via === "mailto"
          ? "Opening your email app…"
          : `Email sent to ${emails.length} recipient${emails.length > 1 ? "s" : ""}`,
        "mail",
      );
      return res;
    } catch (err) {
      throw err; // re-throw so EmailModal can show the error
    }
  };

  const exportTargets = () => (selected.size ? selectedItems : filtered).map(withEnrichments);

  const onExportCsv = () => {
    if (!checkCanExport("csv")) { showToast("CSV export is not available on your current plan."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    csvDownload(targets);
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to CSV`, "download");
  };

  const onExportPdf = async () => {
    if (!checkCanExport("pdf")) { showToast("PDF export requires the Select plan or higher. Upgrade to unlock."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    try {
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      extractionsToPdf(targets);
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
    if (!checkCanExport("markdown")) { showToast("Markdown export requires the Select plan or higher."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    markdownDownload(targets);
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to Markdown`, "file-code");
  };

  const onExportJson = () => {
    if (!checkCanExport("json")) { showToast("JSON export requires the Pro plan or higher."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    jsonDownload(targets);
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to JSON`, "file-json");
  };

  const hasItems = items.length > 0;
  const exportCount = selected.size || filtered.length;
  const exportLabel = selected.size ? `${selected.size} selected` : `all ${filtered.length}`;

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 36, paddingBottom: 72 }}>
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
            <div className="seg-filter layout-seg">
              <button className={"seg-opt" + (layout === "table" ? " on" : "")} onClick={() => changeLayout("table")} title="Table view">
                <Icon name="table" size={15} />
              </button>
              <button className={"seg-opt" + (layout === "cards" ? " on" : "")} onClick={() => changeLayout("cards")} title="Card view">
                <Icon name="grid" size={15} />
              </button>
            </div>
            {hasItems && (
              <ExportDropdown
                onCsv={onExportCsv}
                onPdf={onExportPdf}
                onMarkdown={onExportMarkdown}
                onJson={onExportJson}
                disabled={exportCount === 0}
                label={exportLabel}
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
            <div className="dash-toolbar-right">
              {selected.size > 0 ? (
                <>
                  <span className="dash-count">{selected.size} selected</span>
                  <button className="dash-sel-action-btn" onClick={() => setContentItem(selectedItems[0])}>
                    <Icon name="wand" size={14} /> Generate
                  </button>
                  <button className="dash-sel-action-btn" onClick={() => setEmailOpen(true)}>
                    <Icon name="mail" size={14} /> Email
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
                <DashCard key={it.id} item={it} selected={selected.has(it.id)} onToggle={toggleOne} onView={view} onDelete={onDelete} />
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
                    <th className="col-sum">AI summary</th>
                    <th className="col-struct">Structure</th>
                    <th className="col-date">Extracted</th>
                    <th className="col-act"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((it) => (
                    <tr key={it.id} className={(selected.has(it.id) ? "sel" : "") + (it._demo ? " demo-row" : "")} onClick={() => view(it)}>
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
                      <td className="col-sum"><span className="td-sum">{snippet(it.ai_summary, 150)}</span></td>
                      <td className="col-struct">
                        <div className="td-struct">
                          <span><b>{it.headings.length}</b> headings</span>
                          <span><b>{it.links.length}</b> links</span>
                        </div>
                      </td>
                      <td className="col-date"><span className="td-date">{fmtDate(it.created_at)}</span></td>
                      <td className="col-act"><RowActions item={it} onView={view} onDelete={onDelete} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} totalPages={totalPages} start={start} shown={pageItems.length} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>

      {/* Floating selection bar — appears when rows are selected */}
      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          selectedItems={selectedItems}
          onClear={clearSelection}
          onGenerate={() => setContentItem(selectedItems[0])}
          onEmail={() => setEmailOpen(true)}
          onCsv={onExportCsv}
          onPdf={onExportPdf}
          onMarkdown={onExportMarkdown}
          onJson={onExportJson}
        />
      )}

      {emailOpen && selectedItems.length > 0 && (
        <EmailModal
          items={selectedItems}
          hint="Each email includes the page title, URL, AI summary and link/heading counts."
          onSend={handleSend}
          onClose={() => setEmailOpen(false)}
        />
      )}

      {contentItem && (
        <ContentModal item={contentItem} onClose={() => setContentItem(null)} />
      )}
    </div>
  );
}
