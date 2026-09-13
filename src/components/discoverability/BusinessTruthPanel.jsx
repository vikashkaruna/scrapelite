// BusinessTruthPanel.jsx — Canonical Business Truth Record (W9 / CP-1.4a).
// Allows viewing, proposing, diffing, and promoting business truth versions.
// Refuses self-approval with clear copy explaining the separation of duties.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

export default function BusinessTruthPanel({ workspaceId = null, currentUser = null }) {
  const { showToast } = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [diff, setDiff] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [proposing, setProposing] = useState(false);
  const [promoteLoading, setPromoteLoading] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(null);

  // Proposal form state
  const [formFields, setFormFields] = useState({
    name: "",
    canonical_domain: "",
    contact_email: "",
    phone: "",
    address: "",
  });

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await discoverability.listTruthRecords({ workspace_id: workspaceId });
      const list = res.records || [];
      setRecords(list);
      if (list.length > 0 && !selectedRecord) {
        setSelectedRecord(list[0]);
      }
    } catch (err) {
      showToast(err.message || "Could not load business truth records", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedRecord, showToast]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const loadDiffAndConflicts = useCallback(async (recordId) => {
    if (!recordId) return;
    try {
      const [diffRes, conflictRes] = await Promise.all([
        discoverability.truthDiff(recordId).catch(() => null),
        discoverability.truthConflicts(recordId).catch(() => ({ conflicts: [] })),
      ]);
      setDiff(diffRes?.diff || null);
      setConflicts(conflictRes?.conflicts || []);
    } catch {
      // Best-effort enrichment
    }
  }, []);

  useEffect(() => {
    if (selectedRecord?.id) {
      loadDiffAndConflicts(selectedRecord.id);
    }
  }, [selectedRecord, loadDiffAndConflicts]);

  const handlePropose = async (e) => {
    e.preventDefault();
    if (!selectedRecord?.id) return;
    try {
      await discoverability.proposeTruthVersion(selectedRecord.id, {
        fields: formFields,
        source: "declared",
      });
      showToast("Truth record version proposed successfully.", "check");
      setProposing(false);
      loadRecords();
    } catch (err) {
      showToast(err.message || "Failed to propose version", "error");
    }
  };

  const handlePromote = async (version) => {
    if (!selectedRecord?.id || !version?.id) return;
    // Check self-approval: if proposed by the current user, explain the refusal
    if (currentUser?.id && version.stated_by === currentUser.id) {
      showToast(
        "Self-approval refused: You proposed this version. To ensure canonical accuracy, an independent reviewer must promote it.",
        "warning"
      );
      return;
    }
    setPromoteLoading(true);
    try {
      await discoverability.promoteTruthVersion(selectedRecord.id, version.id, "Promoted by review");
      showToast("Version promoted to canonical truth.", "check");
      loadRecords();
    } catch (err) {
      if (err.status === 403 || err.code === "SELF_APPROVAL_REFUSED") {
        showToast(
          "Self-approval refused: A version cannot be approved by the person who proposed it.",
          "warning"
        );
      } else {
        showToast(err.message || "Failed to promote version", "error");
      }
    } finally {
      setPromoteLoading(false);
    }
  };

  const handleResolveConflict = async (conflictId, resolution) => {
    if (!selectedRecord?.id) return;
    setResolveLoading(conflictId);
    try {
      await discoverability.resolveTruthConflict(selectedRecord.id, conflictId, resolution);
      showToast("Conflict marked resolved.", "check");
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    } catch (err) {
      showToast(err.message || "Could not resolve conflict", "error");
    } finally {
      setResolveLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
        <Icon name="rotate-cw" size={24} className="spin" />
        <p style={{ marginTop: "0.5rem" }}>Loading Business Truth Records…</p>
      </div>
    );
  }

  return (
    <div className="dsc-truth-surface" style={{ display: "grid", gap: "1.5rem" }}>
      <div className="dsc-header-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="shield-check" size={20} /> Canonical Business Truth Records
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            One single, verifiable source of truth for organization facts across answer engines and local directories.
          </p>
        </div>
        {selectedRecord && (
          <Button size="sm" onClick={() => setProposing(!proposing)}>
            <Icon name="plus" size={14} /> {proposing ? "Cancel Proposal" : "Propose Version"}
          </Button>
        )}
      </div>

      {proposing && selectedRecord && (
        <form onSubmit={handlePropose} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Propose New Fact Version</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Organization Name
              <input
                type="text"
                className="dsc-input"
                value={formFields.name}
                onChange={(e) => setFormFields({ ...formFields, name: e.target.value })}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Canonical Domain
              <input
                type="text"
                className="dsc-input"
                value={formFields.canonical_domain}
                onChange={(e) => setFormFields({ ...formFields, canonical_domain: e.target.value })}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Contact Email
              <input
                type="email"
                className="dsc-input"
                value={formFields.contact_email}
                onChange={(e) => setFormFields({ ...formFields, contact_email: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Phone Number
              <input
                type="text"
                className="dsc-input"
                value={formFields.phone}
                onChange={(e) => setFormFields({ ...formFields, phone: e.target.value })}
              />
            </label>
          </div>
          <Button size="sm" type="submit">Submit for Review</Button>
        </form>
      )}

      {records.length === 0 ? (
        <div className="dsc-panel dsc-panel-empty" style={{ padding: "2.5rem", textAlign: "center" }}>
          <Icon name="info" size={28} />
          <h3 style={{ marginTop: "0.5rem", fontWeight: 600 }}>No Business Truth Records Yet</h3>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
            Run an audit with your primary domain or create an organization record to establish your baseline truth.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1.5rem" }}>
          {/* Records sidebar */}
          <div className="dsc-panel" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Records ({records.length})
            </h4>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {records.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRecord(r)}
                  className={`dsc-record-item ${selectedRecord?.id === r.id ? "active" : ""}`}
                  style={{
                    textAlign: "left",
                    padding: "0.625rem",
                    borderRadius: "var(--r)",
                    border: selectedRecord?.id === r.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: selectedRecord?.id === r.id ? "var(--surface)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{r.name || "Unnamed Record"}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>{r.canonical_domain || "No domain"}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Record Details & Diffs */}
          {selectedRecord && (
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600 }}>{selectedRecord.name}</h3>
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>{selectedRecord.canonical_domain}</p>
                  </div>
                  <span className={`dsc-pill dsc-pill-${selectedRecord.status || "active"}`} style={{ textTransform: "uppercase" }}>
                    {selectedRecord.status || "active"}
                  </span>
                </div>

                {/* Facts View */}
                <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                  {Object.entries(selectedRecord.current_version?.fields || {}).map(([k, v]) => (
                    <div key={k} style={{ padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", textTransform: "capitalize" }}>
                        {k.replace(/_/g, " ")}
                      </div>
                      <div style={{ fontSize: "0.875rem", fontWeight: 500, marginTop: "0.125rem" }}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Version History & Self-Approval Prevention */}
              <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                <h4 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Versions & Review</h4>
                {(selectedRecord.versions || []).length === 0 ? (
                  <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>No version history recorded.</p>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {selectedRecord.versions.map((v) => (
                      <div
                        key={v.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "0.75rem",
                          borderRadius: "var(--r)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>v{v.version_number}</span>
                            <span className="dsc-pill">{v.state}</span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>Source: {v.source}</span>
                          </div>
                          {v.stated_by && (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "0.25rem" }}>
                              Proposed by: {v.stated_by === currentUser?.id ? "You" : v.stated_by}
                            </div>
                          )}
                        </div>
                        {v.state !== "approved" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePromote(v)}
                            loading={promoteLoading}
                          >
                            Promote to Truth
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Diff View */}
              {diff && (
                <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Version Delta</h4>
                  <pre style={{ fontSize: "0.8125rem", padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                    {JSON.stringify(diff, null, 2)}
                  </pre>
                </div>
              )}

              {/* Conflicts */}
              {conflicts.length > 0 && (
                <div className="dsc-panel" style={{ padding: "1.25rem", borderLeft: "4px solid var(--accent)" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>
                    Detected Fact Conflicts ({conflicts.length})
                  </h4>
                  <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
                    {conflicts.map((c) => (
                      <div key={c.id} style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                        <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{c.description || "Conflict detected"}</div>
                        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResolveConflict(c.id, "record_updated")}
                            loading={resolveLoading === c.id}
                          >
                            Record Updated
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleResolveConflict(c.id, "page_updated")}
                            loading={resolveLoading === c.id}
                          >
                            Page Corrected
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
