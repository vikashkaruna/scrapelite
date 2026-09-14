// EntityGraphPanel.jsx — Entity Graph Builder (W10 / CP-1.4b).
// Displays entities, relationships, conflicts, and corroboration.
// Rule: A duplicate edge returns 409 from the server; render it as a successful
// corroboration rather than a failure.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

const PREDICATES = [
  "owns", "operates", "offers", "provides", "features", "serves", "author_of", "located_at", "parent_of",
];

const ENTITY_TYPES = [
  "organization", "brand", "product", "service", "person", "place", "local_business",
];

export default function EntityGraphPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [graph, setGraph] = useState({ entities: [], relationships: [] });
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposingEntity, setProposingEntity] = useState(false);
  const [proposingRel, setProposingRel] = useState(false);
  const [corroborationNotice, setCorroborationNotice] = useState(null);

  // Form states
  const [entityForm, setEntityForm] = useState({
    name: "",
    entity_type: "brand",
    canonical_domain: "",
    description: "",
  });

  const [relForm, setRelForm] = useState({
    subject_id: "",
    predicate: "owns",
    object_id: "",
    note: "",
  });

  const loadGraphData = useCallback(async () => {
    setLoading(true);
    try {
      const [graphRes, conflictRes] = await Promise.all([
        discoverability.getGraph({ workspace_id: workspaceId }).catch(() => ({ entities: [], relationships: [] })),
        discoverability.graphConflicts({ workspace_id: workspaceId }).catch(() => ({ conflicts: [] })),
      ]);
      setGraph(graphRes);
      setConflicts(conflictRes.conflicts || []);
    } catch (err) {
      showToast(err.message || "Failed to load entity graph", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast]);

  useEffect(() => {
    loadGraphData();
  }, [loadGraphData]);

  const handleProposeEntity = async (e) => {
    e.preventDefault();
    try {
      await discoverability.proposeEntity({
        ...entityForm,
        workspace_id: workspaceId,
        source: "declared",
      });
      showToast(`Entity "${entityForm.name}" proposed for review.`, "check");
      setProposingEntity(false);
      setEntityForm({ name: "", entity_type: "brand", canonical_domain: "", description: "" });
      loadGraphData();
    } catch (err) {
      showToast(err.message || "Could not propose entity", "error");
    }
  };

  const handleProposeRelationship = async (e) => {
    e.preventDefault();
    if (!relForm.subject_id || !relForm.object_id) {
      showToast("Both subject and object entities are required.", "warning");
      return;
    }
    setCorroborationNotice(null);
    try {
      const res = await discoverability.proposeRelationship({
        subjectId: relForm.subject_id,
        predicate: relForm.predicate,
        objectId: relForm.object_id,
        source: "declared",
        note: relForm.note || null,
        workspaceId,
      });
      showToast("Relationship proposed successfully.", "check");
      setProposingRel(false);
      loadGraphData();
    } catch (err) {
      // Rule: 409 means the relationship already exists and has been corroborated!
      if (err.status === 409 || err.code === "RELATIONSHIP_EXISTS") {
        setCorroborationNotice({
          text: "Relationship corroborated! This edge already exists in the graph and your observation has been added to its corroboration history.",
          time: new Date().toLocaleTimeString(),
        });
        showToast("Corroborated existing relationship.", "check");
        setProposingRel(false);
        loadGraphData();
      } else {
        showToast(err.message || "Could not propose relationship", "error");
      }
    }
  };

  const handleApproveRel = async (relId) => {
    try {
      await discoverability.approveRelationship(relId, { workspaceId });
      showToast("Relationship and endpoints approved.", "check");
      loadGraphData();
    } catch (err) {
      showToast(err.message || "Failed to approve relationship", "error");
    }
  };

  const handleResolveConflict = async (conflictId, resolution) => {
    try {
      await discoverability.resolveGraphConflict(conflictId, resolution, { workspaceId });
      showToast("Conflict resolved.", "check");
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
    } catch (err) {
      showToast(err.message || "Failed to resolve conflict", "error");
    }
  };

  if (loading) {
    return (
      <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
        <Icon name="rotate-cw" size={24} className="spin" />
        <p style={{ marginTop: "0.5rem" }}>Loading Entity Graph…</p>
      </div>
    );
  }

  const entities = graph.entities || [];
  const relationships = graph.relationships || [];

  return (
    <div className="dsc-graph-surface" style={{ display: "grid", gap: "1.5rem" }}>
      <div className="dsc-header-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="share-2" size={20} /> Entity Graph Builder
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Map recognized organizations, brands, products, and services with verified relationships.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button size="sm" variant="secondary" onClick={() => setProposingEntity(!proposingEntity)}>
            <Icon name="plus" size={14} /> {proposingEntity ? "Cancel" : "Add Entity"}
          </Button>
          <Button size="sm" onClick={() => setProposingRel(!proposingRel)}>
            <Icon name="link" size={14} /> {proposingRel ? "Cancel" : "Add Relationship"}
          </Button>
        </div>
      </div>

      {corroborationNotice && (
        <div className="dsc-panel" style={{ padding: "0.875rem 1.25rem", background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#059669", fontWeight: 600, fontSize: "0.875rem" }}>
            <Icon name="check-circle" size={16} /> {corroborationNotice.text}
          </div>
        </div>
      )}

      {/* Propose Entity Form */}
      {proposingEntity && (
        <form onSubmit={handleProposeEntity} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Propose Entity Node</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Entity Name
              <input
                type="text"
                className="dsc-input"
                value={entityForm.name}
                onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })}
                required
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Entity Type
              <select
                className="dsc-input"
                value={entityForm.entity_type}
                onChange={(e) => setEntityForm({ ...entityForm, entity_type: e.target.value })}
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Canonical Domain
              <input
                type="text"
                className="dsc-input"
                value={entityForm.canonical_domain}
                onChange={(e) => setEntityForm({ ...entityForm, canonical_domain: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Description
              <input
                type="text"
                className="dsc-input"
                value={entityForm.description}
                onChange={(e) => setEntityForm({ ...entityForm, description: e.target.value })}
              />
            </label>
          </div>
          <Button size="sm" type="submit">Submit Entity</Button>
        </form>
      )}

      {/* Propose Relationship Form */}
      {proposingRel && (
        <form onSubmit={handleProposeRelationship} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Connect Entities with a Relationship</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Subject Entity
              <select
                className="dsc-input"
                value={relForm.subject_id}
                onChange={(e) => setRelForm({ ...relForm, subject_id: e.target.value })}
                required
              >
                <option value="">Select entity…</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>{ent.name} ({ent.entity_type})</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Predicate
              <select
                className="dsc-input"
                value={relForm.predicate}
                onChange={(e) => setRelForm({ ...relForm, predicate: e.target.value })}
              >
                {PREDICATES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Object Entity
              <select
                className="dsc-input"
                value={relForm.object_id}
                onChange={(e) => setRelForm({ ...relForm, object_id: e.target.value })}
                required
              >
                <option value="">Select entity…</option>
                {entities.map((ent) => (
                  <option key={ent.id} value={ent.id}>{ent.name} ({ent.entity_type})</option>
                ))}
              </select>
            </label>
          </div>
          <Button size="sm" type="submit">Propose Relationship</Button>
        </form>
      )}

      {/* Grid of Entities and Relationships */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Entities Column */}
        <div className="dsc-panel" style={{ padding: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Entities ({entities.length})
          </h3>
          {entities.length === 0 ? (
            <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>No entities in graph.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {entities.map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem",
                    background: "var(--bg)",
                    borderRadius: "var(--r)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{e.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                      {e.entity_type} {e.canonical_domain ? `• ${e.canonical_domain}` : ""}
                    </div>
                  </div>
                  <span className={`dsc-pill dsc-pill-${e.state || "proposed"}`}>{e.state || "proposed"}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Relationships Column */}
        <div className="dsc-panel" style={{ padding: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Relationships ({relationships.length})
          </h3>
          {relationships.length === 0 ? (
            <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>No relationships recorded.</p>
          ) : (
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {relationships.map((r) => {
                const subj = entities.find((e) => e.id === r.subject_id);
                const obj = entities.find((e) => e.id === r.object_id);
                return (
                  <div
                    key={r.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.75rem",
                      background: "var(--bg)",
                      borderRadius: "var(--r)",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                        <strong>{subj?.name || "Subject"}</strong> &mdash; <em>{r.predicate}</em> &rarr; <strong>{obj?.name || "Object"}</strong>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                        Source: {r.source} {r.confidence ? `• Confidence: ${(r.confidence * 100).toFixed(0)}%` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span className={`dsc-pill dsc-pill-${r.state || "proposed"}`}>{r.state || "proposed"}</span>
                      {r.state !== "approved" && (
                        <Button size="sm" variant="ghost" onClick={() => handleApproveRel(r.id)}>
                          Approve
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="dsc-panel" style={{ padding: "1.25rem", borderLeft: "4px solid var(--accent)" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>
            Entity Graph Conflicts ({conflicts.length})
          </h3>
          <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
            {conflicts.map((c) => (
              <div key={c.id} style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{c.description || "Graph conflict detected"}</div>
                <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                  <Button size="sm" variant="ghost" onClick={() => handleResolveConflict(c.id, "relationship_corrected")}>
                    Corrected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleResolveConflict(c.id, "not_a_conflict")}>
                    Not a Conflict
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
