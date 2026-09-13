// SchemaTrustPanel.jsx — Schema Intelligence & Trust and Proof (W13 / CP-1.4d).
// Displays structured schema entities, verified trust signals, and Trust Score.
// 🔴 Rule: Explain why more markup without evidence lowers fidelity.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";

const TRUST_SIGNALS = [
  { id: "authorship", label: "Named Authorship & Credentials" },
  { id: "citation", label: "Third-party Citations & Mentions" },
  { id: "review", label: "Verified Reviews & Testimonials" },
  { id: "award", label: "Industry Awards & Recognitions" },
  { id: "patent", label: "Patents & Intellectual Property" },
  { id: "case_study", label: "Verifiable Customer Case Studies" },
];

export default function SchemaTrustPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [schemaEntities, setSchemaEntities] = useState([]);
  const [trustObservations, setTrustObservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingTrust, setAddingTrust] = useState(false);

  const [trustForm, setTrustForm] = useState({
    signal: "authorship",
    source_url: "",
    observed_count: 1,
    excerpt: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [schemaRes, trustRes] = await Promise.all([
        discoverability.listSchemaEntities({ workspace_id: workspaceId }).catch(() => ({ entities: [] })),
        discoverability.listTrustObservations({ workspace_id: workspaceId }).catch(() => ({ observations: [] })),
      ]);
      setSchemaEntities(schemaRes.entities || []);
      setTrustObservations(trustRes.observations || []);
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
        ...trustForm,
        workspace_id: workspaceId,
        observed_count: Number(trustForm.observed_count) || 1,
      });
      showToast("Trust observation recorded.", "check");
      setAddingTrust(false);
      setTrustForm({ signal: "authorship", source_url: "", observed_count: 1, excerpt: "" });
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

      {addingTrust && (
        <form onSubmit={handleAddTrust} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Record Verifiable Trust Observation</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Signal Type
              <select
                className="dsc-input"
                value={trustForm.signal}
                onChange={(e) => setTrustForm({ ...trustForm, signal: e.target.value })}
              >
                {TRUST_SIGNALS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
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
              No custom schema entities recorded. Run a page audit to extract JSON-LD schemas.
            </p>
          ) : (
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {schemaEntities.map((ent) => (
                <div
                  key={ent.id}
                  style={{
                    padding: "0.75rem",
                    background: "var(--bg)",
                    borderRadius: "var(--r)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{ent.schema_type}</div>
                  <pre style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "var(--text-sub)" }}>
                    {JSON.stringify(ent.properties || {}, null, 2)}
                  </pre>
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
                <div
                  key={obs.id}
                  style={{
                    padding: "0.75rem",
                    background: "var(--bg)",
                    borderRadius: "var(--r)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.875rem", textTransform: "capitalize" }}>
                      {obs.signal?.replace(/_/g, " ")}
                    </span>
                    <span className={`dsc-pill dsc-pill-${obs.independence}`}>
                      {obs.independence}
                    </span>
                  </div>
                  {obs.source_url && (
                    <div style={{ fontSize: "0.75rem", color: "var(--accent)", marginTop: "0.25rem" }}>
                      <a href={obs.source_url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                        {obs.source_url}
                      </a>
                    </div>
                  )}
                  {obs.excerpt && (
                    <p style={{ fontSize: "0.8125rem", fontStyle: "italic", marginTop: "0.25rem" }}>
                      &ldquo;{obs.excerpt}&rdquo;
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
