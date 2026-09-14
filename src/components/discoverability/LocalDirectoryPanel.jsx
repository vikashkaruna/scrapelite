// LocalDirectoryPanel.jsx — Local & Directory Intelligence (W12 / CP-1.4c).
// Displays NAP consistency, directory matches, correction packs, and local checks.
// 🔴 Rule: Render coverageClaim() verbatim. Unchecked sources are excluded and named, never scored 0.
//
// ⚠️ READ THE STORED SHAPE, NOT AN IMAGINED ONE. This panel read a match
// "state", a finding "code"/"description"/"suggested value" under names 0058
// never stored, and resolved findings with a value the route rejects.
// `runLocalCheck` also returns `score` as an OBJECT from napScore(), so the
// completion toast printed "NaN%".

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { coverageClaim } from "../../lib/discoverability/directorySources.js";

/** 0058 stores a score and the mismatched field list, never a state label. */
export function matchState(match) {
  if (!match) return "unchecked";
  if (match.match_score === null || match.match_score === undefined) return "unreadable";
  return (match.mismatched || []).length > 0 ? "mismatch" : "match";
}

const MATCH_LABELS = {
  match: "Matches the record",
  mismatch: "Mismatch",
  unreadable: "Listing unreadable",
};

export default function LocalDirectoryPanel({ workspaceId = null }) {
  const showToast = useToast();
  const [schema, setSchema] = useState(null);
  const [truthRecords, setTruthRecords] = useState([]);
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [listings, setListings] = useState([]);
  const [checks, setChecks] = useState([]);
  const [selectedCheck, setSelectedCheck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [region, setRegion] = useState("in");

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [schemaRes, trRes] = await Promise.all([
        discoverability.localDirectorySchema().catch(() => null),
        discoverability.listTruthRecords({ workspace_id: workspaceId }).catch(() => ({ records: [] })),
      ]);
      setSchema(schemaRes);
      const records = trRes.records || [];
      setTruthRecords(records);
      if (records.length > 0) {
        setSelectedRecordId(records[0].id);
      }
    } catch (err) {
      showToast(err.message || "Failed to load directory metadata", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadRecordDetails = useCallback(async (trId) => {
    if (!trId) return;
    try {
      const [listingsRes, checksRes] = await Promise.all([
        discoverability.listDirectoryListings({ truth_record_id: trId, workspace_id: workspaceId }),
        discoverability.listLocalChecks({ truth_record_id: trId, workspace_id: workspaceId }),
      ]);
      setListings(listingsRes.listings || []);
      const chks = checksRes.checks || [];
      setChecks(chks);
      if (chks.length > 0) {
        const full = await discoverability.getLocalCheck(chks[0].id, { workspace_id: workspaceId });
        setSelectedCheck(full);
      } else {
        setSelectedCheck(null);
      }
    } catch {
      // Best-effort
    }
  }, [workspaceId]);

  useEffect(() => {
    if (selectedRecordId) {
      loadRecordDetails(selectedRecordId);
    }
  }, [selectedRecordId, loadRecordDetails]);

  const handleRunCheck = async () => {
    if (!selectedRecordId) {
      showToast("Please select a business truth record to audit.", "warning");
      return;
    }
    setChecking(true);
    try {
      const res = await discoverability.runLocalCheck({
        truth_record_id: selectedRecordId,
        region,
        workspace_id: workspaceId,
      });
      const napScore = res?.score?.score;
      showToast(
        Number.isFinite(napScore)
          ? `Local NAP check complete (score ${Math.round(napScore)}/100).`
          : "Local NAP check complete — no listing was comparable, so there is no score yet.",
        "check",
      );
      loadRecordDetails(selectedRecordId);
    } catch (err) {
      showToast(err.message || "Directory check failed", "error");
    } finally {
      setChecking(false);
    }
  };

  const handleResolveFinding = async (findingId, resolution) => {
    try {
      await discoverability.resolveLocalFinding(findingId, resolution, { workspace_id: workspaceId });
      showToast("Finding marked resolved.", "check");
      if (selectedCheck?.check?.id) {
        const full = await discoverability.getLocalCheck(selectedCheck.check.id, { workspace_id: workspaceId });
        setSelectedCheck(full);
      }
    } catch (err) {
      showToast(err.message || "Failed to resolve finding", "error");
    }
  };

  if (loading) {
    return (
      <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
        <Icon name="rotate-cw" size={24} className="spin" />
        <p style={{ marginTop: "0.5rem" }}>Loading Local & Directory Intelligence…</p>
      </div>
    );
  }

  // 🔴 Render coverageClaim() verbatim.
  const checkedCount = selectedCheck?.check?.checked_count ?? listings.length;
  const coverageSentence = coverageClaim({ checked: checkedCount, region });

  return (
    <div className="dsc-local-surface" style={{ display: "grid", gap: "1.5rem" }}>
      <div className="dsc-header-box" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Icon name="map-pin" size={20} /> Local & Directory Intelligence
          </h2>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Audit Name, Address, and Phone (NAP) consistency across directories, official registries, and maps.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <select
            className="dsc-input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="in">India (IN)</option>
            <option value="us">United States (US)</option>
            <option value="uk">United Kingdom (UK)</option>
          </select>
          <Button size="sm" onClick={handleRunCheck} loading={checking}>
            <Icon name="scan" size={14} /> Run NAP Check
          </Button>
        </div>
      </div>

      {/* Coverage Banner — rendered verbatim */}
      <div className="dsc-panel" style={{ padding: "0.875rem 1.25rem", background: "var(--surface)", borderLeft: "4px solid var(--accent)" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>
          <Icon name="info" size={16} style={{ marginRight: "0.375rem", verticalAlign: "middle" }} />
          {coverageSentence}
        </div>
      </div>

      {truthRecords.length === 0 ? (
        <div className="dsc-panel dsc-panel-empty" style={{ padding: "2rem", textAlign: "center" }}>
          <Icon name="alert-circle" size={24} />
          <h3 style={{ marginTop: "0.5rem", fontWeight: 600 }}>Truth Record Required</h3>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
            Local directory audits require an approved business truth record to compare listings against.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          {/* Matches & Listings */}
          <div className="dsc-panel" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Directory Sources ({schema?.sources?.length || 0} Configured)
            </h3>
            <div style={{ display: "grid", gap: "0.625rem" }}>
              {(schema?.sources || []).map((src) => {
                const match = selectedCheck?.matches?.find((m) => m.source_id === src.id);
                return (
                  <div
                    key={src.id}
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
                      <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{src.label}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                        Tier: {src.tier} • Acquisition: {src.acquisition}
                      </div>
                    </div>
                    {match ? (
                      <span className={`dsc-pill dsc-pill-${matchState(match)}`}>
                        {MATCH_LABELS[matchState(match)]}
                      </span>
                    ) : (
                      <span style={{ fontSize: "0.75rem", color: "var(--text-sub)", fontStyle: "italic" }}>
                        Unchecked (excluded)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Findings & Correction Packs */}
          <div className="dsc-panel" style={{ padding: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Local Findings & Mismatches ({(selectedCheck?.findings || []).length})
            </h3>
            {(selectedCheck?.findings || []).length === 0 ? (
              <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
                No active mismatches detected. Run a NAP check to audit directory listings.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {selectedCheck.findings.map((f) => (
                  <div
                    key={f.id}
                    style={{
                      padding: "0.75rem",
                      background: "var(--bg)",
                      borderRadius: "var(--r)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{f.code}</span>
                      <span className={`dsc-pill dsc-pill-${f.severity}`}>{f.severity}</span>
                    </div>
                    {f.detail && (
                      <p style={{ fontSize: "0.8125rem", marginTop: "0.25rem", color: "var(--text-sub)" }}>
                        {f.detail}
                      </p>
                    )}
                    {(f.fields || []).length > 0 && (
                      <div style={{ fontSize: "0.75rem", marginTop: "0.375rem" }}>
                        Fields: {f.fields.join(", ")}
                      </div>
                    )}
                    {f.resolved_at ? (
                      <div style={{ fontSize: "0.75rem", marginTop: "0.5rem", color: "var(--text-sub)" }}>
                        Resolved ({String(f.resolution || "").replace(/_/g, " ")})
                      </div>
                    ) : (
                      <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                        <Button size="sm" variant="ghost" onClick={() => handleResolveFinding(f.id, "listing_updated")}>
                          Listing Updated
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleResolveFinding(f.id, "not_a_conflict")}>
                          Not a Conflict
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
