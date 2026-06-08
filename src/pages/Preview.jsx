// Preview.jsx — review & save interface (route "/preview").
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import BrandLoader from "../components/BrandLoader.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import StructuredData from "../components/StructuredData.jsx";
import { useExtraction } from "../components/ExtractionProvider.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { useToast } from "../components/Toast.jsx";
import { useErrorModal } from "../components/ErrorModal.jsx";
import { SAVE_ERROR } from "../lib/errorMessages.js";
import { hostOf, pathOf, isExternal, timeAgo } from "../lib/utils.js";
import { categoryOf, isCategory, CATEGORY_META, categoryCounts } from "../lib/linkCategorizer.js";
import { QUICK_ACTIONS, QUICK_ACTION_BY_KEY } from "../lib/extractionPresets.js";

function HeadingRow({ h }) {
  const level = Math.max(1, parseInt(String(h.tag).replace(/\D/g, ""), 10) || 1);
  return (
    <div className="hd-row" style={{ paddingLeft: (level - 1) * 22 }}>
      {level > 1 && <span className="hd-guide" />}
      <span className="tag-pill">{h.tag}</span>
      <span
        className="hd-text"
        style={{
          fontWeight: level <= 2 ? 650 : 500,
          fontSize: level === 1 ? "1.05em" : level >= 5 ? ".9em" : "1em",
          color: level >= 5 ? "var(--text-2)" : "var(--text)",
        }}
      >
        {h.text}
      </span>
    </div>
  );
}

function LinkRow({ link, base }) {
  const cat = isCategory(link.category) ? link.category : categoryOf(link.href, base);
  const meta = CATEGORY_META[cat];
  return (
    <a className="lnk-row" href={link.href} target="_blank" rel="noopener noreferrer">
      <FaviconDot url={link.href} />
      <span className="lnk-text">{link.text}</span>
      <span className="lnk-href">
        <span className="lnk-host">{hostOf(link.href)}</span>
        <span className="lnk-path">{pathOf(link.href)}</span>
      </span>
      <span className={"lnk-cat cat-" + cat} title={meta.label}>
        <Icon name={meta.icon} size={12} /> {meta.label}
      </span>
    </a>
  );
}

// Searchable list of URLs discovered by the "Map entire domain" feature.
function DomainMapCard({ urls, base }) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const shown = term ? urls.filter((u) => u.toLowerCase().includes(term)) : urls;
  return (
    <div className="card rise" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card-head">
        <span className="ch-icon">
          <Icon name="map" size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>Domain map</h3>
          <p className="ch-sub">All indexed URLs discovered on {hostOf(base)}</p>
        </div>
        <span className="count-pill ch-meta">{urls.length}</span>
      </div>
      <div className="field-shell dash-search" style={{ margin: "0 16px 12px" }}>
        <span className="field-lead">
          <Icon name="search" size={16} />
        </span>
        <input
          className="field-input"
          type="text"
          placeholder="Filter URLs…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter mapped URLs"
        />
        {q && (
          <button className="dash-search-clear" onClick={() => setQ("")} aria-label="Clear filter">
            <Icon name="x" size={15} />
          </button>
        )}
      </div>
      <div className="scroll-y lnk-list">
        {shown.length === 0 ? (
          <div className="empty-mini">No URLs match “{q}”.</div>
        ) : (
          shown.map((u, i) => (
            <a key={i} className="lnk-row" href={u} target="_blank" rel="noopener noreferrer">
              <FaviconDot url={u} />
              <span className="lnk-text">{pathOf(u) === "/" ? hostOf(u) : pathOf(u)}</span>
              <span className="lnk-href">
                <span className="lnk-host">{hostOf(u)}</span>
                <span className="lnk-path">{pathOf(u)}</span>
              </span>
              <Icon name="external" size={13} style={{ color: "var(--text-3)" }} />
            </a>
          ))
        )}
      </div>
    </div>
  );
}

export default function Preview() {
  const navigate = useNavigate();
  const showToast = useToast();
  const showError = useErrorModal();
  const { current, save, enrich } = useExtraction();
  const { user, openAuth } = useAuth();
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("all");
  const [runningKey, setRunningKey] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  // Persisted enrichments for this extraction become tabs. Fall back to a saved
  // custom_extraction (older shape) so it still shows as a tab.
  const enrichments = useMemo(() => {
    const map = { ...((current && current.enrichments) || {}) };
    if (Object.keys(map).length === 0 && current?.custom_extraction != null) {
      map.custom = {
        key: "custom",
        label: "Custom extraction",
        icon: "code",
        prompt: "",
        data: current.custom_extraction,
        created_at: current.created_at,
      };
    }
    return map;
  }, [current]);

  // Direct navigation with nothing to preview → send home.
  if (!current) return <Navigate to="/" replace />;

  const data = current;
  const isMap = Array.isArray(data.domain_map);
  const links = (data.links || []).filter((l) => {
    if (filter === "all") return true;
    const ext = isExternal(l.href, data.url);
    return filter === "external" ? ext : !ext;
  });
  const catCounts = categoryCounts(data.links || [], data.url);

  const enrichList = Object.values(enrichments);
  const activeEntry = enrichments[activeTab];
  const showOverview = activeTab === "overview" || !activeEntry;

  // Run (or refresh) ONE capability in the background. The page stays visible;
  // only the clicked control spins. The result is saved as a tab keyed by URL.
  const runQuickAction = async (preset) => {
    if (runningKey) return; // one at a time
    setRunningKey(preset.key);
    try {
      const entry = await enrich(data.url, preset);
      if (entry) {
        setActiveTab(preset.key);
        showToast(`${preset.label} ready`, "sparkles");
      }
    } catch (err) {
      console.error("[ScrapeLite] Quick enrichment failed:", err);
      showToast("Enrichment failed — check your connection", "alert-triangle");
    } finally {
      setRunningKey(null);
    }
  };

  // Re-run a saved enrichment tab (uses its stored prompt, or the preset's).
  const refreshEntry = (entry) => {
    const prompt = entry.prompt || QUICK_ACTION_BY_KEY[entry.key]?.prompt;
    if (!prompt) return;
    runQuickAction({ key: entry.key, label: entry.label, icon: entry.icon, prompt });
  };

  const onSave = async () => {
    if (!user) { openAuth(); return; }
    if (saving) return;
    setSaving(true);
    try {
      await save(data);
      showToast("Saved to your dashboard");
      navigate("/dashboard");
    } catch (err) {
      console.error("[ScrapeLite] Save failed:", err);
      setSaving(false);
      // Show modal with retry so user can try saving again without losing the extraction.
      showError(err, SAVE_ERROR, onSave);
    }
  };

  const onDiscard = () => {
    showToast("Extraction discarded", "trash");
    navigate("/");
  };

  return (
    <div className="page fade">
      {saving && (
        <div className="save-overlay" role="status" aria-live="polite">
          <BrandLoader
            className="card"
            title="Saving to your dashboard…"
            sub="Storing the extracted content safely"
          />
        </div>
      )}
      <div className="container" style={{ paddingTop: 28, paddingBottom: 64 }}>
        {/* action bar */}
        <div className="preview-bar">
          <Button variant="ghost" icon="arrow-left" onClick={() => navigate("/")} className="back-btn">
            Back
          </Button>
          <div className="preview-bar-actions">
            <Button variant="danger" icon="trash" onClick={onDiscard}>
              Discard
            </Button>
            <Button
              variant="primary"
              icon={saving ? null : "bookmark"}
              onClick={onSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span
                    className="spinner"
                    style={{
                      "--sp-size": "16px",
                      borderColor: "rgba(255,255,255,.4)",
                      borderTopColor: "#fff",
                    }}
                  />{" "}
                  Saving…
                </>
              ) : (
                "Save to Dashboard"
              )}
            </Button>
          </div>
        </div>

        {/* page identity */}
        <div className="preview-head rise">
          <FaviconDot url={data.url} size={44} />
          <div style={{ minWidth: 0 }}>
            <h1 className="preview-title">{data.page_title}</h1>
            <a className="preview-url" href={data.url} target="_blank" rel="noopener noreferrer">
              <Icon name="globe" size={15} /> {data.url} <Icon name="external" size={13} />
            </a>
          </div>
          <div className="preview-stats">
            {isMap ? (
              <div className="pstat">
                <b>{data.domain_map.length}</b>
                <span>URLs</span>
              </div>
            ) : (
              <>
                <div className="pstat">
                  <b>{data.headings.length}</b>
                  <span>headings</span>
                </div>
                <div className="pstat">
                  <b>{data.links.length}</b>
                  <span>links</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="section-gap" style={{ marginTop: "var(--gap)" }}>
          {/* AI summary */}
          <div className="card rise summary-card" style={{ animationDelay: ".05s" }}>
            <div className="card-head">
              <span className="ch-icon">
                <Icon name="sparkles" size={18} />
              </span>
              <div>
                <h3>AI summary</h3>
                <p className="ch-sub">Generated overview of the page's intent &amp; structure</p>
              </div>
              <span className="ai-badge ch-meta">
                <Icon name="zap" size={12} /> AI
              </span>
            </div>
            <div className="card-pad">
              <p className="summary-text">{data.ai_summary}</p>
            </div>
          </div>

          {/* Quick enrichment — run/refresh capabilities (hidden in map mode).
              Each result is saved as a persistent tab keyed by this URL. */}
          {!isMap && (
            <div className="card rise quick-actions" style={{ animationDelay: ".07s" }}>
              <div className="qa-head">
                <span className="ch-icon">
                  <Icon name="wand" size={18} />
                </span>
                <div>
                  <h3>Quick enrichment</h3>
                  <p className="ch-sub">
                    Run a focused AI extraction — each result is saved as a tab below
                  </p>
                </div>
              </div>
              <div className="qa-row">
                {QUICK_ACTIONS.map((a) => {
                  const running = runningKey === a.key;
                  const done = !!enrichments[a.key];
                  return (
                    <button
                      key={a.key}
                      className={"qa-btn" + (running ? " running" : "") + (done ? " done" : "")}
                      onClick={() => runQuickAction(a)}
                      disabled={!!runningKey}
                      title={done ? `Re-run “${a.label}” (refresh)` : a.prompt}
                    >
                      <span className="qa-ico">
                        <Icon name={a.icon} size={14} />
                        {running && <span className="qa-spin" />}
                        {!running && done && (
                          <span className="qa-done">
                            <Icon name="check" size={9} strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs: Overview + one per saved enrichment capability */}
          {enrichList.length > 0 && (
            <div className="pv-tabs rise" role="tablist">
              <button
                className={"pv-tab" + (showOverview ? " on" : "")}
                onClick={() => setActiveTab("overview")}
                role="tab"
                aria-selected={showOverview}
              >
                <Icon name={isMap ? "map" : "layers"} size={14} /> Overview
              </button>
              {enrichList.map((e) => (
                <button
                  key={e.key}
                  className={"pv-tab" + (activeTab === e.key ? " on" : "")}
                  onClick={() => setActiveTab(e.key)}
                  role="tab"
                  aria-selected={activeTab === e.key}
                >
                  <span className="qa-ico">
                    <Icon name={e.icon} size={14} />
                    {runningKey === e.key && <span className="qa-spin" />}
                  </span>
                  {e.label}
                </button>
              ))}
            </div>
          )}

          {/* Enrichment tab content */}
          {!showOverview && (
            <div className="card rise" style={{ animationDelay: ".04s" }}>
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name={activeEntry.icon} size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{activeEntry.label}</h3>
                  <p className="ch-sub">
                    Saved {timeAgo(activeEntry.created_at)} · structured data for this capability
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={runningKey === activeEntry.key ? null : "refresh"}
                  onClick={() => refreshEntry(activeEntry)}
                  disabled={
                    !!runningKey ||
                    !(activeEntry.prompt || QUICK_ACTION_BY_KEY[activeEntry.key]?.prompt)
                  }
                >
                  {runningKey === activeEntry.key ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              <div className="card-pad">
                {activeEntry.data == null ? (
                  <div className="empty-mini">No data returned for this capability.</div>
                ) : (
                  <StructuredData data={activeEntry.data} />
                )}
              </div>
            </div>
          )}

          {/* Overview tab content — domain map OR the headings/links grid */}
          {showOverview &&
            (isMap ? (
              <DomainMapCard urls={data.domain_map} base={data.url} />
            ) : (
              <div className="preview-grid">
            <div
              className="card rise"
              style={{ animationDelay: ".1s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="list-tree" size={18} />
                </span>
                <div>
                  <h3>Headings</h3>
                  <p className="ch-sub">H1–H6 outline</p>
                </div>
                <span className="count-pill ch-meta">{data.headings.length}</span>
              </div>
              <div className="scroll-y hd-list">
                {data.headings.map((h, i) => (
                  <HeadingRow key={i} h={h} />
                ))}
              </div>
            </div>

            <div
              className="card rise"
              style={{ animationDelay: ".15s", display: "flex", flexDirection: "column" }}
            >
              <div className="card-head">
                <span className="ch-icon">
                  <Icon name="link" size={18} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="ch-title-row">
                    <h3>Links</h3>
                    <span className="ai-badge">
                      <Icon name="sparkles" size={12} /> AI tagged
                    </span>
                  </div>
                  <p className="ch-sub lnk-cat-counts">
                    {catCounts.map((c, i) => (
                      <span key={c.key} className="lnk-cat-count">
                        {i > 0 && <span className="dot-sep">·</span>}
                        <span className={"cat-dot cat-" + c.key} /> {c.count} {c.label.toLowerCase()}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="seg-filter ch-meta">
                  {["all", "internal", "external"].map((f) => (
                    <button
                      key={f}
                      className={"seg-opt" + (filter === f ? " on" : "")}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="scroll-y lnk-list">
                {links.length === 0 ? (
                  <div className="empty-mini">No {filter} links found.</div>
                ) : (
                  links.map((l, i) => <LinkRow key={i} link={l} base={data.url} />)
                )}
              </div>
            </div>
          </div>
            ))}
        </div>
      </div>
    </div>
  );
}
