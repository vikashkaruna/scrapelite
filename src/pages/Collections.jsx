// Collections.jsx — Groke QW#3. Browse all collections, see what's in each,
// and jump to a filtered Dashboard view for a specific collection.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { listExtractions } from "../lib/extractionsRepo.js";
import { summariseCollections, filterByCollection, normalizeCollectionName } from "../lib/collectionsService.js";
import { hostOf, pathOf, fmtDate, timeAgo } from "../lib/utils.js";
import { useSeo } from "../hooks/useSeo.js";

export default function Collections() {
  useSeo({
    title: "DatIQ Collections — group your extractions by topic | DatIQ.app",
    description:
      "DatIQ Collections — group your extractions by topic, client, or campaign. DatIQ.app is the zero-code web data extraction platform for marketers, researchers, and agencies.",
    canonical: "https://datiq.app/collections",
  });
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
    <div className="page fade">
      <div className="container" style={{ paddingTop: 36, paddingBottom: 72 }}>
        <header className="collections-head">
          <div>
            <span className="eyebrow">
              <Icon name="folder" size={14} />
              Collections
            </span>
            <h1 className="collections-title">Your research, organized</h1>
            <p className="collections-sub">
              Group extractions by topic, project or competitor. Move an item into a collection from the Dashboard row.
            </p>
          </div>
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
              <ul className="cs-list">
                {collections.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
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
                  <li>
                    <button
                      type="button"
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

          <main className="collections-main">
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
      </div>
    </div>
  );
}
