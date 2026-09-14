// SubjectScoresPanel.jsx — Subject Scores (BDS / PDS / SFS) (W11 / CP-1.4e).
// Computes and displays Brand Discoverability, Product Discoverability, and Service Findability.
// 🔴 Rule: An excluded component reads "cannot measure yet", never 0, never in danger styling.
// Coverage renders beside the score, always.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

const SCORES_META = {
  brand: {
    id: "brand",
    name: "Brand Discoverability Score (BDS)",
    icon: "award",
    description: "Evaluates recognition, factual corroboration, and presence in answer engines.",
    components: ["name_consistency", "share_of_voice", "trust_citations", "entity_resolution"],
  },
  product: {
    id: "product",
    name: "Product Discoverability Score (PDS)",
    icon: "shopping-bag",
    description: "Evaluates structured product facts, comparisons, pricing, and availability signals.",
    components: ["product_facts", "price_clarity", "specification_depth", "competitor_alignment"],
  },
  service: {
    id: "service",
    name: "Service Findability Score (SFS)",
    icon: "briefcase",
    description: "Evaluates intent coverage, geographic radius, local directory matches, and booking paths.",
    components: ["intent_coverage", "service_radius", "directory_nap", "conversion_readiness"],
  },
};

export default function SubjectScoresPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [subjects, setSubjects] = useState([]);
  const [entities, setEntities] = useState([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [scoring, setScoring] = useState(false);

  // Creation form
  const [newKind, setNewKind] = useState("brand");
  const [newEntityId, setNewEntityId] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [subjRes, graphRes, scoreRes] = await Promise.all([
        discoverability.listSubjects({ workspace_id: workspaceId }).catch(() => ({ subjects: [] })),
        discoverability.getGraph({ workspace_id: workspaceId }).catch(() => ({ entities: [] })),
        discoverability.listSubjectScores({ workspace_id: workspaceId }).catch(() => ({ scores: [] })),
      ]);
      const sList = subjRes.subjects || [];
      setSubjects(sList);
      setEntities((graphRes.entities || []).filter((e) => e.state === "approved"));
      setScores(scoreRes.scores || []);
      if (sList.length > 0 && !selectedSubjectId) {
        setSelectedSubjectId(sList[0].id);
      }
    } catch (err) {
      showToast(err.message || "Failed to load subjects", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedSubjectId, showToast]);

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
      await discoverability.createEntitySubject({
        subjectKind: newKind,
        entityId: newEntityId,
        workspaceId,
      });
      showToast("Score subject created over approved entity.", "check");
      setCreatingSubject(false);
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
        workspace_id: workspaceId,
      });
      showToast("Subject scored successfully.", "check");
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

  const currentSubject = subjects.find((s) => s.id === selectedSubjectId);
  const subjectScores = scores.filter((sc) => sc.subject_id === selectedSubjectId);
  const latestScore = subjectScores[0] || null;
  const meta = currentSubject ? SCORES_META[currentSubject.subject_kind] || SCORES_META.brand : SCORES_META.brand;

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
              <select
                className="dsc-input"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value)}
              >
                <option value="brand">Brand Discoverability (BDS)</option>
                <option value="product">Product Discoverability (PDS)</option>
                <option value="service">Service Findability (SFS)</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Approved Entity
              <select
                className="dsc-input"
                value={newEntityId}
                onChange={(e) => setNewEntityId(e.target.value)}
                required
              >
                <option value="">Select approved entity…</option>
                {entities
                  .filter((e) => {
                    if (newKind === "brand") return ["organization", "brand"].includes(e.entity_type);
                    if (newKind === "product") return e.entity_type === "product";
                    if (newKind === "service") return e.entity_type === "service";
                    return false;
                  })
                  .map((e) => (
                    <option key={e.id} value={e.id}>{e.name} ({e.entity_type})</option>
                  ))}
              </select>
            </label>
          </div>
          <Button size="sm" type="submit">Create Subject</Button>
        </form>
      )}

      {subjects.length === 0 ? (
        <div className="dsc-panel dsc-panel-empty" style={{ padding: "2.5rem", textAlign: "center" }}>
          <Icon name="info" size={28} />
          <h3 style={{ marginTop: "0.5rem", fontWeight: 600 }}>No Scorable Subjects Found</h3>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
            Create an entity in the Entity Graph, approve it, and mint a scorable Brand, Product, or Service subject above.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1.5rem" }}>
          {/* Subjects List */}
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

          {/* Selected Subject Score Card */}
          {currentSubject && (
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <div className="dsc-panel" style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{meta.name}</h3>
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>{meta.description}</p>
                  </div>
                  {/* 🔴 Coverage always rendered beside score */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "2rem", fontWeight: 700, color: latestScore ? "var(--accent)" : "var(--text-sub)" }}>
                      {latestScore?.final_score !== undefined && latestScore?.final_score !== null
                        ? latestScore.final_score.toFixed(1)
                        : "—"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                      Coverage: {latestScore?.coverage !== undefined && latestScore?.coverage !== null
                        ? `${(latestScore.coverage * 100).toFixed(0)}%`
                        : "0%"}
                    </div>
                  </div>
                </div>

                {/* Component Breakdown */}
                <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginTop: "1.5rem", marginBottom: "0.75rem", textTransform: "uppercase" }}>
                  Components & Evidence
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                  {meta.components.map((cKey) => {
                    const compValue = latestScore?.components?.[cKey];
                    const isMeasured = compValue !== undefined && compValue !== null;
                    return (
                      <div
                        key={cKey}
                        style={{
                          padding: "0.75rem",
                          background: "var(--bg)",
                          borderRadius: "var(--r)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", textTransform: "capitalize" }}>
                          {cKey.replace(/_/g, " ")}
                        </div>
                        {/* 🔴 Rule: Unmeasured reads "cannot measure yet", never 0, never in danger */}
                        <div style={{ marginTop: "0.25rem", fontSize: "1.125rem", fontWeight: 600 }}>
                          {isMeasured ? (
                            <span>{(compValue * 100).toFixed(0)}%</span>
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

              {/* Historical Trend */}
              {subjectScores.length > 1 && (
                <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                  <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase" }}>
                    Score History ({subjectScores.length} Audits)
                  </h4>
                  <div style={{ display: "grid", gap: "0.5rem" }}>
                    {subjectScores.slice(0, 5).map((sc, i) => (
                      <div
                        key={sc.id || i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "0.5rem 0.75rem",
                          borderRadius: "var(--r)",
                          background: "var(--bg)",
                        }}
                      >
                        <span style={{ fontSize: "0.8125rem" }}>{new Date(sc.created_at).toLocaleString()}</span>
                        <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                          Score: {sc.final_score?.toFixed(1) || "—"} (Coverage: {((sc.coverage || 0) * 100).toFixed(0)}%)
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
