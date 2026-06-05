// Dashboard.jsx — historical view of saved extractions (route "/dashboard").
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useErrorModal } from "../components/ErrorModal.jsx";
import { LOAD_ERROR, DELETE_ERROR } from "../lib/errorMessages.js";
import { listExtractions, deleteExtraction } from "../lib/extractionsRepo.js";
import { hostOf, pathOf, fmtDate, timeAgo, snippet, csvDownload } from "../lib/utils.js";

function persistLayout(layout) {
  try {
    localStorage.setItem("scrapelite.dashLayout", layout);
  } catch {
    /* ignore */
  }
}
function initialLayout() {
  try {
    const v = localStorage.getItem("scrapelite.dashLayout");
    if (v === "cards" || v === "table") return v;
  } catch {
    /* ignore */
  }
  return "table";
}

function RowActions({ item, onView, onExport, onDelete, compact }) {
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <Button variant="secondary" size="sm" icon="download" onClick={() => onExport(item)}>
        {compact ? "" : "CSV"}
      </Button>
      <Button variant="ghost" size="sm" icon="arrow-up-right" onClick={() => onView(item)} title="Open">
        {compact ? "" : "View"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon="trash"
        onClick={() => onDelete(item)}
        title="Delete"
        className="del-btn"
      />
    </div>
  );
}

function DashCard({ item, onView, onExport, onDelete }) {
  return (
    <div className="dash-card card" onClick={() => onView(item)}>
      <div className="dash-card-top">
        <FaviconDot url={item.url} size={38} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="dash-card-title">{item.page_title}</div>
          <div className="dash-card-url">
            {hostOf(item.url)}
            {pathOf(item.url) !== "/" ? pathOf(item.url) : ""}
          </div>
        </div>
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
        <RowActions item={item} onView={onView} onExport={onExport} onDelete={onDelete} compact />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const showToast = useToast();
  const showError = useErrorModal();
  const { view } = useExtraction();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState(initialLayout);

  useEffect(() => {
    let alive = true;
    listExtractions()
      .then((rows) => {
        if (alive) setItems(rows);
      })
      .catch((err) => {
        console.error("[ScrapeLite] Failed to load extractions:", err);
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

  const changeLayout = (l) => {
    setLayout(l);
    persistLayout(l);
  };

  const onDelete = async (item) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== item.id)); // optimistic
    try {
      await deleteExtraction(item.id);
      showToast("Extraction deleted", "trash");
    } catch (err) {
      console.error("[ScrapeLite] Delete failed:", err);
      setItems(prev); // rollback optimistic update
      showError(err, DELETE_ERROR, () => onDelete(item));
    }
  };

  return (
    <div className="page fade">
      <div className="container" style={{ paddingTop: 36, paddingBottom: 72 }}>
        <div className="dash-header">
          <div>
            <div className="eyebrow">
              <Icon name="bookmark" size={13} /> Saved
            </div>
            <h1 className="dash-h1">Your extractions</h1>
            <p className="dash-sub">
              {loading
                ? "Loading…"
                : items.length === 0
                  ? "Nothing saved yet."
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
            <Button variant="primary" icon="plus" onClick={() => navigate("/")}>
              New extraction
            </Button>
          </div>
        </div>

        {!loading && items.length === 0 ? (
          <div className="empty-state card rise">
            <div className="empty-orb">
              <Icon name="layers" size={30} />
            </div>
            <h2>No extractions yet</h2>
            <p>Run your first extraction and save it — it'll show up here for later.</p>
            <Button variant="primary" icon="plus" onClick={() => navigate("/")}>
              Start extracting
            </Button>
          </div>
        ) : layout === "cards" ? (
          <div className="dash-grid rise">
            {items.map((it) => (
              <DashCard
                key={it.id}
                item={it}
                onView={view}
                onExport={csvDownload}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="card rise table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Page</th>
                  <th className="col-sum">AI summary</th>
                  <th className="col-struct">Structure</th>
                  <th className="col-date">Extracted</th>
                  <th className="col-act"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} onClick={() => view(it)}>
                    <td>
                      <div className="td-page">
                        <FaviconDot url={it.url} size={34} />
                        <div style={{ minWidth: 0 }}>
                          <div className="td-title">{it.page_title}</div>
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
                      <RowActions
                        item={it}
                        onView={view}
                        onExport={csvDownload}
                        onDelete={onDelete}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
