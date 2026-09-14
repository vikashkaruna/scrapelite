// SchemaTrustPanel.jsx — Schema Intelligence & Trust and Proof (W13 / CP-1.4d).
// Displays structured schema entities, verified trust signals, and the trust score.
// 🔴 Rule: Explain why more markup without evidence lowers fidelity.
//
// ⚠️ THE SIGNAL LIST IS IMPORTED FROM THE MODEL, NEVER RETYPED. This screen used
// to offer six hand-written signals (authorship, citation, review, …) and the
// server's TRUST_SIGNALS accepted none of them, so every "Record observation"
// answered 400 "Unknown trust signal". A list the route validates against has to
// be the list the form offers.
//
// ⚠️ `independence` IS NOT A FORM FIELD. The route derives it — a checkable
// source URL records a third-party observation; none records a self-published
// one — and refuses the field outright if a client sends it.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { TRUST_SIGNALS, TRUST_SIGNAL_IDS } from "../../lib/discoverability/trustProof.js";

const EMPTY_FORM = Object.freeze({
  signal: TRUST_SIGNAL_IDS[0],
  source_url: "",
  observed_count: 1,
  excerpt: "",
});

const INDEPENDENCE_LABELS = {
  third_party: "Independent",
  self_attributed: "Claimed independent (unsourced)",
  self_published: "Self-published",
};

export default function SchemaTrustPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [schemaEntities, setSchemaEntities] = useState([]);
  const [trustObservations, setTrustObservations] = useState([]);
  const [trust, setTrust] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addingTrust, setAddingTrust] = useState(false);
  const [trustForm, setTrustForm] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schemaRes, trustRes] = await Promise.all([
        discoverability.listSchemaEntities({ workspace_id: workspaceId }).catch(() => ({ entities: [] })),
        discoverability.listTrustObservations({ workspace_id: workspaceId }).catch(() => ({ observations: [] })),
      ]);
      setSchemaEntities(schemaRes.entities || []);
      setTrustObservations(trustRes.observations || []);
      setTrust(trustRes.trust || null);
    } catch (err) {
      showToast(err.message || "Failed to load schema and trust data", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddTrust = async (e) => {
    e.preventDefault();
    try {
      await discoverability.saveTrustObservation({
        signal: trustForm.signal,
        source_url: trustForm.source_url.trim() || undefined,
        excerpt: trustForm.excerpt.trim() || undefined,
        observed_count: Number(trustForm.observed_count) || 1,
        workspace_id: workspaceId,
      });
      showToast("Trust observation recorded.", "check");
      setAddingTrust(false);
      setTrustForm(EMPTY_FORM);
      loadData();
    } catch (err) {
      showToast(err.message || "Could not record trust observation", "error");
    }
  };

  if (loading) {
    return (
      <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
        <Icon name="rotate-cw" size={24} className="spin" />
        <p style={{ marginTop: "0.5rem" }}>Loading Schema & Trust Intelligence…</p>
      </div>
    );
  }

  const trustMeasured = trust && trust.score !== null && trust.score !== undefined;

  return (
    <div className="dsc-trust-surface" style={{ display: "grid", gap: "1.5rem" }}>
      <div className="dsc-header-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="award" size={20} /> Schema Intelligence & Trust Proof
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Verify that your structured JSON-LD schemas align with independent third-party evidence.
          </p>
        </div>
        <Button size="sm" onClick={() => setAddingTrust(!addingTrust)}>
          <Icon name="plus" size={14} /> {addingTrust ? "Cancel" : "Record Trust Observation"}
        </Button>
      </div>

      {/* 🔴 Fidelity Educational Alert */}
      <div className="dsc-panel" style={{ padding: "0.875rem 1.25rem", background: "rgba(59, 130, 246, 0.08)", borderLeft: "4px solid #3b82f6" }}>
        <div style={{ fontSize: "0.875rem", lineHeight: 1.5 }}>
          <strong>Understanding Schema Fidelity:</strong> Fidelity is the one score where declaring more markup without backing evidence <em>lowers</em> the score.
          Search and generative AI engines penalize sites that claim unproven entities or inflated schema definitions without checkable third-party proof.
        </div>
      </div>

      {/* Trust score — coverage beside the number, and "not measured" is never 0. */}
      <div className="dsc-panel" style={{ padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600 }}>Trust score</div>
          <div style={{ fontSize: "0.8125rem", color: "var(--text-sub)" }}>
            {trust?.unmeasured?.length
              ? `Not yet observed: ${trust.unmeasured.map((id) => TRUST_SIGNALS[id]?.label || id).join(", ")}.`
              : "Every signal for this subject kind has at least one observation."}
          </div>
        </div>
        <div style={{ textAlign: "right" }} data-testid="trust-score">
          <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>
            {trustMeasured ? trust.score.toFixed(1) : <span className="dsc-unmeasured">not measured</span>}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
            Coverage: {trust ? `${Math.round(trust.coverage)}%` : "—"}
          </div>
        </div>
      </div>

      {addingTrust && (
        <form onSubmit={handleAddTrust} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Record Verifiable Trust Observation</h3>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-sub)", margin: 0 }}>
            With a checkable source URL this is recorded as <strong>independent</strong>. Without one it is
            recorded as <strong>self-published</strong> — independence comes from evidence, not from a checkbox.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Signal Type
              <select
                className="dsc-input"
                value={trustForm.signal}
                onChange={(e) => setTrustForm({ ...trustForm, signal: e.target.value })}
              >
                {TRUST_SIGNAL_IDS.map((id) => (
                  <option key={id} value={id}>{TRUST_SIGNALS[id].label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Source URL (Checkable third-party URL)
              <input
                type="url"
                className="dsc-input"
                placeholder="https://thirdparty.com/profile"
                value={trustForm.source_url}
                onChange={(e) => setTrustForm({ ...trustForm, source_url: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Observed Count
              <input
                type="number"
                className="dsc-input"
                min="1"
                value={trustForm.observed_count}
                onChange={(e) => setTrustForm({ ...trustForm, observed_count: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Excerpt / Proof Snippet
              <input
                type="text"
                className="dsc-input"
                placeholder="Direct quotation or evidence excerpt"
                value={trustForm.excerpt}
                onChange={(e) => setTrustForm({ ...trustForm, excerpt: e.target.value })}
              />
            </label>
          </div>
          <Button size="sm" type="submit">Record Observation</Button>
        </form>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        {/* Schema Entities */}
        <div className="dsc-panel" style={{ padding: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Detected Schema Entities ({schemaEntities.length})
          </h3>
          {schemaEntities.length === 0 ? (
            <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
              No schema entities recorded. Run a page audit to extract JSON-LD schemas.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {schemaEntities.map((ent) => (
                <div key={ent.id} style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{ent.schema_type}</span>
                    <span className={`dsc-pill dsc-pill-${ent.validity || "valid"}`}>{ent.validity || "valid"}</span>
                  </div>
                  {(ent.missing_properties || []).length > 0 && (
                    <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "var(--text-sub)" }}>
                      Missing: {ent.missing_properties.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trust Observations */}
        <div className="dsc-panel" style={{ padding: "1.25rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Trust & Proof Observations ({trustObservations.length})
          </h3>
          {trustObservations.length === 0 ? (
            <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
              No trust observations recorded. Add checkable citations or review links to boost trust score.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {trustObservations.map((obs) => (
                <div key={obs.id} style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                      {TRUST_SIGNALS[obs.signal]?.label || obs.signal} · {obs.observed_count ?? 0}
                    </span>
                    <span className={`dsc-pill dsc-pill-${obs.independence}`}>
                      {INDEPENDENCE_LABELS[obs.independence] || obs.independence}
                    </span>
                  </div>
                  {obs.source_url && (
                    <div style={{ fontSize: "0.75rem", color: "var(--accent)", marginTop: "0.25rem" }}>
                      <a href={obs.source_url} target="_blank" rel="noopener noreferrer nofollow" style={{ textDecoration: "underline" }}>
                        {obs.source_url}
                      </a>
                    </div>
                  )}
                  {obs.evidence_json?.excerpt && (
                    <p style={{ fontSize: "0.8125rem", fontStyle: "italic", marginTop: "0.25rem" }}>
                      &ldquo;{obs.evidence_json.excerpt}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
