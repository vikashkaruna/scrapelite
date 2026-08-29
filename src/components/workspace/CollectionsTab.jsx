// src/components/workspace/CollectionsTab.jsx
//
// The Collections tab inside /workspace. Absorbs the previous standalone
// /collections page (kept as a backward-compat redirect in App.jsx).
//
// Structure:
//   ┌─ Sidebar ──────┬─ Main ────────────────────┐
//   │ All collections│ • Pick a collection →     │
//   │ (count chips)  │   show its extractions    │
//   │ + Untagged     │   with the same look as   │
//   │                │   before.                 │
//   └────────────────┴───────────────────────────┘
//
// The on-disk shape is unchanged: a collection is a string field on each
// extraction, summarised by lib/collectionsService.summariseCollections().

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../Icon.jsx";
import FaviconDot from "../FaviconDot.jsx";
import { listExtractions } from "../../lib/extractionsRepo.js";
import {
  summariseCollections,
  filterByCollection,
} from "../../lib/collectionsService.js";
import { hostOf, pathOf, timeAgo } from "../../lib/utils.js";

export default function CollectionsTab() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(null); // collection name or "__untagged__"
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listExtractions()
      .then((data) => { if (!cancelled) setItems(data || []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const collections = useMemo(() => summariseCollections(items), [items]);
  const untaggedCount = useMemo(() => items.filter((it) => !it?.collection).length, [items]);

  const visibleItems = useMemo(() => {
    if (!active) return [];
    return filterByCollection(items, active).sort(
      (a, b) => (b.created_at || "").localeCompare(a.created_at || "")
    );
  }, [active, items]);

  return (
    <section className="ws-collections-tab rise">
      <header className="collections-head">
        <div>
          <span className="eyebrow">
            <Icon name="folder" size={14} />
            Collections
          </span>
          <h1 className="collections-title">Your research, organized</h1>
          <p className="collections-sub">
            Group extractions by topic, project or competitor. Move an item into a
            collection from the Dashboard row.
          </p>
        </div>
        <Link to="/dashboard" className="collections-cta">
          <Icon name="layout-list" size={13} /> Open Dashboard
        </Link>
      </header>

      <div className="collections-layout">
        <aside className="collections-sidebar">
          <div className="cs-section">
            <div className="cs-section-head">
              <Icon name="folder" size={13} />
              <span>All collections</span>
              <span className="cs-count">{collections.length}</span>
            </div>
            {collections.length === 0 && (
              <div className="cs-empty">
                No collections yet. Add one from the Dashboard row's "Collection" dropdown.
              </div>
            )}
            <ul className="cs-list" role="tablist" aria-orientation="vertical" aria-label="Collections">
              {collections.map((c) => (
                <li key={c.name} role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id={`cs-tab-${c.name}`}
                    aria-selected={active === c.name}
                    aria-controls="collections-panel"
                    className={"cs-item" + (active === c.name ? " on" : "")}
                    onClick={() => setActive(c.name)}
                  >
                    <Icon name="folder" size={12} />
                    <span className="cs-item-name">{c.name}</span>
                    <span className="cs-item-count">{c.count}</span>
                  </button>
                </li>
              ))}
              {untaggedCount > 0 && (
                <li role="presentation">
                  <button
                    type="button"
                    role="tab"
                    id="cs-tab-__untagged__"
                    aria-selected={active === "__untagged__"}
                    aria-controls="collections-panel"
                    className={"cs-item" + (active === "__untagged__" ? " on" : "")}
                    onClick={() => setActive("__untagged__")}
                  >
                    <Icon name="inbox" size={12} />
                    <span className="cs-item-name">Untagged</span>
                    <span className="cs-item-count">{untaggedCount}</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        </aside>

        <main
          className="collections-main"
          role="tabpanel"
          id="collections-panel"
          aria-labelledby={active ? `cs-tab-${active}` : undefined}
          tabIndex={0}
        >
          {!active ? (
            <div className="collections-empty">
              <Icon name="folder-open" size={36} />
              <h2>Pick a collection to view its extractions</h2>
              <p>Or jump to the <Link to="/dashboard">Dashboard</Link> to start organising your research.</p>
            </div>
          ) : loading ? (
            <div className="collections-empty">Loading…</div>
          ) : visibleItems.length === 0 ? (
            <div className="collections-empty">
              <Icon name="inbox" size={36} />
              <h2>No extractions in this collection yet</h2>
              <p>Open the <Link to="/dashboard">Dashboard</Link> and move items in via the row's Collection dropdown.</p>
            </div>
          ) : (
            <ul className="collections-items">
              {visibleItems.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="ci-card"
                    onClick={() => navigate("/preview", { state: { item: it } })}
                  >
                    <FaviconDot url={it.url} size={32} />
                    <div className="ci-meta">
                      <div className="ci-title">{it.page_title}</div>
                      <div className="ci-sub">
                        {hostOf(it.url)}{pathOf(it.url) !== "/" ? pathOf(it.url) : ""}
                        <span className="ci-dot">·</span>
                        {timeAgo(it.created_at)}
                      </div>
                    </div>
                    <Icon name="arrow-right" size={14} className="ci-arrow" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </section>
  );
}
