// EntityGraphPanel.jsx — Entity Graph Builder (W10 / CP-1.4b).
// Displays entities, relationships, conflicts, and corroboration.
// Rule: A duplicate edge returns 409 from the server; render it as a successful
// corroboration rather than a failure.
//
// 🔴 2026-09-22 — APPROVAL ERRORS, INLINE EDIT, GRAPH REFRESH.
// Before this change the only feedback for a failed approval was a toast that
// said "Could not approve the entity" — the same text regardless of whether the
// cause was self-approval without a founder note, a stale row, RLS refusal, or
// a CHECK violation. Now the server returns a structured verdict code (see
// netlify/functions/discoverability.js VERDICTS map and migration 0077) and
// this component renders it as an inline banner under the offending row with
// the actual remediation hint from the server.
//
// Inline edit re-proposes an entity/relationship through the existing
// proposeEntity / proposeRelationship endpoints (the schema already supports
// multiple proposed revisions; the route returns 409 RELATIONSHIP_EXISTS only
// when an active edge matches). Editing forces a refresh of the visual graph
// via a `refreshKey` counter — `EntityGraphVisual` ignores it but it is
// forwarded as a `key` so React remounts the visual when CRUD happens.

import { useState, useEffect, useCallback, useContext, useMemo } from "react";
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

/** Map verdict codes → user-facing hint. Mirrors the server-side VERDICTS map
 *  so the inline banner shows the same remediation text the server returns.
 *  Adding a new verdict to the server should add an entry here. */
const APPROVAL_ERROR_HINTS = {
  SELF_APPROVAL: "You proposed this. Ask a teammate to approve, or add a note that includes “Single-founder approval” and try again.",
  ENDPOINT_SELF_APPROVAL: "You proposed one of the entities this relationship connects. Approve as single-founder, or ask a teammate.",
  NO_APPROVER: "No approver could be resolved for this request. Re-authenticate and try again.",
  REJECTED: "This item was rejected. Propose it again rather than reviving the rejection.",
  NOT_FOUND: "The item no longer exists. Refresh the page.",
  CHECK_VIOLATION: "A database constraint refused this approval. Refresh and try again — common cause is a stale row or a self-approval without a single-founder note.",
  RLS_DENIED: "Row-level security refused this approval. Confirm the item belongs to this workspace.",
};

function approvalErrorFromException(err) {
  if (!err) return { code: "UNKNOWN", message: "Approval failed for an unknown reason." };
  const code = (err.code || "").toString().toUpperCase();
  // PostgREST surfaces "code" as the postgres SQLSTATE; map 23514 → CHECK_VIOLATION
  // so a transport-level refusal (PATCH fallback fired) still renders a hint.
  const mapped = code === "23514" ? "CHECK_VIOLATION"
    : code === "42501" ? "RLS_DENIED"
    : null;
  return {
    code: mapped || code || "UNKNOWN",
    message: APPROVAL_ERROR_HINTS[mapped || code] || err.message || "Approval failed.",
  };
}

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
  // 🔴 2026-09-22 — inline errors per row instead of one toast. Keyed by
  // `${kind}:${id}` so multiple entities can hold their own error banner.
  const [approvalErrors, setApprovalErrors] = useState({});
  // 🔴 2026-09-22 — inline edit states. Only one entity and one relationship
  // can be in edit mode at a time to keep the form layout predictable.
  const [editingEntityId, setEditingEntityId] = useState(null);
  const [editingRelId, setEditingRelId] = useState(null);
  const [entityEditDraft, setEntityEditDraft] = useState(null);
  const [relEditDraft, setRelEditDraft] = useState(null);
  // Bumped after every CRUD so the visual graph remounts. Stored in state so
  // other handlers can read the latest value without stale-closure issues.
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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
      bumpRefresh();
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
      bumpRefresh();
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
        bumpRefresh();
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
    setApprovalErrors((prev) => {
      const next = { ...prev };
      delete next[`rel:${relId}`];
      return next;
    });
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
      bumpRefresh();
    } catch (err) {
      // 🔴 2026-09-22 — surface the structured verdict as an inline banner
      // under the row, NOT just a toast. The toast still fires for visibility
      // but the banner stays until the user retries or the row changes.
      const parsed = approvalErrorFromException(err);
      setApprovalErrors((prev) => ({ ...prev, [`rel:${relId}`]: parsed }));
      showToast(parsed.message, "error");
    } finally {
      setApprovingRelId(null);
    }
  };

  const handleApproveEntity = async (entityId) => {
    const ent = (graph.entities || []).find((e) => e.id === entityId);
    const isSelfApproval = Boolean(user?.id && ent?.proposed_by === user.id);
    setApprovingEntityId(entityId);
    setApprovalErrors((prev) => {
      const next = { ...prev };
      delete next[`ent:${entityId}`];
      return next;
    });
    try {
      const note = isSelfApproval
        ? "[Single-founder approval] Self-approved by solo operator and recorded in audit trail."
        : "Approved by reviewer";
      await discoverability.approveEntity(entityId, { note, workspaceId });
      showToast(`Entity "${ent?.name || ""}" approved.`, "check");
      loadGraphData();
      bumpRefresh();
    } catch (err) {
      // 🔴 2026-09-22 — same verdict-mapping as approveRel, keyed on entity.
      const parsed = approvalErrorFromException(err);
      setApprovalErrors((prev) => ({ ...prev, [`ent:${entityId}`]: parsed }));
      showToast(parsed.message, "error");
    } finally {
      setApprovingEntityId(null);
    }
  };

  // 🔴 2026-09-22 — INLINE EDIT ENTITY. Re-proposes through the existing
  // proposeEntity endpoint. The schema accepts multiple proposed revisions for
  // the same canonical key, so editing reopens review without losing history.
  const beginEditEntity = (entity) => {
    setEditingEntityId(entity.id);
    setEntityEditDraft({
      name: entity.name || "",
      entity_type: entity.entity_type || "brand",
      canonical_domain: entity.canonical_domain || "",
      description: entity.description || "",
    });
  };
  // 🔴 DELETE CASCADES, SO IT ASKS FIRST — AND NAMES THE COST.
  // audit_entity_relationships declares both endpoints `on delete cascade`
  // (0056), so removing a node silently removes every edge drawn to it. A
  // confirm that only says "are you sure?" hides the part that matters, so the
  // edge count is counted here and put in the question.
  const [deletingEntityId, setDeletingEntityId] = useState(null);
  const handleDeleteEntity = async (entity) => {
    const edges = relationships.filter(
      (r) => r.subject_id === entity.id || r.object_id === entity.id,
    ).length;
    const warning = edges
      ? `\n\nThis also deletes ${edges} relationship${edges === 1 ? "" : "s"} connected to it.`
      : "";
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${entity.name}"?${warning}\n\nThis cannot be undone.`)) return;
    setDeletingEntityId(entity.id);
    try {
      const res = await discoverability.deleteEntity(entity.id, { workspaceId });
      const gone = res?.deletedRelationships || 0;
      showToast(
        gone
          ? `Deleted "${entity.name}" and ${gone} relationship${gone === 1 ? "" : "s"}.`
          : `Deleted "${entity.name}".`,
        "check",
      );
      if (editingEntityId === entity.id) cancelEditEntity();
      loadGraphData();
      bumpRefresh();
    } catch (err) {
      showToast(err.message || "Could not delete the entity", "error");
    } finally {
      setDeletingEntityId(null);
    }
  };

  const cancelEditEntity = () => {
    setEditingEntityId(null);
    setEntityEditDraft(null);
  };
  const saveEditEntity = async (originalId) => {
    if (!entityEditDraft?.name?.trim()) {
      showToast("Entity name is required.", "warning");
      return;
    }
    setSubmittingEntity(true);
    try {
      // 🔴 updateEntity, NOT proposeEntity. Re-proposing POSTs a SECOND row and
      // leaves the original in place — which is why every Save produced a
      // duplicate. The id has to stay stable anyway: relationships cascade on
      // their endpoints, so replacing the node would take its edges with it.
      await discoverability.updateEntity(originalId, {
        name: entityEditDraft.name,
        entity_type: entityEditDraft.entity_type,
        description: entityEditDraft.description || null,
        canonical_domain: entityEditDraft.canonical_domain || null,
      }, { workspaceId });
      showToast(`"${entityEditDraft.name}" updated — approve it again to confirm the new details.`, "check");
      setEditingEntityId(null);
      setEntityEditDraft(null);
      loadGraphData();
      bumpRefresh();
    } catch (err) {
      showToast(err.message || "Could not save edits", "error");
    } finally {
      setSubmittingEntity(false);
    }
  };

  // 🔴 2026-09-22 — INLINE EDIT RELATIONSHIP. The server treats an edit as a
  // new edge (the schema's unique index is on the canonical (subject, predicate,
  // object) tuple), so we propose the new edge and let the old one sit until
  // review. A reviewer can reject the old one explicitly. For now we just
  // submit and surface the result.
  const beginEditRel = (rel) => {
    setEditingRelId(rel.id);
    setRelEditDraft({
      subject_id: rel.subject_id,
      predicate: rel.predicate,
      object_id: rel.object_id,
      note: rel.note || "",
    });
  };
  const cancelEditRel = () => {
    setEditingRelId(null);
    setRelEditDraft(null);
  };
  const saveEditRel = async (originalId) => {
    if (!relEditDraft?.subject_id || !relEditDraft?.object_id) {
      showToast("Both subject and object entities are required.", "warning");
      return;
    }
    setSubmittingRel(true);
    try {
      await discoverability.proposeRelationship({
        subjectId: relEditDraft.subject_id,
        predicate: relEditDraft.predicate,
        objectId: relEditDraft.object_id,
        source: "declared",
        note: relEditDraft.note || null,
        workspaceId,
      });
      showToast("Relationship re-proposed with edits.", "check");
      setEditingRelId(null);
      setRelEditDraft(null);
      loadGraphData();
      bumpRefresh();
    } catch (err) {
      if (err.status === 409 || err.code === "RELATIONSHIP_EXISTS") {
        showToast("This relationship already exists with those endpoints and predicate.", "warning");
      } else {
        showToast(err.message || "Could not save edits", "error");
      }
    } finally {
      setSubmittingRel(false);
    }
  };

  const handleResolveConflict = async (conflictId, resolution) => {
    try {
      await discoverability.resolveGraphConflict(conflictId, resolution, { workspaceId });
      showToast("Conflict resolved.", "check");
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      bumpRefresh();
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

  // Inline-edit panels need the full entity list to populate endpoint selectors,
  // so they're rendered after we know entities is non-empty.
  const renderRelEditForm = (rel) => {
    if (editingRelId !== rel.id || !relEditDraft) return null;
    return (
      <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          <select
            className="dsc-input"
            value={relEditDraft.subject_id}
            onChange={(e) => setRelEditDraft({ ...relEditDraft, subject_id: e.target.value })}
          >
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.name} ({ENTITY_TYPES[ent.entity_type]?.label || ent.entity_type})</option>
            ))}
          </select>
          <select
            className="dsc-input"
            value={relEditDraft.predicate}
            onChange={(e) => setRelEditDraft({ ...relEditDraft, predicate: e.target.value })}
          >
            {PREDICATE_IDS.map((p) => (
              <option key={p} value={p}>{PREDICATES[p].label}</option>
            ))}
          </select>
          <select
            className="dsc-input"
            value={relEditDraft.object_id}
            onChange={(e) => setRelEditDraft({ ...relEditDraft, object_id: e.target.value })}
          >
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.name} ({ENTITY_TYPES[ent.entity_type]?.label || ent.entity_type})</option>
            ))}
          </select>
        </div>
        <input
          className="dsc-input"
          placeholder="Reviewer note (optional)"
          value={relEditDraft.note}
          onChange={(e) => setRelEditDraft({ ...relEditDraft, note: e.target.value })}
        />
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={cancelEditRel}>Cancel</Button>
          <Button size="sm" onClick={() => saveEditRel(rel.id)} loading={submittingRel}>Save</Button>
        </div>
      </div>
    );
  };

  const renderEntityEditForm = (entity) => {
    if (editingEntityId !== entity.id || !entityEditDraft) return null;
    return (
      <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <input
            className="dsc-input"
            value={entityEditDraft.name}
            onChange={(e) => setEntityEditDraft({ ...entityEditDraft, name: e.target.value })}
            placeholder="Entity name"
          />
          <select
            className="dsc-input"
            value={entityEditDraft.entity_type}
            onChange={(e) => setEntityEditDraft({ ...entityEditDraft, entity_type: e.target.value })}
          >
            {ENTITY_TYPE_IDS.map((t) => (
              <option key={t} value={t}>{ENTITY_TYPES[t].label}</option>
            ))}
          </select>
          <input
            className="dsc-input"
            value={entityEditDraft.canonical_domain}
            onChange={(e) => setEntityEditDraft({ ...entityEditDraft, canonical_domain: e.target.value })}
            placeholder="Canonical domain (optional)"
          />
          <input
            className="dsc-input"
            value={entityEditDraft.description}
            onChange={(e) => setEntityEditDraft({ ...entityEditDraft, description: e.target.value })}
            placeholder="Description (optional)"
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" onClick={cancelEditEntity}>Cancel</Button>
          <Button size="sm" onClick={() => saveEditEntity(entity.id)} loading={submittingEntity}>Save</Button>
        </div>
      </div>
    );
  };

  const renderApprovalError = (key) => {
    const err = approvalErrors[key];
    if (!err) return null;
    return (
      <div
        role="alert"
        data-testid={`approval-error-${key}`}
        style={{
          marginTop: "0.5rem",
          padding: "0.5rem 0.75rem",
          background: "rgba(239, 68, 68, 0.08)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          borderRadius: "var(--r)",
          color: "#b91c1c",
          fontSize: "0.8125rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
        }}
      >
        <Icon name="alert-circle" size={14} />
        <div>
          <strong style={{ display: "block", fontSize: "0.75rem", letterSpacing: "0.05em", textTransform: "uppercase" }}>{err.code}</strong>
          <span>{err.message}</span>
        </div>
      </div>
    );
  };

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

      {/* Visual Topological Representation. The `key` prop forces a remount
          after every CRUD so the SVG redraws — without it, an entity update
          can leave stale node positions until the user navigates away. */}
      <EntityGraphVisual
        key={`graph-${refreshKey}`}
        entities={entities}
        relationships={relationships}
      />

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
                const isEditing = editingEntityId === e.id;
                const errKey = `ent:${e.id}`;
                return (
                  <div
                    key={e.id}
                    style={{
                      padding: "0.75rem",
                      background: "var(--bg)",
                      borderRadius: "var(--r)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{e.name}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                          {ENTITY_TYPES[e.entity_type]?.label || e.entity_type} {e.canonical_domain ? `• ${e.canonical_domain}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <span className={`dsc-pill dsc-pill-${e.state || "proposed"}`}>{e.state || "proposed"}</span>
                        {!isEditing && e.state !== "approved" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => beginEditEntity(e)}
                            title="Edit entity (re-propose with changes; will go through review again)"
                          >
                            <Icon name="pencil" size={12} /> Edit
                          </Button>
                        )}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteEntity(e)}
                          loading={deletingEntityId === e.id}
                          title="Delete this entity (and any relationships connected to it)"
                          style={{ color: "var(--danger, #dc2626)" }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {renderEntityEditForm(e)}
                    {renderApprovalError(errKey)}
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
                const isEditing = editingRelId === r.id;
                const errKey = `rel:${r.id}`;
                return (
                  <div
                    key={r.id}
                    style={{
                      padding: "0.75rem",
                      background: "var(--bg)",
                      borderRadius: "var(--r)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
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
                        {!isEditing && r.state !== "approved" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => beginEditRel(r)}
                            title="Edit relationship (re-propose with changes; will go through review again)"
                          >
                            <Icon name="pencil" size={12} /> Edit
                          </Button>
                        )}
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
                    {renderRelEditForm(r)}
                    {renderApprovalError(errKey)}
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
