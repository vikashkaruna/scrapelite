// src/pages/Watchlists.jsx — Competitor Watchlists & Change Intelligence (PRD 4).
//
// Tracks competitor domains across pricing, product features, and positioning pivots.
// Classifies change materiality (critical, high, medium, low) and strictly separates
// objective facts from AI strategic interpretations, with user feedback.

import { useState, useEffect } from "react";
import { Link } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import SignedInRequired from "../components/SignedInRequired.jsx";
import { MATERIALITY, CADENCE_FOR_MATERIALITY } from "../lib/watchlist/materialityModel.js";
import * as watchlistApi from "../lib/watchlist/watchlistClient.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";

export default function Watchlists() {
  const showToast = useToast();
  const { user, authLoading } = useAuth();

  const cachedWatchlists = readPageCache("watchlists")?.data || [];
  const [watchlists, setWatchlists] = useState(cachedWatchlists);
  const [selectedId, setSelectedId] = useState(null);
  const [currentWatchlist, setCurrentWatchlist] = useState(null);
  const [loading, setLoading] = useState(cachedWatchlists.length === 0);

  // New Watchlist modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cadence, setCadence] = useState("daily");
  const [domainsInput, setDomainsInput] = useState("");

  // Edit Watchlist modal
  const [editingWatchlist, setEditingWatchlist] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCadence, setEditCadence] = useState("daily");
  const [editDomainsInput, setEditDomainsInput] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete Watchlist modal
  const [deletingWatchlist, setDeletingWatchlist] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadWatchlists = async (silent = false) => {
    if (!silent && watchlists.length === 0) setLoading(true);
    try {
      const res = await watchlistApi.listWatchlists();
      const fresh = res.watchlists || [];
      setWatchlists(fresh);
      writePageCache("watchlists", fresh);
    } catch (e) {
      if (watchlists.length === 0) showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentWatchlist = async (id) => {
    try {
      const res = await watchlistApi.getWatchlist(id);
      setCurrentWatchlist(res.watchlist || res);
    } catch (e) {
      showToast(e.message);
    }
  };

  useEffect(() => {
    loadWatchlists();
    const params = new URLSearchParams(window.location.search);
    const targetId = params.get("id") || params.get("w");
    if (targetId) {
      setSelectedId(targetId);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadCurrentWatchlist(selectedId);
    } else {
      setCurrentWatchlist(null);
    }
  }, [selectedId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast("Please provide a name for this watchlist.");
      return;
    }

    const domains = domainsInput
      .split(/[\r\n,]+/)
      .map((d) => d.trim())
      .filter(Boolean);

    if (domains.length === 0) {
      showToast("Please enter at least one competitor domain.");
      return;
    }

    try {
      const res = await watchlistApi.createWatchlist({
        name,
        description,
        cadence,
        domains,
      });

      showToast(`Created watchlist with ${res.targets?.length || domains.length} competitors.`);
      setShowCreateModal(false);
      setName("");
      setDescription("");
      setDomainsInput("");
      loadWatchlists();
      setSelectedId(res.watchlist.id);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleFeedback = async (fieldChangeId, feedback) => {
    try {
      await watchlistApi.submitFeedback({ fieldChangeId, feedback });
      showToast(feedback === "useful" ? "Marked as useful signal." : "Feedback recorded.");
      if (selectedId) loadCurrentWatchlist(selectedId);
    } catch (err) {
      showToast(err.message);
    }
  };

  // 🔴 REPLACES "Simulate Delta", WHICH FABRICATED DATA.
  // It POSTed a hardcoded "$49/mo → $79/mo" through recordChange(), writing an
  // invented competitor movement into the SAME feed as observed movement —
  // indistinguishable once stored, in the list a RevOps user routes real
  // outbound off. A preview that fabricates is worse than no preview.
  const [checking, setChecking] = useState(false);
  const handleCheckNow = async () => {
    if (!currentWatchlist || !currentWatchlist.targets?.length) {
      showToast("Add a competitor to this watchlist first.");
      return;
    }
    setChecking(true);
    try {
      const r = await watchlistApi.runNow(currentWatchlist.id);
      // Report what actually happened, including the honest nothing: a first
      // sighting is a BASELINE and never alerts, so "0 changes" on a new
      // watchlist is correct and must not read as a failure.
      const bits = [`${r.checked} competitor${r.checked === 1 ? "" : "s"} checked`];
      if (r.pages) bits.push(`${r.pages} page${r.pages === 1 ? "" : "s"} read`);
      bits.push(r.changes ? `${r.changes} change${r.changes === 1 ? "" : "s"} found` : "no changes since last check");
      if (r.skipped) bits.push(`${r.skipped} left for the scheduled run`);
      showToast(bits.join(" · "));
      loadCurrentWatchlist(currentWatchlist.id);
    } catch (err) {
      showToast(err.message);
    } finally {
      setChecking(false);
    }
  };

  const openEditModal = (e, wl) => {
    if (e) e.stopPropagation();
    setEditingWatchlist(wl);
    setEditName(wl.name || "");
    setEditDescription(wl.description || "");
    setEditCadence(wl.cadence || "daily");
    const existingDomains = (wl.targets || []).map((t) => t.domain || t).filter(Boolean);
    setEditDomainsInput(existingDomains.join("\n"));
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editName.trim()) {
      showToast("Please provide a name for this watchlist.");
      return;
    }
    const domains = editDomainsInput
      .split(/[\r\n,]+/)
      .map((d) => d.trim())
      .filter(Boolean);

    setEditSaving(true);
    try {
      await watchlistApi.updateWatchlist({
        watchlistId: editingWatchlist.id,
        name: editName,
        description: editDescription,
        cadence: editCadence,
        domains,
      });
      showToast("Watchlist updated successfully.");
      setEditingWatchlist(null);
      loadWatchlists(true);
      if (selectedId === editingWatchlist.id) {
        loadCurrentWatchlist(editingWatchlist.id);
      }
    } catch (err) {
      showToast(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const openDeleteModal = (e, wl) => {
    if (e) e.stopPropagation();
    setDeletingWatchlist(wl);
  };

  const handleDelete = async () => {
    if (!deletingWatchlist) return;
    setDeleteLoading(true);
    try {
      await watchlistApi.deleteWatchlist(deletingWatchlist.id);
      showToast(`Watchlist "${deletingWatchlist.name}" removed.`);
      if (selectedId === deletingWatchlist.id) {
        setSelectedId(null);
      }
      setDeletingWatchlist(null);
      loadWatchlists(true);
    } catch (err) {
      showToast(err.message);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="container" style={{ padding: "40px 20px" }}>
        <div style={{ height: 32, width: 280, background: "var(--surface-2)", borderRadius: "var(--r, 6px)", marginBottom: 12 }} />
        <div style={{ height: 20, width: 450, background: "var(--surface-2)", borderRadius: "var(--r, 6px)", marginBottom: 24 }} />
        <div style={{ height: 180, width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r, 8px)" }} />
      </div>
    );
  }

  // These endpoints are signed-in only: they return 401 rather than another
  // tenant's rows. Render the reason, not the client SDK's thrown error.
  if (!user) {
    return <SignedInRequired title="Competitor watchlists" reason="Track competitors' pricing, product and positioning and get told only what materially changed. A watchlist runs on a schedule and builds a history over time, which needs somewhere to live." />;
  }

  return (
    <div className="container" style={{ padding: "40px 20px" }}>
      <header className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>Competitor Watchlists</h1>
            <p style={{ color: "var(--text-2)", marginTop: 6, fontSize: "0.95rem" }}>
              Automated change intelligence across pricing, product features, and positioning pivots.
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Icon name="plus" size={16} /> New Watchlist
          </Button>
        </div>
      </header>

      {selectedId && currentWatchlist ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSelectedId(null)}
                  style={{ marginBottom: 8 }}
                >
                  ← Back to all watchlists
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: "1.4rem" }}>{currentWatchlist.name}</h2>
                  <Link to="/workflows" style={{ textDecoration: "none" }}>
                    <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--accent)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
                      <Icon name="git-merge" size={11} /> Referenced in Workflows
                    </span>
                  </Link>
                </div>
                <p style={{ margin: "4px 0 0 0", color: "var(--text-2)", fontSize: "0.85rem" }}>
                  Cadence: <strong>{currentWatchlist.cadence}</strong> · {currentWatchlist.targets?.length || 0} competitors tracked
                  {currentWatchlist.description ? ` · ${currentWatchlist.description}` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button variant="secondary" onClick={handleCheckNow} disabled={checking}>
                  <Icon name={checking ? "loader" : "zap"} size={14} className={checking ? "spin" : undefined} />
                  {checking ? "Checking…" : "Check now"}
                </Button>
                <Button variant="secondary" onClick={() => openEditModal(null, currentWatchlist)}>
                  <Icon name="edit" size={14} /> Edit
                </Button>
                <Button variant="ghost" onClick={() => openDeleteModal(null, currentWatchlist)} style={{ color: "var(--danger, #dc2626)" }}>
                  <Icon name="trash-2" size={14} />
                </Button>
              </div>
            </div>

            {/* Targets list */}
            <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(currentWatchlist.targets || []).map((t) => (
                <span
                  key={t.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    background: "var(--surface-2)",
                    borderRadius: 999,
                    fontSize: "0.85rem",
                    fontWeight: 600,
                  }}
                >
                  <Icon name="globe" size={12} /> {t.domain}
                </span>
              ))}
            </div>
          </div>

          {/* Change Intelligence Feed */}
          <div className="card" style={{ padding: 24 }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "1.2rem" }}>
              Detected Changes ({currentWatchlist.changes?.length || 0})
            </h3>

            {!currentWatchlist.changes?.length ? (
              <div className="watchlist-baseline-landscape">
                <div style={{
                  padding: "16px 20px",
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  marginBottom: 16,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}>
                  <Icon name="check-circle" size={18} style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <strong style={{ fontSize: "0.95rem", display: "block", marginBottom: 4 }}>
                      Baseline competitive landscape established
                    </strong>
                    <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.88rem" }}>
                      Initial snapshot captured across all {currentWatchlist.targets?.length || 0} competitors. DatIQ is actively monitoring these domains for material movements in pricing models, feature rollouts, and positioning changes.
                    </p>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {(currentWatchlist.targets || []).map((t) => (
                    <div
                      key={t.id || t.domain}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 16,
                        background: "var(--surface-1)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 6 }}>
                          <Icon name="globe" size={14} className="text-accent" />
                          {t.domain}
                        </span>
                        <span className="wrh-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)", fontSize: "0.72rem" }}>
                          BASELINE ACTIVE
                        </span>
                      </div>
                      <div style={{ fontSize: "0.82rem", color: "var(--text-2)" }}>
                        <div>Monitoring: Pricing, Tier limits, Positioning copy</div>
                        <div style={{ marginTop: 4, color: "var(--text-3)", fontSize: "0.75rem" }}>
                          Status: First observation recorded · Ready for diff detection
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {currentWatchlist.changes.map((c) => {
                  const isCrit = c.materiality === MATERIALITY.CRITICAL;
                  const isHigh = c.materiality === MATERIALITY.HIGH;
                  const pillColor = isCrit
                    ? { bg: "rgba(185,28,28,0.12)", text: "#b91c1c" }
                    : isHigh
                    ? { bg: "rgba(217,119,6,0.15)", text: "#b45309" }
                    : { bg: "var(--surface-2)", text: "var(--text-2)" };

                  return (
                    <div
                      key={c.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span
                            className="wrh-pill"
                            style={{ background: pillColor.bg, color: pillColor.text }}
                          >
                            {c.materiality.toUpperCase()}
                          </span>
                          <span
                            className="wrh-pill"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                          >
                            {c.category}
                          </span>
                          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.field_name}</span>
                        </div>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-3)" }}>
                          {new Date(c.detected_at).toLocaleString()}
                        </span>
                      </div>

                      {/* Fact */}
                      <div>
                        <div style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 700, color: "var(--text-3)", marginBottom: 2 }}>
                          Objective Fact
                        </div>
                        <div style={{ fontSize: "0.92rem", color: "var(--text-1)" }}>
                          {c.fact_summary}
                        </div>
                      </div>

                      {/* AI Interpretation */}
                      {c.ai_interpretation && (
                        <div
                          style={{
                            padding: 12,
                            background: "var(--surface-2)",
                            borderRadius: 6,
                            borderLeft: "3px solid var(--accent)",
                          }}
                        >
                          <div style={{ fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 700, color: "var(--accent)", marginBottom: 2 }}>
                            Strategic Interpretation
                          </div>
                          <div style={{ fontSize: "0.88rem", color: "var(--text-2)" }}>
                            {c.ai_interpretation}
                          </div>
                        </div>
                      )}

                      {/* Feedback */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-3)" }}>
                          Was this signal relevant to your team?
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Button variant="ghost" size="sm" onClick={() => handleFeedback(c.id, "useful")}>
                            👍 Useful
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleFeedback(c.id, "not_useful")}>
                            👎 Not useful
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 24 }}>
          {watchlists.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <Icon name="eye" size={36} style={{ color: "var(--text-3)", marginBottom: 12 }} />
              <h3>No competitor watchlists yet</h3>
              <p style={{ color: "var(--text-2)", marginBottom: 16 }}>
                Track competitors automatically and receive alerts when pricing or messaging changes.
              </p>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                <Icon name="plus" size={14} /> Create Competitor Watchlist
              </Button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {watchlists.map((w) => (
                <div
                  key={w.id}
                  className="wrh-row wrh-row-interactive"
                  style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r, 8px)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}
                  onClick={() => setSelectedId(w.id)}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h3 style={{ margin: "0 0 2px 0", fontSize: "1.1rem" }}>{w.name}</h3>
                      <Link to="/workflows" onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
                        <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--accent)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
                          <Icon name="git-merge" size={11} /> Referenced in Workflows
                        </span>
                      </Link>
                    </div>
                    <span style={{ fontSize: "0.84rem", color: "var(--text-2)" }}>
                      Cadence: <strong>{w.cadence}</strong> · {w.description || "Active tracking"} · {w.targets?.length || w.target_count || 0} competitors
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="wrh-pill wrh-pill-succeeded">{w.status}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => openEditModal(e, w)}
                      style={{ padding: "4px 8px", fontSize: "12px" }}
                      title="Edit watchlist"
                    >
                      <Icon name="edit" size={12} /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => openDeleteModal(e, w)}
                      style={{ padding: "4px 8px", color: "var(--danger, #dc2626)" }}
                      title="Delete watchlist"
                    >
                      <Icon name="trash-2" size={13} />
                    </Button>
                    <span style={{ color: "var(--accent)", fontSize: "0.88rem", marginLeft: 4 }}>View intelligence →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── CREATE MODAL ──────────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="error-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="error-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <h2>New Competitor Watchlist</h2>
            <p style={{ color: "var(--text-2)", fontSize: "0.88rem" }}>
              Monitor competitor pages and detect material shifts in pricing, product, and positioning.
            </p>

            <form onSubmit={handleCreate}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "18px 0" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Watchlist Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder="e.g. Primary CRM Competitors"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Monitoring Cadence
                  </label>
                  <select
                    value={cadence}
                    onChange={(e) => setCadence(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value="hourly">Hourly (High-frequency)</option>
                    <option value="daily">Daily (Recommended)</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Competitor Domains
                  </label>
                  <textarea
                    rows={5}
                    className="input"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                    }}
                    placeholder={`stripe.com\nad Yen.com\nbraintree.com`}
                    value={domainsInput}
                    onChange={(e) => setDomainsInput(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Create Watchlist
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ──────────────────────────────────────────────── */}
      {editingWatchlist && (
        <div
          className="error-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setEditingWatchlist(null)}
        >
          <div className="error-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <h2>Edit Competitor Watchlist</h2>
            <p style={{ color: "var(--text-2)", fontSize: "0.88rem" }}>
              Update monitored domains, monitoring cadence, or description.
            </p>

            <form onSubmit={handleUpdate}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "18px 0" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Watchlist Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Description
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder="Optional description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Monitoring Cadence
                  </label>
                  <select
                    value={editCadence}
                    onChange={(e) => setEditCadence(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value="hourly">Hourly (High-frequency)</option>
                    <option value="daily">Daily (Recommended)</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Competitor Domains (one per line)
                  </label>
                  <textarea
                    rows={5}
                    className="input"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                    }}
                    value={editDomainsInput}
                    onChange={(e) => setEditDomainsInput(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Button variant="ghost" type="button" onClick={() => setEditingWatchlist(null)} disabled={editSaving}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE MODAL ──────────────────────────────────────────────── */}
      {deletingWatchlist && (
        <div
          className="error-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setDeletingWatchlist(null)}
        >
          <div className="error-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2 style={{ color: "var(--danger, #dc2626)" }}>Delete Watchlist</h2>
            <p style={{ color: "var(--text-1)", fontSize: "0.92rem", marginTop: 8 }}>
              Are you sure you want to delete <strong>{deletingWatchlist.name}</strong>?
            </p>
            <div style={{
              marginTop: 12,
              padding: 12,
              background: "var(--surface-2)",
              borderRadius: "var(--r, 8px)",
              fontSize: "0.84rem",
              color: "var(--text-2)",
              border: "1px solid var(--border)"
            }}>
              <Icon name="shield-check" size={14} style={{ color: "var(--accent)", marginRight: 6, verticalAlign: "middle" }} />
              <strong>Audit Trail Preservation:</strong> Historical change observations, snapshots, and signal execution records will be preserved for compliance audits.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <Button variant="ghost" onClick={() => setDeletingWatchlist(null)} disabled={deleteLoading}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleDelete}
                disabled={deleteLoading}
                style={{ background: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)" }}
              >
                {deleteLoading ? "Deleting…" : "Delete Watchlist"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
