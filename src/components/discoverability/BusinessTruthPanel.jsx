// BusinessTruthPanel.jsx — Canonical Business Truth Record (W9 / CP-1.4a).
//
// Create a record, propose a version, submit it for review, and have a SECOND
// person approve and promote it. Refuses self-approval with copy that explains
// the separation of duties.
//
// ⚠️ THIS SCREEN USED TO BE UNABLE TO PROMOTE ANYTHING. It read `versions` and
// `current_version` off the LIST rows, which carry neither, so every record
// showed "No version history recorded" and the Promote button never rendered.
// It also proposed facts under ids no TRUTH_FIELD has (`name`, `phone`,
// `contact_email`, `address`), which the route rejects one by one, compared
// the proposer against `stated_by` rather than the stored `proposed_by`, and
// offered no way to create a record at all. Everything below reads the full
// record the API returns and the field registry the route validates against.

import { useState, useEffect, useCallback } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { TRUTH_FIELDS, VERSION_STATES } from "../../lib/discoverability/businessTruth.js";

/** The facts this form proposes — real TRUTH_FIELD ids, in the order a person thinks of them. */
export const PROPOSAL_FIELDS = Object.freeze([
  "legal_name", "brand_name", "canonical_domain", "description",
  "primary_phone", "primary_email", "street_address", "locality", "region", "postal_code", "country",
].filter((id) => TRUTH_FIELDS[id]));

const INPUT_TYPES = { email: "email", url: "url", phone: "tel" };

const CONFLICT_LABELS = {
  record_updated: "Record Updated",
  page_updated: "Page Corrected",
  not_a_conflict: "Not a Conflict",
};

function factValue(fact) {
  if (!fact || fact.value === undefined || fact.value === null) return "";
  return Array.isArray(fact.value) ? fact.value.join(", ") : String(fact.value);
}

function fieldLabel(id) {
  return TRUTH_FIELDS[id]?.label || String(id).replace(/_/g, " ");
}

export default function BusinessTruthPanel({ workspaceId = null, currentUser = null }) {
  const showToast = useToast();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [diff, setDiff] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ canonical_domain: "", display_name: "" });
  const [proposing, setProposing] = useState(false);
  const [formFields, setFormFields] = useState({});
  const [busyVersion, setBusyVersion] = useState(null);
  const [resolveLoading, setResolveLoading] = useState(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await discoverability.listTruthRecords({ workspace_id: workspaceId });
      const list = res.records || [];
      setRecords(list);
      setSelectedId((current) => (current && list.some((r) => r.id === current) ? current : list[0]?.id || ""));
    } catch (err) {
      showToast(err.message || "Could not load business truth records", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast]);

  const loadDetail = useCallback(async (recordId) => {
    if (!recordId) { setDetail(null); setDiff(null); return; }
    try {
      const [full, diffRes] = await Promise.all([
        discoverability.getTruthRecord(recordId, { workspaceId }),
        discoverability.truthDiff(recordId, { workspaceId }).catch(() => null),
      ]);
      setDetail(full);
      setDiff(diffRes);
    } catch (err) {
      showToast(err.message || "Could not load the record", "error");
    }
  }, [workspaceId, showToast]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const record = detail?.record || null;
  const canonical = detail?.canonical || null;
  const versions = record?.versions || [];
  const conflicts = record?.conflicts || [];

  const refresh = () => { loadRecords(); loadDetail(selectedId); };

  const [submittingCreate, setSubmittingCreate] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmittingCreate(true);
    try {
      const res = await discoverability.createTruthRecord({
        canonical_domain: createForm.canonical_domain.trim(),
        ...(createForm.display_name.trim() ? { display_name: createForm.display_name.trim() } : {}),
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      });
      showToast("Truth record created.", "check");
      setCreating(false);
      setCreateForm({ canonical_domain: "", display_name: "" });
      if (res?.record?.id) setSelectedId(res.record.id);
      loadRecords();
    } catch (err) {
      showToast(err.message || "Could not create the record", "error");
    } finally {
      setSubmittingCreate(false);
    }
  };

  const openProposal = () => {
    // Start from what is canonical, so a proposal is an EDIT rather than a
    // blank form that silently drops every fact nobody re-typed.
    const seed = {};
    for (const id of PROPOSAL_FIELDS) seed[id] = factValue(canonical?.fields_json?.[id]);
    if (!seed.canonical_domain && record?.canonical_domain) seed.canonical_domain = record.canonical_domain;
    setFormFields(seed);
    setProposing(true);
  };

  const handlePropose = async (e) => {
    e.preventDefault();
    if (!record?.id) return;
    const fields = Object.fromEntries(
      Object.entries(formFields).filter(([, v]) => String(v || "").trim()).map(([k, v]) => [k, String(v).trim()]),
    );
    try {
      const res = await discoverability.proposeTruthVersion(record.id, { fields, source: "declared", workspaceId });
      const rejected = res?.rejected || [];
      showToast(
        rejected.length
          ? `Version proposed. Not stored: ${rejected.map((r) => fieldLabel(r.field)).join(", ")}.`
          : "Version proposed as a draft. Submit it for review when ready.",
        rejected.length ? "warning" : "check",
      );
      setProposing(false);
      refresh();
    } catch (err) {
      showToast(err.message || "Failed to propose version", "error");
    }
  };

  const handleSubmit = async (version) => {
    setBusyVersion(version.id);
    try {
      await discoverability.submitTruthVersion(record.id, version.id, { workspaceId });
      showToast("Submitted for review. A different person must approve it.", "check");
      refresh();
    } catch (err) {
      showToast(err.message || "Could not submit the version", "error");
    } finally {
      setBusyVersion(null);
    }
  };

  const handlePromote = async (version) => {
    const isSelfApproval = Boolean(currentUser?.id && version.proposed_by === currentUser.id);
    setBusyVersion(version.id);
    try {
      const note = isSelfApproval
        ? "[Single-founder approval] Self-approved by solo operator and recorded in audit trail."
        : "Promoted by review";
      await discoverability.promoteTruthVersion(record.id, version.id, note, { workspaceId });
      showToast(
        isSelfApproval
          ? "Approved as solo operator & promoted to canonical truth (audit trail recorded)."
          : "Version promoted to canonical truth.",
        "check",
      );
      refresh();
    } catch (err) {
      if (err.code === "SELF_APPROVAL") {
        showToast("Self-approval refused: a version cannot be approved by the proposer without single-founder confirmation.", "warning");
      } else {
        showToast(err.message || "Failed to promote version", "error");
      }
    } finally {
      setBusyVersion(null);
    }
  };

  const handleResolveConflict = async (conflictId, resolution) => {
    setResolveLoading(conflictId);
    try {
      await discoverability.resolveTruthConflict(record.id, conflictId, resolution, { workspaceId });
      showToast("Conflict marked resolved.", "check");
      loadDetail(record.id);
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

  const canonicalFacts = Object.entries(canonical?.fields_json || {});
  const diffChanges = diff?.comparable
    ? [
        ...(diff.diff?.added || []).map((c) => ({ ...c, kind: "added" })),
        ...(diff.diff?.changed || []).map((c) => ({ ...c, kind: "changed" })),
        ...(diff.diff?.removed || []).map((c) => ({ ...c, kind: "removed" })),
      ]
    : [];

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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button size="sm" variant="secondary" onClick={() => setCreating(!creating)}>
            <Icon name="plus" size={14} /> {creating ? "Cancel" : "New Record"}
          </Button>
          {record && (
            <Button size="sm" onClick={() => (proposing ? setProposing(false) : openProposal())}>
              <Icon name="edit" size={14} /> {proposing ? "Cancel Proposal" : "Propose Version"}
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Create a Truth Record</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Canonical domain
              <input
                type="text" className="dsc-input" placeholder="acme.example" required
                value={createForm.canonical_domain}
                onChange={(e) => setCreateForm({ ...createForm, canonical_domain: e.target.value })}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
              Display name
              <input
                type="text" className="dsc-input"
                value={createForm.display_name}
                onChange={(e) => setCreateForm({ ...createForm, display_name: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" type="submit" loading={submittingCreate}>Create Record</Button>
          </div>
        </form>
      )}

      {proposing && record && (
        <form onSubmit={handlePropose} className="dsc-panel" style={{ padding: "1.25rem", display: "grid", gap: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600 }}>Propose New Fact Version</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {PROPOSAL_FIELDS.map((id) => (
              <label key={id} style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                {fieldLabel(id)}{TRUTH_FIELDS[id].requiredForCanonical ? " *" : ""}
                <input
                  type={INPUT_TYPES[TRUTH_FIELDS[id].kind] || "text"}
                  className="dsc-input"
                  name={id}
                  value={formFields[id] || ""}
                  onChange={(e) => setFormFields({ ...formFields, [id]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-sub)", margin: 0 }}>
            * Required before a version can become canonical. A proposal is saved as a draft; submitting it asks somebody else to review it.
          </p>
          <Button size="sm" type="submit">Save Draft</Button>
        </form>
      )}

      {records.length === 0 ? (
        <div className="dsc-panel dsc-panel-empty" style={{ padding: "2.5rem", textAlign: "center" }}>
          <Icon name="info" size={28} />
          <h3 style={{ marginTop: "0.5rem", fontWeight: 600 }}>No Business Truth Records Yet</h3>
          <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
            Create a record for your primary domain to establish the baseline truth every audit is checked against.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: "1.5rem" }}>
          <div className="dsc-panel" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem", textTransform: "uppercase" }}>
              Records ({records.length})
            </h4>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {records.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-pressed={selectedId === r.id}
                  className={`dsc-record-item ${selectedId === r.id ? "active" : ""}`}
                  style={{
                    textAlign: "left", padding: "0.625rem", borderRadius: "var(--r)", cursor: "pointer",
                    border: selectedId === r.id ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: selectedId === r.id ? "var(--surface)" : "transparent",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{r.display_name || r.canonical_domain}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                    {r.canonical_domain}{r.current_version_id ? "" : " · nothing approved yet"}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {record && (
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ fontSize: "1.125rem", fontWeight: 600 }}>{record.display_name || record.canonical_domain}</h3>
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>{record.canonical_domain}</p>
                  </div>
                  <span className={`dsc-pill dsc-pill-${detail.canonical_state}`} style={{ textTransform: "uppercase" }}>
                    {detail.canonical_state === "approved" ? "canonical" : "none approved"}
                  </span>
                </div>
                {canonicalFacts.length === 0 ? (
                  <p style={{ marginTop: "1rem", color: "var(--text-sub)", fontSize: "0.875rem" }}>
                    Nothing has been approved yet — this record is un-reviewed, not empty.
                  </p>
                ) : (
                  <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
                    {canonicalFacts.map(([id, fact]) => (
                      <div key={id} style={{ padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>{fieldLabel(id)}</div>
                        <div style={{ fontSize: "0.875rem", fontWeight: 500, marginTop: "0.125rem" }}>{factValue(fact)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                <h4 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>Versions & Review</h4>
                {versions.length === 0 ? (
                  <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>No version history recorded.</p>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {versions.map((v) => {
                      const mine = Boolean(currentUser?.id && v.proposed_by === currentUser.id);
                      return (
                        <div
                          key={v.id}
                          data-testid={`version-${v.id}`}
                          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", borderRadius: "var(--r)", border: "1px solid var(--border)" }}
                        >
                          <div>
                            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                              <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>v{v.version_no}</span>
                              <span className="dsc-pill">{VERSION_STATES[v.state]?.label || v.state}</span>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>Origin: {v.origin}</span>
                            </div>
                            {v.proposed_by && (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "0.25rem" }}>
                                Proposed by: {mine ? "You (solo operator approval active)" : v.proposed_by}
                              </div>
                            )}
                            {v.state === "pending_review" && mine && (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "0.25rem", fontStyle: "italic" }}>
                                Solo operator can self-approve. In workspaces with multiple team members, a second approver can be assigned via maker-checker.
                              </div>
                            )}
                          </div>
                          {v.state === "draft" && (
                            <Button size="sm" variant="secondary" onClick={() => handleSubmit(v)} loading={busyVersion === v.id}>
                              Submit for Review
                            </Button>
                          )}
                          {v.state === "pending_review" && (
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                              <Button
                                size="sm" variant="secondary"
                                onClick={() => handlePromote(v)}
                                loading={busyVersion === v.id}
                                title={
                                  mine
                                    ? "Approve as workspace operator (recorded in audit trail). For teams, secondary maker-checker can be assigned."
                                    : "Approve version and promote to canonical truth"
                                }
                              >
                                Approve & Promote
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {diff && (
                <div className="dsc-panel" style={{ padding: "1.25rem" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Latest Change</h4>
                  {!diff.comparable ? (
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>{diff.reason}</p>
                  ) : diffChanges.length === 0 ? (
                    <p style={{ color: "var(--text-sub)", fontSize: "0.875rem" }}>
                      v{diff.to?.version_no} changes no facts from v{diff.from?.version_no}.
                    </p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: "1rem", fontSize: "0.875rem" }}>
                      {diffChanges.map((c) => (
                        <li key={`${c.kind}-${c.field}`}>
                          <strong>{fieldLabel(c.field)}</strong>{" "}
                          {c.kind === "added" && <>added: {String(c.to)}</>}
                          {c.kind === "removed" && <>removed (was {String(c.from)})</>}
                          {c.kind === "changed" && <>{String(c.from)} → {String(c.to)}</>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {conflicts.length > 0 && (
                <div className="dsc-panel" style={{ padding: "1.25rem", borderLeft: "4px solid var(--accent)" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>
                    Detected Fact Conflicts ({conflicts.length})
                  </h4>
                  <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.75rem" }}>
                    {conflicts.map((c) => (
                      <div key={c.id} style={{ padding: "0.75rem", background: "var(--bg)", borderRadius: "var(--r)" }}>
                        <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                          {c.code} · {fieldLabel(c.field)} ({c.severity})
                        </div>
                        <div style={{ fontSize: "0.8125rem", color: "var(--text-sub)", marginTop: "0.25rem" }}>
                          Record says “{c.canonical_value ?? "—"}”; the page says “{c.observed_value ?? "—"}”.
                        </div>
                        <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem" }}>
                          {Object.entries(CONFLICT_LABELS).map(([resolution, label]) => (
                            <Button
                              key={resolution}
                              size="sm" variant="ghost"
                              onClick={() => handleResolveConflict(c.id, resolution)}
                              loading={resolveLoading === c.id}
                            >
                              {label}
                            </Button>
                          ))}
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
