// Dashboard.jsx — historical view of saved extractions (route "/dashboard").
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import BrandLoader from "../components/BrandLoader.jsx";
import EmailModal from "../components/EmailModal.jsx";
import ContentModal from "../components/ContentModal.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { usePersona } from "../components/PersonaProvider.jsx";
import { PERSONA_BY_ID } from "../lib/personaConfig.js";
import { useBilling } from "../components/BillingProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useErrorModal } from "../components/ErrorModal.jsx";
import { LOAD_ERROR, DELETE_ERROR } from "../lib/errorMessages.js";
import { listExtractions, deleteExtraction } from "../lib/extractionsRepo.js";
import { DEMO_EXTRACTIONS } from "../data/mockData.js";
import { sendExtractionsEmail } from "../lib/emailService.js";
import { hostOf, pathOf, fmtDate, timeAgo, snippet, csvDownload, markdownDownload, jsonDownload } from "../lib/utils.js";
import { readEnrichments } from "../lib/enrichmentStore.js";

// Merge an item's stored enrichments (Supabase column + local cache, newest per
// capability) so exports include every capability run against the URL — even
// when the Supabase `enrichments` column hasn't been migrated yet.
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

// Approx. pixel cost of one row (table) and the chrome around the list
// (header, toolbar, pager). Used to fit as many rows as the viewport allows.
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
  try {
    localStorage.setItem("datiq.dashLayout", layout);
  } catch {
    /* ignore */
  }
}
function initialLayout() {
  try {
    const v = localStorage.getItem("datiq.dashLayout");
    if (v === "cards" || v === "table") return v;
  } catch {
    /* ignore */
  }
  return "table";
}

// Flatten an extraction into one lowercased string for smart search matching.
function haystack(it) {
  return [
    it.page_title,
    it.url,
    it.ai_summary,
    ...(it.headings || []).map((h) => h.text),
    ...(it.links || []).flatMap((l) => [l.text, l.href]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Build the list of page numbers/ellipses to render in the pager.
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
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      role="checkbox"
      aria-checked={indeterminate && !checked ? "mixed" : checked}
      title={title}
    >
      {checked ? (
        <Icon name="check" size={13} strokeWidth={3} />
      ) : indeterminate ? (
        <Icon name="minus" size={13} strokeWidth={3} />
      ) : null}
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
        <button
          className="pager-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <Icon name="chevron-left" size={16} />
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === "…" ? (
            <span key={"ell" + i} className="pager-ellipsis">
              …
            </span>
          ) : (
            <button
              key={p}
              className={"pager-btn" + (p === page ? " on" : "")}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          className="pager-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </div>
  );
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
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          onClick={() => onDelete(item)}
          title="Delete"
          className="del-btn"
        />
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
          <div className="dash-card-title">
            {item.page_title}
            {item._demo && <DemoBadge />}
          </div>
          <div className="dash-card-url">
            {hostOf(item.url)}
            {pathOf(item.url) !== "/" ? pathOf(item.url) : ""}
          </div>
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
          <span title="Headings">
            <Icon name="hash" size={14} /> {item.headings.length}
          </span>
          <span title="Links">
            <Icon name="link" size={14} /> {item.links.length}
          </span>
          <span title="Extracted">
            <Icon name="clock" size={14} /> {timeAgo(item.created_at)}
          </span>
        </div>
        <RowActions item={item} onView={onView} onDelete={onDelete} compact />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const showToast = useToast();
  const showError = useErrorModal();
  const { view } = useExtraction();
  const { openAuth } = useAuth();
  const { personaId } = usePersona();
  const { checkCanExport, checkCanEmail } = useBilling();
  const persona = personaId ? PERSONA_BY_ID[personaId] : null;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState(initialLayout);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(() => new Set());
  const [emailOpen, setEmailOpen] = useState(false);
  const [contentItem, setContentItem] = useState(null);
  const [pageSize, setPageSize] = useState(rowsForViewport);

  // Keep rows-per-page in step with the viewport height so the table fills the
  // page without overflowing it; overflow rolls into pagination.
  useEffect(() => {
    const onResize = () => setPageSize(rowsForViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    listExtractions()
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((err) => {
        console.error("[DatIQ] Failed to load extractions:", err);
        if (alive) showError(err, LOAD_ERROR);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show pre-populated demo extractions when the user has no saved items yet.
  const showingDemo = !loading && items.length === 0;
  const displayItems = showingDemo ? DEMO_EXTRACTIONS : items;

  // ── Smart search ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displayItems;
    const terms = q.split(/\s+/);
    return displayItems.filter((it) => {
      const hay = haystack(it);
      return terms.every((t) => hay.includes(t));
    });
  }, [displayItems, query]);

  // ── Pagination ─────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => {
    setPage(1);
  }, [query]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // ── Selection ──────────────────────────────────────────────────
  const pageIds = pageItems.map((it) => it.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));
  const selectedItems = items.filter((it) => selected.has(it.id));

  const toggleOne = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (pageAllSelected) pageIds.forEach((id) => n.delete(id));
      else pageIds.forEach((id) => n.add(id));
      return n;
    });
  const clearSelection = () => setSelected(new Set());

  const changeLayout = (l) => {
    setLayout(l);
    persistLayout(l);
  };

  const onDelete = async (item) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== item.id)); // optimistic
    setSelected((s) => {
      if (!s.has(item.id)) return s;
      const n = new Set(s);
      n.delete(item.id);
      return n;
    });
    try {
      await deleteExtraction(item.id);
      showToast("Extraction deleted", "trash");
    } catch (err) {
      console.error("[DatIQ] Delete failed:", err);
      setItems(prev); // rollback optimistic update
      showError(err, DELETE_ERROR, () => onDelete(item));
    }
  };

  // ── Email selected ─────────────────────────────────────────────
  const handleSend = async (emails) => {
    if (!checkCanEmail()) { showToast("Email export requires the Select plan or higher."); setEmailOpen(false); return; }
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
  };

  // ── Export (CSV / PDF) ─────────────────────────────────────────
  // Export the selected rows; if nothing is selected, export everything that
  // currently matches the search. Each export bundles ALL of a page's data,
  // including every Quick-Enrichment capability.
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
      // Lazy-load the PDF library so jsPDF only ships when someone exports.
      const { extractionsToPdf } = await import("../lib/pdfExport.js");
      extractionsToPdf(targets);
      showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to PDF`, "file");
    } catch (err) {
      console.error("[DatIQ] PDF export failed:", err);
      showError(err);
    }
  };

  const onExportMarkdown = () => {
    if (!checkCanExport("markdown")) { showToast("Markdown export requires the Select plan or higher. Upgrade to unlock."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    markdownDownload(targets);
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to Markdown`, "file-code");
  };

  const onExportJson = () => {
    if (!checkCanExport("json")) { showToast("JSON export requires the Pro plan or higher. Upgrade to unlock."); return; }
    const targets = exportTargets();
    if (!targets.length) return;
    jsonDownload(targets);
    showToast(`Exported ${targets.length} page${targets.length > 1 ? "s" : ""} to JSON`, "file-json");
  };

  const hasItems = items.length > 0; // only real items enable export
  const exportCount = selected.size || filtered.length;
  const exportLabel = selected.size
    ? `${selected.size} selected`
    : `all ${filtered.length}`;

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
              {loading
                ? "Loading…"
                : showingDemo
                  ? (persona ? persona.dashboardSub + " — sample data shown below." : "Sample data — save a real extraction to build your library.")
                  : `${items.length} saved ${items.length === 1 ? "page" : "pages"}, newest first.`}
            </p>
          </div>
          <div className="dash-header-actions">
            <div className="seg-filter layout-seg">
              <button
                className={"seg-opt" + (layout === "table" ? " on" : "")}
                onClick={() => changeLayout("table")}
                title="Table view"
              >
                <Icon name="table" size={15} />
              </button>
              <button
                className={"seg-opt" + (layout === "cards" ? " on" : "")}
                onClick={() => changeLayout("cards")}
                title="Card view"
              >
                <Icon name="grid" size={15} />
              </button>
            </div>
            {hasItems && (
              <div className="dash-export">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="download"
                  onClick={onExportCsv}
                  disabled={exportCount === 0}
                  title={`Download ${exportLabel} as CSV`}
                >
                  CSV
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="file"
                  onClick={onExportPdf}
                  disabled={exportCount === 0}
                  title={`Download ${exportLabel} as PDF (Select+)`}
                >
                  PDF
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="file-code"
                  onClick={onExportMarkdown}
                  disabled={exportCount === 0}
                  title={`Download ${exportLabel} as Markdown (Select+)`}
                >
                  MD
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="file-json"
                  onClick={onExportJson}
                  disabled={exportCount === 0}
                  title={`Download ${exportLabel} as JSON (Pro+)`}
                >
                  JSON
                </Button>
              </div>
            )}
            <Button variant="primary" icon="plus" onClick={() => navigate("/")}>
              New extraction
            </Button>
          </div>
        </div>

        {/* search + selection toolbar */}
        {!loading && hasItems && (
          <div className="dash-toolbar">
            <div className="field-shell dash-search">
              <span className="field-lead">
                <Icon name="search" size={18} />
              </span>
              <input
                className="field-input"
                type="text"
                placeholder="Search titles, URLs, summaries, headings & links…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search extractions"
              />
              {query && (
                <button
                  className="dash-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <Icon name="x" size={15} />
                </button>
              )}
            </div>
            <div className="dash-toolbar-right">
              {selected.size > 0 ? (
                <div className="dash-selbar">
                  <span className="dash-sel-count">{selected.size} selected</span>
                  <Button size="sm" variant="ghost" onClick={clearSelection}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="wand"
                    onClick={() => setContentItem(selectedItems[0])}
                    title={
                      selected.size > 1
                        ? "Generate content from the first selected extraction"
                        : "Generate content"
                    }
                  >
                    Generate
                  </Button>
                  <Button size="sm" variant="primary" icon="mail" onClick={() => setEmailOpen(true)}>
                    Send email
                  </Button>
                </div>
              ) : (
                <span className="dash-count">
                  {query ? `${filtered.length} of ${items.length}` : `${items.length} total`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Demo banner — shown when displaying sample data */}
        {showingDemo && (
          <div className="demo-banner">
            <span className="demo-banner-icon"><Icon name="flask" size={15} /></span>
            <div className="demo-banner-body">
              <strong>Sample data</strong>
              <span> — These 3 extractions show what DatIQ captures. </span>
              <button className="demo-banner-cta" onClick={() => navigate("/")}>
                Extract a real page
              </button>
              <span> or </span>
              <button className="demo-banner-cta" onClick={openAuth}>
                sign in
              </button>
              <span> to save your own.</span>
            </div>
          </div>
        )}

        {loading ? (
          <BrandLoader
            className="card rise"
            title="Loading your extractions…"
            sub="Fetching your saved pages"
          />
        ) : filtered.length === 0 ? (
          <div className="empty-state card rise">
            <div className="empty-orb">
              <Icon name="search" size={28} />
            </div>
            <h2>No matches</h2>
            <p>No saved extractions match “{query}”.</p>
            <Button variant="secondary" icon="x" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </div>
        ) : layout === "cards" ? (
          <>
            <div className="dash-grid rise">
              {pageItems.map((it) => (
                <DashCard
                  key={it.id}
                  item={it}
                  selected={selected.has(it.id)}
                  onToggle={toggleOne}
                  onView={view}
                  onDelete={onDelete}
                />
              ))}
            </div>
            <Pager
              page={page}
              totalPages={totalPages}
              start={start}
              shown={pageItems.length}
              total={filtered.length}
              onPage={setPage}
            />
          </>
        ) : (
          <>
            <div className="card rise table-wrap">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <Check
                        checked={pageAllSelected}
                        indeterminate={pageSomeSelected && !pageAllSelected}
                        onChange={togglePage}
                        title="Select all on this page"
                      />
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
                    <tr
                      key={it.id}
                      className={(selected.has(it.id) ? "sel" : "") + (it._demo ? " demo-row" : "")}
                      onClick={() => view(it)}
                    >
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        {!it._demo && (
                          <Check
                            checked={selected.has(it.id)}
                            onChange={() => toggleOne(it.id)}
                            title="Select extraction"
                          />
                        )}
                      </td>
                      <td>
                        <div className="td-page">
                          <FaviconDot url={it.url} size={34} />
                          <div style={{ minWidth: 0 }}>
                            <div className="td-title">
                              {it.page_title}
                              {it._demo && <DemoBadge />}
                            </div>
                            <div className="td-url">
                              {hostOf(it.url)}
                              {pathOf(it.url) !== "/" ? pathOf(it.url) : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="col-sum">
                        <span className="td-sum">{snippet(it.ai_summary, 150)}</span>
                      </td>
                      <td className="col-struct">
                        <div className="td-struct">
                          <span>
                            <b>{it.headings.length}</b> headings
                          </span>
                          <span>
                            <b>{it.links.length}</b> links
                          </span>
                        </div>
                      </td>
                      <td className="col-date">
                        <span className="td-date">{fmtDate(it.created_at)}</span>
                      </td>
                      <td className="col-act">
                        <RowActions item={it} onView={view} onDelete={onDelete} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              totalPages={totalPages}
              start={start}
              shown={pageItems.length}
              total={filtered.length}
              onPage={setPage}
            />
          </>
        )}
      </div>

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
