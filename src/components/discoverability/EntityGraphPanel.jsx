// EntityGraphPanel.jsx — Entity Graph Builder (W10 / CP-1.4b).
// Displays entities, relationships, conflicts, and corroboration.
// Rule: A duplicate edge returns 409 from the server; render it as a successful
// corroboration rather than a failure.

import { useState, useEffect, useCallback, useContext } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { AuthContext } from "../AuthProvider.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { cacheKey, readCache, loadWithCache } from "../../lib/discoverability/tabCache.js";
// ⚠️ IMPORTED, NEVER RETYPED. The hand-written lists here offered `operates`,
// `features`, `author_of`, `parent_of`, `place` and `local_business`, none of
// which the registry (or 0056/0065's CHECK constraints) accepts — so choosing
// one produced a 400 from a form that looked valid.
import {
  ENTITY_TYPES, ENTITY_TYPE_IDS, PREDICATES, PREDICATE_IDS, GRAPH_CONFLICT_CODES,
} from "../../lib/discoverability/entityGraph.js";
import EntityGraphVisual from "./EntityGraphVisual.jsx";

export default function EntityGraphPanel({ workspaceId = null, currentUser = null }) {
  const showToast = useToast();
  const authContext = useContext(AuthContext);
  const user = currentUser || authContext?.user || null;
  const [graph, setGraph] = useState({ entities: [], relationships: [] });
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proposingEntity, setProposingEntity] = useState(false);
  const [proposingRel, setProposingRel] = useState(false);
  const [submittingEntity, setSubmittingEntity] = useState(false);
  const [submittingRel, setSubmittingRel] = useState(false);
  const [approvingRelId, setApprovingRelId] = useState(null);
  const [approvingEntityId, setApprovingEntityId] = useState(null);
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

  // Paint the last-seen graph from localStorage, then refresh from the database.
  const loadGraphData = useCallback(async () => {
    const key = cacheKey("entity-graph", { userId: user?.id || null, workspaceId });
    if (!readCache(key)) setLoading(true);
    try {
      await loadWithCache(key,
        async () => {
          const [graphRes, conflictRes] = await Promise.all([
            discoverability.getGraph({ workspace_id: workspaceId }).catch(() => ({ entities: [], relationships: [] })),
            discoverability.graphConflicts({ workspace_id: workspaceId }).catch(() => ({ conflicts: [] })),
          ]);
          return { graphRes, conflictRes };
        },
        ({ graphRes, conflictRes }) => {
          setGraph(graphRes || { entities: [], relationships: [] });
          setConflicts(conflictRes?.conflicts || []);
          setLoading(false);
        });
    } catch (err) {
      showToast(err.message || "Failed to load entity graph", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast, user?.id]);

  useEffect(() => {
    loadGraphData();
  }, [loadGraphData]);

  const handleProposeEntity = async (e) => {
    e.preventDefault();
    setSubmittingEntity(true);
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
    } finally {
      setSubmittingEntity(false);
    }
  };

  const handleProposeRelationship = async (e) => {
    e.preventDefault();
    if (!relForm.subject_id || !relForm.object_id) {
      showToast("Both subject and object entities are required.", "warning");
      return;
    }
    setSubmittingRel(true);
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
      // 409 means the edge already exists. Whether the sighting was RECORDED is
      // a separate fact the server reports — claiming corroboration it could not
      // write would repeat the lie that route's own comment records fixing.
      if (err.status === 409 || err.code === "RELATIONSHIP_EXISTS") {
        setCorroborationNotice({
          text: err.corroborated === false
            ? "This relationship already exists. Your sighting could not be recorded against it — try again shortly."
            : "Relationship corroborated! This edge already exists in the graph and your observation has been added to its corroboration history.",
          time: new Date().toLocaleTimeString(),
        });
        showToast(err.corroborated === false ? "Relationship already exists." : "Corroborated existing relationship.", "check");
        setProposingRel(false);
        loadGraphData();
      } else {
        showToast(err.message || "Could not propose relationship", "error");
      }
    } finally {
      setSubmittingRel(false);
    }
  };

  const handleApproveRel = async (relId) => {
    const rel = (graph.relationships || []).find((r) => r.id === relId);
    // Approving an edge also approves its still-proposed ENDPOINTS under the
    // same reviewer (approve_entity_relationship). If this user proposed either
    // endpoint, that is a self-approval too — sending the generic note there
    // tripped audit_entities_no_self_approval and the whole approval failed.
    const endpointIds = [rel?.subject_id, rel?.object_id];
    const ownsProposedEndpoint = (graph.entities || []).some(
      (e) => endpointIds.includes(e.id) && e.state !== "approved" && e.proposed_by && e.proposed_by === user?.id,
    );
    const isSelfApproval = Boolean(user?.id && (rel?.proposed_by === user.id || ownsProposedEndpoint));
    setApprovingRelId(relId);
    try {
      const note = isSelfApproval
        ? "[Single-founder approval] Self-approved by solo operator and recorded in audit trail."
        : "Approved by reviewer";
      const opts = { workspaceId, note };
      if (discoverability.approveRelationship) {
        await discoverability.approveRelationship(relId, opts);
      } else if (discoverability.reviewRelation) {
        await discoverability.reviewRelation(relId, "approve", { note, workspaceId });
      }
      showToast("Relationship and endpoints approved.", "check");
      loadGraphData();
    } catch (err) {
      showToast(err.message || "Failed to approve relationship", "error");
    } finally {
      setApprovingRelId(null);
    }
  };

  const handleApproveEntity = async (entityId) => {
    const ent = (graph.entities || []).find((e) => e.id === entityId);
    const isSelfApproval = Boolean(user?.id && ent?.proposed_by === user.id);
    setApprovingEntityId(entityId);
    try {
      const note = isSelfApproval
        ? "[Single-founder approval] Self-approved by solo operator and recorded in audit trail."
        : "Approved by reviewer";
      await discoverability.approveEntity(entityId, { note, workspaceId });
      showToast(`Entity "${ent?.name || ""}" approved.`, "check");
      loadGraphData();
    } catch (err) {
      showToast(err.message || "Failed to approve entity", "error");
    } finally {
      setApprovingEntityId(null);
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
                {ENTITY_TYPE_IDS.map((t) => (
                  <option key={t} value={t}>{ENTITY_TYPES[t].label}</option>
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
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" type="submit" loading={submittingEntity}>Submit Entity</Button>
          </div>
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
                  <option key={ent.id} value={ent.id}>{ent.name} ({ENTITY_TYPES[ent.entity_type]?.label || ent.entity_type})</option>
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
                {PREDICATE_IDS.map((p) => (
                  <option key={p} value={p}>{PREDICATES[p].label}</option>
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
                  <option key={ent.id} value={ent.id}>{ent.name} ({ENTITY_TYPES[ent.entity_type]?.label || ent.entity_type})</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" type="submit" loading={submittingRel}>Propose Relationship</Button>
          </div>
        </form>
      )}

      {/* Visual Topological Representation */}
      <EntityGraphVisual entities={entities} relationships={relationships} />

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
              {entities.map((e) => {
                const mine = Boolean(user?.id && e.proposed_by === user.id);
                return (
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
                        {ENTITY_TYPES[e.entity_type]?.label || e.entity_type} {e.canonical_domain ? `• ${e.canonical_domain}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span className={`dsc-pill dsc-pill-${e.state || "proposed"}`}>{e.state || "proposed"}</span>
                      {e.state !== "approved" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleApproveEntity(e.id)}
                          loading={approvingEntityId === e.id}
                          title={
                            mine
                              ? "Approve entity as solo operator (records [Single-founder approval]). Secondary checker can be assigned if team members are in workspace."
                              : "Approve entity node"
                          }
                        >
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
                const mine = Boolean(user?.id && r.proposed_by === user.id);
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
                        <strong>{subj?.name || "Subject"}</strong> &mdash; <em>{PREDICATES[r.predicate]?.label || r.predicate}</em> &rarr; <strong>{obj?.name || "Object"}</strong>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                        Source: {r.source} {r.confidence ? `• Confidence: ${(r.confidence * 100).toFixed(0)}%` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span className={`dsc-pill dsc-pill-${r.state || "proposed"}`}>{r.state || "proposed"}</span>
                      {r.state !== "approved" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleApproveRel(r.id)}
                          loading={approvingRelId === r.id}
                          title={
                            mine
                              ? "Approve relationship as solo operator (records [Single-founder approval]). Secondary checker can be assigned if team members are in workspace."
                              : "Approve relationship and endpoints"
                          }
                        >
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
                <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                  {c.code ? `${c.code}: ` : ""}{c.message || GRAPH_CONFLICT_CODES[c.code]?.label || "Graph conflict detected"}
                </div>
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
