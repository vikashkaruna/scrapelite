// RecentExtractions.jsx — "Recent extractions" widget for the Home page (QW#4).
//
// Surfaces the user's last 5 saved extractions below the URL composer so return
// visitors can pick up where they left off. Reads from `datiq.saved` (the same
// localStorage key Dashboard uses), supports a search filter, and falls through
// to /dashboard for the full list. Click on a card → /preview (via
// ExtractionProvider.view()).
//
// USER-SPECIFIC FILTER (Q-UI): the widget is filtered to the current
// owner so user A never sees user B's saved extractions on a shared
// device. Owner resolution: signed-in user → auth user id; guest →
// per-browser session id. Items that predate this change (no owner
// field) are excluded from the per-user widget — they still appear in
// the full Dashboard.
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import Icon from "./Icon.jsx";
import FaviconDot from "./FaviconDot.jsx";
import { useExtraction } from "./ExtractionProvider.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { getSessionId } from "../lib/usageRepo.js";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { hostOf, timeAgo } from "../lib/utils.js";

const LS_KEY = "datiq.saved";
const MAX_SHOWN = 5;

function readRecent() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return [];
    // Sort by created_at desc, dedupe by id
    const seen = new Set();
    return items
      .filter((it) => it && it.id && !seen.has(it.id) && seen.add(it.id))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  } catch {
    return [];
  }
}

// Resolve the current owner (matches extractionsRepo.getOwnerId):
//   1. Supabase auth user id if signed in
//   2. Per-browser session id for guests
//   3. null if both fail
async function resolveCurrentOwner() {
  try {
    if (isSupabaseEnabled && supabase) {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) return { userId: data.user.id, sessionId: null };
    }
  } catch { /* fall through */ }
  try {
    return { userId: null, sessionId: getSessionId() };
  } catch {
    return { userId: null, sessionId: null };
  }
}

function matchesOwner(item, owner) {
  if (!owner || (!owner.userId && !owner.sessionId)) return false;
  if (owner.userId) {
    return item.user_id === owner.userId;
  }
  return item.session_id === owner.sessionId;
}

function EmptyState() {
  return (
    <div className="recent-empty">
      <Icon name="bookmark" size={18} />
      <div className="recent-empty-text">
        <b>Nothing saved yet</b>
        <span>Extractions you save will appear here for quick re-access.</span>
      </div>
    </div>
  );
}

export default function RecentExtractions() {
  const navigate = useNavigate();
  const { view } = useExtraction();
  const { user } = useAuth();
  const [items, setItems]   = useState([]);
  const [owner, setOwner]   = useState(null);
  const [query, setQuery]   = useState("");

  // Resolve the current owner on mount + when the auth user changes.
  useEffect(() => {
    let cancelled = false;
    resolveCurrentOwner().then((o) => {
      if (!cancelled) setOwner(o);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Re-read whenever the localStorage key changes (another tab or a recent
  // save). Also re-read on visibility change so a fresh save shows up next
  // time the user returns to this tab.
  useEffect(() => {
    const refresh = () => setItems(readRecent());
    refresh();
    window.addEventListener("storage", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // Filter to the current owner's items, then take the latest 5.
  const ownedItems = useMemo(() => {
    if (!owner) return [];
    return items.filter((it) => matchesOwner(it, owner)).slice(0, MAX_SHOWN);
  }, [items, owner]);

  const shown = useMemo(() => {
    if (!query.trim()) return ownedItems;
    const q = query.trim().toLowerCase();
    return ownedItems.filter((it) => {
      const t = (it.page_title || "").toLowerCase();
      const u = (it.url || "").toLowerCase();
      return t.includes(q) || u.includes(q) || hostOf(it.url || "").includes(q);
    });
  }, [ownedItems, query]);

  const handleView = useCallback((it) => {
    try { view(it); } catch (e) { console.warn("[DatIQ] recent.view failed:", e); }
  }, [view]);

  // While the owner resolves (or if the user has zero items) we hide the
  // whole widget so the Home page doesn't flash an empty box.
  if (!owner) return null;
  if (!ownedItems.length) return null;

  return (
    <section className="recent-extractions rise" aria-label="Recent extractions">
      <header className="recent-head">
        <span className="recent-eyebrow">
          <Icon name="history" size={13} />
          Recent extractions
        </span>
        <div className="recent-head-right">
          {ownedItems.length > 1 && (
            <div className="recent-search">
              <Icon name="search" size={12} />
              <input
                type="text"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter recent extractions"
              />
              {query && (
                <button
                  type="button"
                  className="recent-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear filter"
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="recent-view-all"
            onClick={() => navigate("/dashboard")}
            title="See all saved extractions"
          >
            View all <Icon name="arrow-right" size={11} />
          </button>
        </div>
      </header>

      {shown.length === 0 ? (
        <div className="recent-empty-mini">
          <Icon name="search-x" size={14} />
          No recent extractions match "{query}".
        </div>
      ) : (
        <ul className="recent-grid">
          {shown.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="recent-card"
                onClick={() => handleView(it)}
                title={it.page_title || it.url}
              >
                <FaviconDot url={it.url} size={28} />
                <div className="recent-card-meta">
                  <div className="recent-card-title">
                    {it.page_title || hostOf(it.url) || "Untitled"}
                  </div>
                  <div className="recent-card-sub">
                    <span className="recent-host">{hostOf(it.url)}</span>
                    <span className="recent-dot">·</span>
                    <span className="recent-when">{timeAgo(it.created_at)}</span>
                  </div>
                </div>
                <Icon name="arrow-right" size={13} className="recent-card-arrow" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
