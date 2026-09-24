// src/pages/Lists.jsx — Bulk Account Intelligence (PRD 3).
//
// Allows users to import lists of target company domains (via CSV or paste),
// deduplicate, run durable chunked enrichment, score against customizable ICP rules,
// review low-confidence extractions, and export qualified account tables.

import { useState, useEffect, useMemo } from "react";
import TemplateBacklink from "../components/TemplateBacklink.jsx";
import { useLocation, useNavigate, Link } from "react-router";
import Icon from "../components/Icon.jsx";
import DomainListInput from "../components/DomainListInput.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import SignedInRequired from "../components/SignedInRequired.jsx";
import { dedupeEntries } from "../lib/bulk/identityModel.js";
import { evaluateIcp, DEFAULT_THRESHOLD, sampleProfile, deadCriteria, ENRICHABLE_FIELD_NAMES } from "../lib/bulk/icpModel.js";
import * as bulkApi from "../lib/bulk/bulkClient.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";

export default function Lists() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const { user, authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState("lists"); // "lists" | "rules" | "review"
  const [selectedListId, setSelectedListId] = useState(null);
  const cachedLists = readPageCache("accountLists")?.data || [];
  const [lists, setLists] = useState(cachedLists);
  const [currentList, setCurrentList] = useState(null);
  const [loading, setLoading] = useState(cachedLists.length === 0);
  const [runningJob, setRunningJob] = useState(false);
  const [jobProgress, setJobProgress] = useState(null);

  // New list dialog
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [listName, setListName] = useState("");
  const [rawDomains, setRawDomains] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("sales");

  // Edit List Modal
  const [editingList, setEditingList] = useState(null);
  const [editListName, setEditListName] = useState("");
  const [editListDesc, setEditListDesc] = useState("");

  // Delete List Modal
  const [deletingList, setDeletingList] = useState(null);

  // Curate Account Record Modal
  const [curatingRecord, setCuratingRecord] = useState(null);
  const [curateCompanyName, setCurateCompanyName] = useState("");
  const [curateIndustry, setCurateIndustry] = useState("");
  const [curateEmployees, setCurateEmployees] = useState("");
  const [curateIcpScore, setCurateIcpScore] = useState("");
  const [curateNotes, setCurateNotes] = useState("");
  const [curateSaving, setCurateSaving] = useState(false);

  // ICP Rules
  const [rules, setRules] = useState(null);
  const [sampleDomain, setSampleDomain] = useState("stripe.com");
  const [samplePreview, setSamplePreview] = useState(null);

  // Review Queue
  const [reviewItems, setReviewItems] = useState([]);

  // Check if routed from template handoff or query parameters (?new=1 or ?list=<id>)
  useEffect(() => {
    if (location.state?.initialDomains) {
      const d = location.state.initialDomains;
      setRawDomains(Array.isArray(d) ? d.join("\n") : String(d));
      setShowCreateModal(true);
    }
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
      setShowCreateModal(true);
    }
    const listId = params.get("list");
    if (listId) {
      setSelectedListId(listId);
    }
  }, [location.state, location.search]);

  const loadLists = async (silent = false) => {
    if (!silent && lists.length === 0) setLoading(true);
    try {
      const res = await bulkApi.listLists();
      const fresh = res.lists || [];
      setLists(fresh);
      writePageCache("accountLists", fresh);
    } catch (e) {
      if (lists.length === 0) showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentList = async (id) => {
    try {
      const res = await bulkApi.getList(id);
      setCurrentList(res.list || res);
    } catch (e) {
      showToast(e.message);
    }
  };

  const loadRules = async () => {
    try {
      const res = await bulkApi.getIcpRules(selectedPersona);
      setRules(res.rules);
    } catch (e) {
      showToast(e.message);
    }
  };

  const loadReview = async () => {
    try {
      const res = await bulkApi.getReviewQueue(selectedListId);
      setReviewItems(res.items || []);
    } catch (e) {
      showToast(e.message);
    }
  };

  useEffect(() => {
    loadLists();
    loadRules();
    loadReview();
  }, []);

  useEffect(() => {
    if (selectedListId) {
      loadCurrentList(selectedListId);
    } else {
      setCurrentList(null);
    }
  }, [selectedListId]);

  // Real-time deduplication summary for create modal
  const dedupedPreview = useMemo(() => {
    if (!rawDomains.trim()) return { count: 0, items: [] };
    const items = dedupeEntries(rawDomains);
    return { count: items.length, items };
  }, [rawDomains]);

  const handleCreateList = async (e) => {
    e.preventDefault();
    if (!listName.trim()) {
      showToast("Please provide a name for this list.");
      return;
    }
    if (dedupedPreview.count === 0) {
      showToast("Please enter at least one valid company domain.");
      return;
    }

    try {
      const res = await bulkApi.createList({
        name: listName,
        domains: dedupedPreview.items.map((i) => i.canonical),
        persona: selectedPersona,
      });

      showToast(`Created list with ${res.total} accounts.`);
      setShowCreateModal(false);
      setListName("");
      setRawDomains("");
      loadLists();
      setSelectedListId(res.list.id);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleRunEnrichment = async () => {
    if (!currentList) return;
    setRunningJob(true);
    setJobProgress({ processed: 0, remaining: currentList.total_records });

    window.dispatchEvent(new CustomEvent("datiq:listenrichment", {
      detail: {
        status: "running",
        listName: currentList.name,
        processed: 0,
        total: currentList.total_records || 1,
      },
    }));

    try {
      let jobId = currentList.active_job_id;
      if (!jobId) {
        // Safe fallback: start / queue an enrichment job for this list
        const startRes = await bulkApi.startJob(currentList.id);
        jobId = startRes?.jobId;
        if (!jobId) {
          throw new Error(startRes?.reason || "Could not start enrichment job.");
        }
      }
      await bulkApi.runFullJob(jobId, (p) => {
        setJobProgress(p);
        window.dispatchEvent(new CustomEvent("datiq:listenrichment", {
          detail: {
            status: "running",
            listName: currentList.name,
            processed: p?.processed || 0,
            total: currentList.total_records || 1,
          },
        }));
      });
      showToast("Enrichment run complete!");
      window.dispatchEvent(new CustomEvent("datiq:listenrichment", {
        detail: {
          status: "done",
          listName: currentList.name,
          processed: currentList.total_records || 1,
          total: currentList.total_records || 1,
        },
      }));
      loadCurrentList(currentList.id);
      loadLists();
      loadReview();
    } catch (err) {
      showToast(err.message);
      window.dispatchEvent(new CustomEvent("datiq:listenrichment", {
        detail: {
          status: "error",
          listName: currentList.name,
          error: err.message,
        },
      }));
    } finally {
      setRunningJob(false);
      setJobProgress(null);
    }
  };

  const handleResolveReview = async (reviewId, action, val = null) => {
    try {
      await bulkApi.resolveReviewItem({ reviewId, action, resolvedValue: val });
      showToast(`Review item ${action}ed.`);
      loadReview();
      if (selectedListId) loadCurrentList(selectedListId);
    } catch (e) {
      showToast(e.message);
    }
  };

  const openEditListModal = (e, l) => {
    e.stopPropagation();
    setEditingList(l);
    setEditListName(l.name || "");
    setEditListDesc(l.description || "");
  };

  const handleSaveListEdit = async (e) => {
    e.preventDefault();
    if (!editingList) return;
    try {
      await bulkApi.updateList({
        listId: editingList.id,
        name: editListName.trim(),
        description: editListDesc.trim(),
      });
      showToast("Account list updated.");
      setEditingList(null);
      loadLists(true);
      if (currentList && currentList.id === editingList.id) {
        loadCurrentList(editingList.id);
      }
    } catch (err) {
      showToast(err.message || "Failed to update list");
    }
  };

  const openDeleteListModal = (e, l) => {
    e.stopPropagation();
    setDeletingList(l);
  };

  const handleConfirmDeleteList = async () => {
    if (!deletingList) return;
    const listId = deletingList.id;
    try {
      await bulkApi.deleteList(listId);
      showToast("List deleted. Historical audit trails preserved.");
      setDeletingList(null);
      if (selectedListId === listId) {
        setSelectedListId(null);
        setCurrentList(null);
      }
      loadLists(true);
    } catch (err) {
      showToast(err.message || "Failed to delete list");
    }
  };

  const openCurateModal = (r) => {
    setCuratingRecord(r);
    const enc = r.enriched_data || {};
    setCurateCompanyName(enc.company_name || "");
    setCurateIndustry(enc.industry || "");
    setCurateEmployees(enc.employee_count || "");
    setCurateIcpScore(r.icp_score != null ? String(r.icp_score) : "");
    setCurateNotes(r.curation_notes || "");
  };

  const handleSaveCuration = async (e) => {
    e.preventDefault();
    if (!curatingRecord) return;
    setCurateSaving(true);
    try {
      const updates = {
        enriched_data: {
          company_name: curateCompanyName.trim(),
          industry: curateIndustry.trim(),
          employee_count: curateEmployees ? Number(curateEmployees) || curateEmployees : null,
        },
        icp_score: curateIcpScore ? Math.min(100, Math.max(0, Number(curateIcpScore))) : null,
        curation_notes: curateNotes.trim(),
      };
      await bulkApi.updateAccountRecord({
        recordId: curatingRecord.id,
        updates,
      });
      showToast("Account record curated and saved to database.");
      setCuratingRecord(null);
      if (selectedListId) loadCurrentList(selectedListId);
    } catch (err) {
      showToast(err.message || "Failed to save curation");
    } finally {
      setCurateSaving(false);
    }
  };

  const handleDeleteRecord = async (recordId) => {
    if (!window.confirm("Remove this account from the list?")) return;
    try {
      await bulkApi.deleteAccountRecord(recordId);
      showToast("Account removed from list.");
      if (selectedListId) loadCurrentList(selectedListId);
      loadLists(true);
    } catch (err) {
      showToast(err.message || "Failed to remove account");
    }
  };

  const handleTestSample = () => {
    if (!rules) return;
    // Built from the enricher's real vocabulary, never hand-written here. The
    // previous literal named `employee_count` and `hq_country` — fields the
    // enricher stopped producing (and `has_contact`, which it never did) — so
    // the simulator reported "Field 'has_contact' was not found in extracted
    // data" for criteria that are dead in production too.
    const sampleFields = sampleProfile();
    const evalRes = evaluateIcp(sampleFields, rules.criteria, rules.threshold);
    setSamplePreview(evalRes);
  };

  if (authLoading) {
    return (
      <div className="container" style={{ padding: "40px 20px", opacity: 0.6 }}>
        <div style={{ height: 28, width: 220, background: "var(--surface-2)", borderRadius: 6, marginBottom: 12 }} />
        <div style={{ height: 16, width: 360, background: "var(--surface-2)", borderRadius: 6, marginBottom: 24 }} />
        <div style={{ height: 240, background: "var(--surface-2)", borderRadius: 8 }} />
      </div>
    );
  }

  // These endpoints are signed-in only: they return 401 rather than another
  // tenant's rows. Render the reason, not the client SDK's thrown error.
  if (!user) {
    return <SignedInRequired title="Bulk account intelligence" reason="Import a list of company domains and get them enriched, scored against your ICP, and routed onward. Lists, enrichment history and review decisions persist to your account, so an account is what makes the work worth doing twice." />;
  }

  return (
    <div className="container" style={{ padding: "40px 20px" }}>
      <TemplateBacklink />
      <header className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>Account Intelligence Lists</h1>
            <p style={{ color: "var(--text-2)", marginTop: 6, fontSize: "0.95rem" }}>
              Bulk enrich accounts, evaluate ICP qualification with §1.6 coverage scoring, and verify facts.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              <Icon name="plus" size={16} /> New Account List
            </Button>
          </div>
        </div>

        <div className="dash-tabs" style={{ marginTop: 20 }}>
          <button
            className={`dash-tab ${activeTab === "lists" ? "active" : ""}`}
            onClick={() => { setActiveTab("lists"); setSelectedListId(null); }}
          >
            Lists ({lists.length})
          </button>
          <button
            className={`dash-tab ${activeTab === "rules" ? "active" : ""}`}
            onClick={() => setActiveTab("rules")}
          >
            ICP Scoring Rules
          </button>
          <button
            className={`dash-tab ${activeTab === "review" ? "active" : ""}`}
            onClick={() => setActiveTab("review")}
          >
            Review Queue {reviewItems.length > 0 && `(${reviewItems.length})`}
          </button>
        </div>
      </header>

      {/* ── TAB 1: LISTS VIEW ────────────────────────────────────────────── */}
      {activeTab === "lists" && (
        <>
          {selectedListId && currentList ? (
            <div className="card" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSelectedListId(null)}
                    style={{ marginBottom: 8 }}
                  >
                    ← Back to all lists
                  </button>
                  <h2 style={{ margin: 0, fontSize: "1.4rem" }}>{currentList.name}</h2>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-2)" }}>
                    {currentList.total_records} accounts · Created {new Date(currentList.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Button
                    variant="primary"
                    onClick={handleRunEnrichment}
                    disabled={runningJob}
                  >
                    <Icon name="play" size={14} />
                    {runningJob ? `Enriching (${jobProgress?.processed || 0}/${currentList.total_records})…` : "Run Enrichment"}
                  </Button>
                </div>
              </div>

              {/* ── WHAT JOBS EXIST, AND WHERE THEY ARE ──────────────────────
                  The Run Enrichment button used to be the only thing on this
                  screen that knew jobs existed, and it referred to one by an id
                  the user had never seen. Listing them makes the button's
                  behaviour predictable: you can see whether there is work left
                  before you click, and a completed list explains itself instead
                  of looking broken. */}
              {(currentList.jobs || []).length ? (
                <div className="tpl-block" style={{ marginBottom: 14 }}>
                  <h3 style={{ fontSize: "0.95rem", margin: "0 0 8px" }}>Enrichment jobs</h3>
                  <ul className="tpl-looked-for" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                    {currentList.jobs.map((j) => (
                      <li key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span>
                          <strong>{j.status}</strong>
                          {j.id === currentList.active_job_id ? " · next to run" : ""}
                        </span>
                        <span style={{ color: "var(--text-2)" }}>
                          {(j.processed_items ?? 0)}/{j.total_items ?? 0} accounts
                          {j.created_at ? ` · created ${new Date(j.created_at).toLocaleDateString()}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Accounts Table */}
              <div style={{ overflowX: "auto" }}>
                <table className="dash-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "10px 12px" }}>Domain</th>
                      <th style={{ padding: "10px 12px" }}>Company</th>
                      <th style={{ padding: "10px 12px" }}>Industry</th>
                      <th style={{ padding: "10px 12px" }}>Employees</th>
                      <th style={{ padding: "10px 12px" }}>ICP Score</th>
                      <th style={{ padding: "10px 12px" }}>Status</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(currentList.records || []).map((r) => {
                      const enc = r.enriched_data || {};
                      const score = r.icp_score;
                      return (
                        <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "12px", fontWeight: 600 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <a href={`https://${r.canonical_domain}`} target="_blank" rel="noreferrer">
                                {r.canonical_domain}
                              </a>
                              {r.curated && (
                                <span className="wrh-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)", fontSize: "10px", fontWeight: 600, padding: "2px 6px" }}>
                                  Curated
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "12px" }}>{enc.company_name || "—"}</td>
                          <td style={{ padding: "12px" }}>{enc.industry || "—"}</td>
                          <td style={{ padding: "12px" }}>{enc.employee_count ? `${enc.employee_count}+` : "—"}</td>
                          <td style={{ padding: "12px" }}>
                            {score != null ? (
                              <span
                                className="wrh-pill"
                                style={{
                                  background: score >= 60 ? "rgba(5,150,105,0.15)" : "rgba(217,119,6,0.15)",
                                  color: score >= 60 ? "#059669" : "#b45309",
                                }}
                              >
                                {score}% Fit
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-3)" }}>Unscored</span>
                            )}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span className={`wrh-pill wrh-pill-${r.status}`}>
                              {r.status}
                            </span>
                          </td>
                          <td style={{ padding: "12px", textAlign: "right" }}>
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => openCurateModal(r)}
                                style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: 4 }}
                                title="Manually curate or override account details"
                              >
                                <Icon name="edit" size={11} /> Curate
                              </button>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => handleDeleteRecord(r.id)}
                                style={{ padding: "3px 6px", color: "var(--danger, #dc2626)" }}
                                title="Remove account"
                              >
                                <Icon name="trash-2" size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 24 }}>
              {lists.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px" }}>
                  <Icon name="file-text" size={36} style={{ color: "var(--text-3)", marginBottom: 12 }} />
                  <h3>No account lists yet</h3>
                  <p style={{ color: "var(--text-2)", marginBottom: 16 }}>
                    Create your first list by pasting domains or uploading a CSV.
                  </p>
                  <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                    <Icon name="plus" size={14} /> Create Account List
                  </Button>
                </div>
              ) : (
                <div className="lists-grid" style={{ display: "grid", gap: 14 }}>
                  {lists.map((l) => {
                    const hasActiveJob = l.active_job && l.active_job.status !== "completed";
                    const processed = l.active_job?.processed_items ?? l.completed_records ?? 0;
                    const total = l.active_job?.total_items ?? l.total_records ?? 0;
                    const remaining = Math.max(0, total - processed);
                    const estMinutes = Math.max(1, Math.ceil((remaining * 4) / 60));

                    return (
                      <div
                        key={l.id}
                        className="wrh-row wrh-row-interactive"
                        style={{ padding: 16, border: "1px solid var(--border)", borderRadius: "var(--r, 10px)", display: "flex", flexDirection: "column", gap: 8 }}
                        onClick={() => setSelectedListId(l.id)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <h3 style={{ margin: "0 0 2px 0", fontSize: "1.1rem" }}>{l.name}</h3>
                              <Link to="/workflows" onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none" }}>
                                <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--accent)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", gap: 4, fontSize: "11px" }}>
                                  <Icon name="git-merge" size={11} /> Referenced in Workflows
                                </span>
                              </Link>
                            </div>
                            {l.description && (
                              <p style={{ margin: "2px 0 4px", fontSize: "12px", color: "var(--text-2)" }}>{l.description}</p>
                            )}
                            <span style={{ fontSize: "0.84rem", color: "var(--text-2)" }}>
                              {l.total_records} accounts · {l.completed_records} enriched · {l.needs_review_records} in review
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className={`wrh-pill wrh-pill-${l.status}`}>{l.status}</span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(e) => openEditListModal(e, l)}
                              style={{ padding: "4px 8px", fontSize: "12px" }}
                              title="Edit list"
                            >
                              <Icon name="edit" size={12} /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => openDeleteListModal(e, l)}
                              style={{ padding: "4px 8px", color: "var(--danger, #dc2626)" }}
                              title="Delete list"
                            >
                              <Icon name="trash-2" size={13} />
                            </Button>
                          </div>
                        </div>

                        {/* Active background enrichment indicator */}
                        {hasActiveJob && (
                          <div style={{
                            background: "var(--accent-soft, #eef2ff)",
                            border: "1px solid var(--accent, #4f46e5)",
                            borderRadius: "var(--r, 8px)",
                            padding: "6px 12px",
                            fontSize: "12px",
                            color: "var(--accent)",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}>
                            <Icon name="rotate-cw" size={13} />
                            <span>
                              <strong>Enriching in background:</strong> {processed}/{total} accounts processed · Started at {new Date(l.active_job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Est. completion in ~{estMinutes} min
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: ICP RULES ────────────────────────────────────────────── */}
      {activeTab === "rules" && rules && (
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>ICP Qualification Rules: {rules.name}</h2>
          <p style={{ color: "var(--text-2)" }}>
            Scored with the §1.6 Coverage Rule: unmeasured fields are excluded from the denominator and
            redistributed, never penalized as 0.
          </p>

          <div style={{ marginTop: 20 }}>
            <h3>Criteria Weights</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {(rules.criteria || []).map((c, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "var(--surface-2)",
                    borderRadius: 6,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <strong>{c.field}</strong> {c.operator} <em>{JSON.stringify(c.value || true)}</em>
                  </div>
                  <div>
                    <span className="wrh-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      Weight: {c.weight}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 24, padding: 16, background: "var(--surface-2)", borderRadius: 8 }}>
            <h4>Interactive Rule Simulator</h4>
            <p style={{ fontSize: "0.85rem", color: "var(--text-2)" }}>
              Test how this criteria set evaluates against a sample profile:
            </p>
            <Button variant="secondary" onClick={handleTestSample}>
              Simulate Evaluation
            </Button>

            {samplePreview && (
              <div style={{ marginTop: 14 }}>
                {/* A criterion naming a field the enricher cannot produce is
                    dead in PRODUCTION too, not just in this sandbox. Saying
                    only "not found in extracted data" implies some other
                    account might supply it, which is never true here — so name
                    it, and say what it costs. */}
                {deadCriteria(rules.criteria).length > 0 && (
                  <p style={{
                    marginBottom: 12, padding: "10px 12px", borderRadius: 6,
                    background: "var(--warning-soft, #fef3c7)",
                    color: "var(--text, #92400e)", fontSize: "0.85rem",
                  }}>
                    <strong>These criteria can never be measured.</strong>{" "}
                    {deadCriteria(rules.criteria).map((d) => d.field).join(", ")}{" "}
                    — the enricher does not produce{" "}
                    {deadCriteria(rules.criteria).length === 1 ? "this field" : "these fields"}, so{" "}
                    {deadCriteria(rules.criteria).reduce((n, d) => n + d.weight, 0)} weight is
                    redistributed on every real account, not just this sample.
                    Available fields: {ENRICHABLE_FIELD_NAMES.join(", ")}.
                  </p>
                )}
                <p>
                  <strong>Score:</strong> {samplePreview.score}% ({samplePreview.passed ? "QUALIFIED" : "DISQUALIFIED"})
                </p>
                <p>
                  <strong>Coverage:</strong> {(samplePreview.coverage * 100).toFixed(0)}% measurable signals
                </p>
                <ul>
                  {samplePreview.reasons.map((r, i) => (
                    <li key={i} style={{ color: r.passed ? "#059669" : "#b45309" }}>
                      {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: REVIEW QUEUE ─────────────────────────────────────────── */}
      {activeTab === "review" && (
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0 }}>Review Queue ({reviewItems.length})</h2>
          <p style={{ color: "var(--text-2)" }}>
            Low-confidence extractions flagged for human confirmation before CRM sync.
          </p>

          {reviewItems.length === 0 ? (
            <p style={{ color: "var(--text-3)", padding: "20px 0" }}>
              ✓ All records have high confidence. No items currently require review.
            </p>
          ) : (
            <table className="dash-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "10px" }}>Field</th>
                  <th style={{ padding: "10px" }}>Extracted Candidate</th>
                  <th style={{ padding: "10px" }}>Confidence</th>
                  <th style={{ padding: "10px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviewItems.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px", fontWeight: 600 }}>{item.field_name}</td>
                    <td style={{ padding: "10px" }}>{item.candidate_value}</td>
                    <td style={{ padding: "10px" }}>
                      <span className="wrh-pill wrh-pill-partial">
                        {((item.confidence || 0) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td style={{ padding: "10px" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Button
                          variant="secondary"
                          onClick={() => handleResolveReview(item.id, "accept")}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => handleResolveReview(item.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── CREATE LIST MODAL ───────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="error-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="error-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2>New Account List</h2>
            <p style={{ color: "var(--text-2)", fontSize: "0.88rem" }}>
              Import domains to enrich with firmographics and evaluate against your ICP.
            </p>

            <form onSubmit={handleCreateList}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "18px 0" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    List Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder="e.g. Q4 Target Accounts"
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Company domains or names
                  </label>
                  {/* A RevOps source list is almost always company NAMES out of
                      a CRM export, not domains. Hand-resolving fifty of them is
                      most of the work this screen exists to remove. */}
                  <DomainListInput
                    rows={6}
                    value={rawDomains}
                    onChange={setRawDomains}
                    placeholder={`stripe.com\nLinear\ngithub.com`}
                  />
                  <div style={{ fontSize: "0.8rem", color: "var(--text-2)", marginTop: 4 }}>
                    {dedupedPreview.count > 0 ? (
                      <span style={{ color: "var(--ok, #059669)" }}>
                        ✓ {dedupedPreview.count} unique domain{dedupedPreview.count === 1 ? "" : "s"} ready
                      </span>
                    ) : (
                      "One domain or URL per line, or comma-separated."
                    )}
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Target Persona ICP
                  </label>
                  <select
                    value={selectedPersona}
                    onChange={(e) => setSelectedPersona(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value="sales">Sales (B2B SaaS / Tech ICP)</option>
                    <option value="revops">RevOps (Mid-Market Qualified)</option>
                    <option value="ci">Competitive Intelligence</option>
                    <option value="default">General B2B ICP</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={dedupedPreview.count === 0}>
                  Create List ({dedupedPreview.count} accounts)
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT LIST MODAL ─────────────────────────────────────────────── */}
      {editingList && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="card" style={{ width: "100%", maxWidth: 480, padding: 24, background: "var(--surface)", borderRadius: "var(--r, 14px)", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="edit" size={16} /> Edit Account List
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEditingList(null)}><Icon name="x" size={16} /></Button>
            </div>
            <form onSubmit={handleSaveListEdit}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>List Name</label>
                  <input type="text" className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={editListName} onChange={(e) => setEditListName(e.target.value)} required />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>Description</label>
                  <textarea rows={3} className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={editListDesc} onChange={(e) => setEditListDesc(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button variant="ghost" onClick={() => setEditingList(null)}>Cancel</Button>
                <Button variant="primary" type="submit">Save Changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── DELETE LIST MODAL ───────────────────────────────────────────── */}
      {deletingList && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="card" style={{ width: "100%", maxWidth: 460, padding: 24, background: "var(--surface)", borderRadius: "var(--r, 14px)", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--danger, #dc2626)", marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--danger-soft, #fee2e2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="alert-triangle" size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.15rem" }}>Delete Account List?</h3>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--text-2)", lineHeight: 1.5, margin: "0 0 12px" }}>
              Are you sure you want to delete <strong>{deletingList.name}</strong>? This will remove the list and its account records.
            </p>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r, 8px)", padding: "10px 12px", fontSize: "0.82rem", color: "var(--text-2)", marginBottom: 16 }}>
              <Icon name="shield-check" size={14} style={{ color: "var(--success, #10b981)", verticalAlign: "-2px", marginRight: 6 }} />
              <strong>Audit Trail Preserved:</strong> Historical enrichment jobs and compliance run records remain archived.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button variant="ghost" onClick={() => setDeletingList(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleConfirmDeleteList} style={{ background: "var(--danger, #dc2626)", color: "#fff" }}>Delete List</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── CURATE ACCOUNT MODAL ─────────────────────────────────────────── */}
      {curatingRecord && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="card" style={{ width: "100%", maxWidth: 520, padding: 24, background: "var(--surface)", borderRadius: "var(--r, 14px)", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="edit" size={16} /> Curate Account
                </h3>
                <span style={{ fontSize: "12px", color: "var(--text-2)" }}>{curatingRecord.canonical_domain}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setCuratingRecord(null)}><Icon name="x" size={16} /></Button>
            </div>
            <form onSubmit={handleSaveCuration}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>Company Name</label>
                  <input type="text" className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={curateCompanyName} onChange={(e) => setCurateCompanyName(e.target.value)} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>Industry</label>
                    <input type="text" className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={curateIndustry} onChange={(e) => setCurateIndustry(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>Employee Count</label>
                    <input type="number" className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={curateEmployees} onChange={(e) => setCurateEmployees(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>ICP Fit Score (0-100%)</label>
                  <input type="number" min="0" max="100" className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={curateIcpScore} onChange={(e) => setCurateIcpScore(e.target.value)} placeholder="e.g. 85" />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>Curation Notes</label>
                  <textarea rows={2} className="input" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }} value={curateNotes} onChange={(e) => setCurateNotes(e.target.value)} placeholder="Reason for manual override or qualification details..." />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button variant="ghost" onClick={() => setCuratingRecord(null)} disabled={curateSaving}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={curateSaving}>{curateSaving ? "Saving..." : "Save Curation"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
