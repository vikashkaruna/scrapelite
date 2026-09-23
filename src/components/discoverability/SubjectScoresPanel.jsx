// SubjectScoresPanel.jsx — Subject Scores (BDS / PDS / SFS) (W11 / CP-1.4e).
// Computes and displays Brand Discoverability, Product Discoverability, and Service Findability.
// 🔴 Rule: An excluded component reads "cannot measure yet", never 0, never in danger styling.
// Coverage renders beside the score, always.
//
// ⚠️ EVERYTHING HERE IS READ FROM THE MODEL OR THE STORED ROW, NEVER RETYPED.
// This screen previously invented its own component names ("name_consistency",
// "price_clarity", …) that no formula has, read `final_score` and `created_at`
// from a row that stores `score` and `scored_at`, multiplied an already-percent
// coverage by 100, and listed subjects from a route that did not exist — so it
// showed "No Scorable Subjects Found" to every account, including ones that had
// just created one.

import { Link } from "react-router";
import { useState, useEffect, useCallback, useContext } from "react";
import { AuthContext } from "../AuthProvider.jsx";
import { cacheKey, readCache, loadWithCache } from "../../lib/discoverability/tabCache.js";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { SUBJECT_SCORES, SUBJECT_SCORE_IDS, THIN_COVERAGE } from "../../lib/discoverability/subjectScoring.js";
import { SCORABLE_ENTITY_TYPES } from "../../lib/discoverability/subjectModel.js";

const DESCRIPTIONS = {
  brand: "Recognition, factual corroboration, and presence in answer engines.",
  product: "Structured product facts, comparisons, pricing, and availability signals.",
  service: "Intent coverage, service radius, local directory matches, and booking paths.",
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 🔴 2026-09-22 — inline empty-state copy when entities exist but none are
 *  approved yet.
 *
 *  ⚠️ THIS USES <Link>, NOT <a href>. An <a href> here "works" — the browser
 *  navigates and the SPA boots at the new route — which is exactly why it
 *  survives review. What it silently costs is a FULL DOCUMENT RELOAD: the
 *  billing/entitlement context is rebuilt, the 60s entitlement cache is
 *  discarded, and any audit in flight in ActiveAuditContext is abandoned. On a
 *  panel whose entire job is "go approve that entity, then come back", that is
 *  the worst possible place to drop state. CLAUDE.md states the rule directly:
 *  inside the app, route through the router; window.location is for LEAVING
 *  the app. Callers must render this inside a Router (the panel already is,
 *  via DiscoverabilityWorkspace). */
function PendingEntitiesHint({ count }) {
  return (
    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", maxWidth: "32rem", margin: "0 auto" }}>
      <strong>{count}</strong> {count === 1 ? "entity is" : "entities are"} awaiting approval in the
      {" "}
      <Link to="/discoverability/entities" style={{ color: "var(--accent)", textDecoration: "underline" }}>
        Entity Graph
      </Link>
      . Approve them to create scorable subjects.
    </p>
  );
}

/** The components to render: the stored row's when scored, the registry's otherwise. */
export function componentsFor(kind, latestScore) {
  if (Array.isArray(latestScore?.components) && latestScore.components.length) {
    return latestScore.components;
  }
  const spec = SUBJECT_SCORES[kind];
  if (!spec) return [];
  return Object.entries(spec.components).map(([id, c]) => ({ id, ...c, value: null }));
}

export default function SubjectScoresPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [subjects, setSubjects] = useState([]);
  const [entities, setEntities] = useState([]);
  const [allEntities, setAllEntities] = useState([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [scoring, setScoring] = useState(false);

  const [newKind, setNewKind] = useState(SUBJECT_SCORE_IDS[0]);
  const [newEntityId, setNewEntityId] = useState("");

  const cacheUserId = useContext(AuthContext)?.user?.id || null;

  // Paint the last-seen subjects and scores from localStorage, then refresh from the database.
  const loadData = useCallback(async () => {
    const key = cacheKey("subject-scores", { userId: cacheUserId, workspaceId });
    if (!readCache(key)) setLoading(true);
    try {
      await loadWithCache(key,
        async () => {
          const [subjRes, graphRes, scoreRes] = await Promise.all([
            discoverability.listSubjects({ workspace_id: workspaceId }).catch(() => ({ subjects: [] })),
            discoverability.getGraph({ workspace_id: workspaceId }).catch(() => ({ entities: [] })),
            discoverability.listSubjectScores({ workspace_id: workspaceId }).catch(() => ({ scores: [] })),
          ]);
          return { subjRes, graphRes, scoreRes };
        },
        ({ subjRes, graphRes, scoreRes }) => {
          const isApprovedEntity = (e) => (e?.state || e?.status || "").toLowerCase() === "approved";
          const list = (subjRes?.subjects || []).filter((s) => SUBJECT_SCORES[s.subject_kind]);
          setSubjects(list);
          setAllEntities(graphRes?.entities || []);
          setEntities((graphRes?.entities || []).filter(isApprovedEntity));
          setScores(scoreRes?.scores || []);
          setSelectedSubjectId((current) => (
            current && list.some((s) => s.id === current) ? current : list[0]?.id || ""
          ));
          setLoading(false);
        });
    } catch (err) {
      showToast(err.message || "Failed to load subjects", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast, cacheUserId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSubject = async (e) => {
    e.preventDefault();
    if (!newEntityId) {
      showToast("Please select an approved entity to link this subject to.", "warning");
      return;
    }
    try {
      await discoverability.createEntitySubject({ subjectKind: newKind, entityId: newEntityId, workspaceId });
      showToast("Score subject created over approved entity.", "check");
      setCreatingSubject(false);
      setNewEntityId("");
      loadData();
    } catch (err) {
      showToast(err.message || "Could not create subject", "error");
    }
  };

  const handleRunScore = async () => {
    if (!selectedSubjectId) return;
    setScoring(true);
    try {
      const res = await discoverability.scoreSubject({
        subject_id: selectedSubjectId,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      });
      showToast(
        res?.thin
          ? "Scored — but coverage is thin, so treat this as provisional."
          : "Subject scored successfully.",
        res?.thin ? "warning" : "check",
      );
      loadData();
    } catch (err) {
      showToast(err.message || "Scoring failed", "error");
    } finally {
      setScoring(false);
    }
  };

  if (loading) {
    return (
      <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
        <Icon name="rotate-cw" size={24} className="spin" />
        <p style={{ marginTop: "0.5rem" }}>Loading Subject Scores…</p>
      </div>
    );
  }

  const currentSubject = subjects.find((s) => s.id === selectedSubjectId) || null;
  const subjectScores = scores.filter((sc) => sc.subject_id === selectedSubjectId);
  const latestScore = subjectScores[0] || null;
  const spec = currentSubject ? SUBJECT_SCORES[currentSubject.subject_kind] : null;
  const components = currentSubject ? componentsFor(currentSubject.subject_kind, latestScore) : [];
  const isApproved = (e) => (e?.state || e?.status || "").toLowerCase() === "approved";
  const eligibleEntities = entities.filter((e) => (SCORABLE_ENTITY_TYPES[newKind] || []).includes(e.entity_type));
  const pendingEntities = allEntities.filter((e) => (SCORABLE_ENTITY_TYPES[newKind] || []).includes(e.entity_type) && !isApproved(e));
  // 🔴 2026-09-22 — count of pending entities across ALL subject kinds, not
  // just the currently-selected `newKind`. The empty state needs the global
  // figure so the user knows whether they should approve one entity to mint
  // their first subject, or whether they have several waiting already.
  const allScorableEntityTypes = Object.values(SCORABLE_ENTITY_TYPES).flat();
  const totalPendingScorable = allEntities.filter(
    (e) => allScorableEntityTypes.includes(e.entity_type) && !isApproved(e),
  );
  const thin = latestScore && (latestScore.score === null || Number(latestScore.coverage) < THIN_COVERAGE);

  return (
    <div className="dsc-subjects-surface" style={{ display: "grid", gap: "1.5rem" }}>
      <div className="dsc-header-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="target" size={20} /> Subject Discoverability Scores
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Measure entity-level presence for Brands (BDS), Products (PDS), and Services (SFS) independent of individual page URLs.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button size="sm" variant="secondary" onClick={() => setCreatingSubject(!creatingSubject)}>
            <Icon name="plus" size={14} /> {creatingSubject ? "Cancel" : "New Scorable Subject"}
          </Button>
          {selectedSubjectId && (
            <Button size="sm" onClick={handleRunScore} loading={scoring}>
              <Icon name="refresh-cw" size={14} /> Calculate Score
            </Button>
          )}
        </div>
      </div>

      {creatingSubject && (
        <form onSubmit={handleCreateSubject} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Create Subject Over Approved Entity (CP-1.1)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Subject Kind
              <select className="dsc-input" value={newKind} onChange={(e) => { setNewKind(e.target.value); setNewEntityId(""); }}>
                {SUBJECT_SCORE_IDS.map((id) => (
                  <option key={id} value={id}>{SUBJECT_SCORES[id].label} ({SUBJECT_SCORES[id].code})</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Approved Entity
              <select className="dsc-input" value={newEntityId} onChange={(e) => setNewEntityId(e.target.value)} required>
                <option value="">Select approved entity…</option>
                {eligibleEntities.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.entity_type}) — Approved</option>
                ))}
                {pendingEntities.map((e) => (
                  <option key={e.id} value="" disabled>{e.name} ({e.entity_type}) — Pending Approval</option>
                ))}
              </select>
            </label>
          </div>
          {eligibleEntities.length === 0 && (
            <p style={{ fontSize: "0.8125rem", color: "var(--text-sub)", margin: 0 }}>
              No approved {(SCORABLE_ENTITY_TYPES[newKind] || []).join(" or ")} entity yet — approve one in the Entity Graph first.
              {pendingEntities.length > 0 && ` (${pendingEntities.length} proposed awaiting approval in Entity Graph)`}
            </p>
          )}
          {/* 🔴 2026-09-22 — wrap the submit button in a flex-end container so
              it no longer spans the full form width. The form parent is a CSS
              grid; the previous placement made the button a full-width grid
              child, which looked out of place next to every other submit
              button in the app. Matches EntityGraphPanel's pattern. */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" type="submit">Create Subject</Button>
          </div>
        </form>
      )}

      {subjects.length === 0 ? (
        // 🔴 2026-09-22 — entity-aware empty state. Before this change the
        // empty state said "Create an entity in the Entity Graph, approve it,
        // and mint a scorable Brand, Product, or Service subject above." with
        // no clue about whether the user actually had entities awaiting
        // approval. Now the message is split: if there ARE pending entities,
        // tell the user exactly how many and link to the Entity Graph tab so
        // they can approve them; if there are NONE, point them at Add Entity.
        <div
          data-testid="subject-scores-empty"
          className="dsc-panel dsc-panel-empty"
          style={{ padding: "2.5rem", textAlign: "center" }}
        >
          <Icon name="info" size={28} />
          <h3 style={{ marginTop: "0.5rem", fontWeight: 600 }}>No Scorable Subjects Found</h3>
          {totalPendingScorable.length > 0 ? (
            <PendingEntitiesHint count={totalPendingScorable.length} />
          ) : (
            <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
              Create an entity in the Entity Graph, approve it, and mint a scorable Brand, Product, or Service subject above.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1.5rem" }}>
          <div className="dsc-panel" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Subjects ({subjects.length})
            </h4>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedSubjectId(s.id)}
                  aria-pressed={selectedSubjectId === s.id}
                  style={{
                    textAlign: "left",
                    padding: "0.625rem",
                    borderRadius: "var(--r)",
                    border: selectedSubjectId === s.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: selectedSubjectId === s.id ? "var(--surface)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{s.label || s.subject_kind}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", textTransform: "uppercase" }}>
                    {s.subject_kind} {s.canonical_domain ? `• ${s.canonical_domain}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {currentSubject && spec && (
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <div className="dsc-panel" style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{spec.label} ({spec.code})</h3>
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
                      {DESCRIPTIONS[currentSubject.subject_kind]}
                    </p>
                  </div>
                  {/* 🔴 Coverage always rendered beside score */}
                  <div style={{ textAlign: "right" }} data-testid="subject-score">
                    <div style={{ fontSize: "2rem", fontWeight: 700, color: isNum(Number(latestScore?.score)) && latestScore?.score !== null ? "var(--accent)" : "var(--text-sub)" }}>
                      {latestScore && latestScore.score !== null && latestScore.score !== undefined
                        ? Number(latestScore.score).toFixed(1)
                        : "—"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                      Coverage: {latestScore ? `${Math.round(Number(latestScore.coverage) || 0)}%` : "not scored yet"}
                    </div>
                    {thin && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", fontStyle: "italic" }}>
                        Thin coverage — provisional
                      </div>
                    )}
                  </div>
                </div>

                <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginTop: "1.5rem", marginBottom: "0.75rem", textTransform: "uppercase" }}>
                  Components & Evidence
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                  {components.map((c) => {
                    const measured = isNum(c.value);
                    return (
                      <div
                        key={c.id}
                        data-testid={`component-${c.id}`}
                        style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)", border: "1px solid var(--border)" }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                          {c.label || c.id} · weight {Math.round((c.weight || 0) * 100)}%
                        </div>
                        {/* 🔴 Rule: Unmeasured reads "cannot measure yet", never 0, never in danger */}
                        <div style={{ marginTop: "0.25rem", fontSize: "1.125rem", fontWeight: 600 }}>
                          {measured ? (
                            <span>{Math.round(c.value)}</span>
                          ) : (
                            <span style={{ fontSize: "0.75rem", color: "var(--text-sub)", fontStyle: "italic", fontWeight: 400 }}>
                              cannot measure yet
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {subjectScores.length > 1 && (
                <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                  <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase" }}>
                    Score History ({subjectScores.length} Runs)
                  </h4>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    {subjectScores.slice(0, 5).map((sc, i) => (
                      <div
                        key={sc.id || i}
                        style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0.75rem", borderRadius: "var(--r)", background: "var(--bg)" }}
                      >
                        <span style={{ fontSize: "0.8125rem" }}>{sc.scored_at ? new Date(sc.scored_at).toLocaleString() : "—"}</span>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                          Score: {sc.score !== null && sc.score !== undefined ? Number(sc.score).toFixed(1) : "—"}
                          {" "}(Coverage: {Math.round(Number(sc.coverage) || 0)}%)
                        </span>
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
