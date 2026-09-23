// src/pages/SignalRules.jsx — Native Signal Routing (PRD 5).
//
// If-this-then-that rule builder connecting competitor watchlists, ICP qualification,
// and workflow runs to Slack, Email, Webhooks, and HubSpot.

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import SignedInRequired from "../components/SignedInRequired.jsx";
import { TRIGGER_SOURCES, ACTION_TYPES, evaluateSignalRule, formatActionPayload } from "../lib/rules/ruleModel.js";
import * as rulesApi from "../lib/rules/rulesClient.js";
import { getIntegrationStatus } from "../lib/integrationsClient.js";
import { readPageCache, writePageCache } from "../lib/cache/pageCache.js";

export default function SignalRules() {
  const showToast = useToast();
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();

  const cachedRules = readPageCache("signalRules")?.data || [];
  const [rules, setRules] = useState(cachedRules);
  const [loading, setLoading] = useState(cachedRules.length === 0);

  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [triggerSource, setTriggerSource] = useState(TRIGGER_SOURCES.WATCHLIST);
  const [actionType, setActionType] = useState(ACTION_TYPES.SLACK);
  const [actionDest, setActionDest] = useState("#competitor-alerts");
  const [conditionField, setConditionField] = useState("materiality");
  const [conditionOp, setConditionOp] = useState("equals");
  const [conditionVal, setConditionVal] = useState("critical");

  // Edit Modal State
  const [editingRule, setEditingRule] = useState(null);
  const [editName, setEditName] = useState("");
  const [editTriggerSource, setEditTriggerSource] = useState(TRIGGER_SOURCES.WATCHLIST);
  const [editActionType, setEditActionType] = useState(ACTION_TYPES.SLACK);
  const [editActionDest, setEditActionDest] = useState("");
  const [editConditionField, setEditConditionField] = useState("materiality");
  const [editConditionOp, setEditConditionOp] = useState("equals");
  const [editConditionVal, setEditConditionVal] = useState("critical");

  // Delete Modal State
  const [deletingRule, setDeletingRule] = useState(null);

  // Connection state for the two actions that route through a stored
  // integration. Loaded when the modal opens, not on page mount: a user who
  // never opens the builder should not trigger two integration lookups.
  const [connections, setConnections] = useState({ slack: null, hubspot: null });
  const [connLoading, setConnLoading] = useState(false);
  const [destTesting, setDestTesting] = useState(false);
  const [destTestResult, setDestTestResult] = useState(null);

  // Load the two connection-backed integrations when the builder opens.
  useEffect(() => {
    if (!showCreateModal && !editingRule) return;
    let cancelled = false;
    setConnLoading(true);
    Promise.all([getIntegrationStatus("slack"), getIntegrationStatus("hubspot")])
      .then(([slack, hubspot]) => { if (!cancelled) setConnections({ slack, hubspot }); })
      .catch(() => { if (!cancelled) setConnections({ slack: null, hubspot: null }); })
      .finally(() => { if (!cancelled) setConnLoading(false); });
    return () => { cancelled = true; };
  }, [showCreateModal, editingRule]);

  // Each action wants a different destination, so switching action must not
  // leave the previous one's value behind (a Slack channel in a webhook URL
  // field saves a rule that can never dispatch). Email starts at the signed-in
  // address — the overwhelmingly common answer — and stays editable.
  useEffect(() => {
    setDestTestResult(null);
    if (actionType === ACTION_TYPES.EMAIL) setActionDest(user?.email || "");
    else if (actionType === ACTION_TYPES.SLACK) setActionDest("#competitor-alerts");
    else setActionDest("");
  }, [actionType, user?.email]);

  const runDestinationTest = async () => {
    setDestTesting(true);
    setDestTestResult(null);
    try {
      const cfg =
        actionType === ACTION_TYPES.WEBHOOK ? { webhook_url: actionDest }
        : actionType === ACTION_TYPES.SLACK ? { use_connection: true, channel: actionDest || null }
        : { to: actionDest };
      const r = await rulesApi.testDestination(actionType, cfg);
      setDestTestResult(r);
    } catch (err) {
      setDestTestResult({ ok: false, error: err.message });
    } finally {
      setDestTesting(false);
    }
  };

  // Sandbox Tester
  const [testingRule, setTestingRule] = useState(null);
  const [samplePayloadText, setSamplePayloadText] = useState(
    JSON.stringify(
      {
        source: "watchlist",
        domain: "stripe.com",
        field: "starter_price",
        materiality: "critical",
        fact_summary: "Starter price increased from $49/mo to $79/mo",
        ai_interpretation: "61% price increase indicating movement upmarket.",
      },
      null,
      2
    )
  );
  const [testResult, setTestResult] = useState(null);

  const loadRules = async (silent = false) => {
    if (!silent && rules.length === 0) setLoading(true);
    try {
      const res = await rulesApi.listRules();
      const fresh = res.rules || [];
      setRules(fresh);
      writePageCache("signalRules", fresh);
    } catch (e) {
      if (rules.length === 0) showToast(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast("Please provide a name for this rule.");
      return;
    }

    const conditions = [{ field: conditionField, operator: conditionOp, value: conditionVal }];
    // These shapes are the server's, not ours. `validateActionConfig` reads
    // `to`/`email` for email and a URL for webhook; the previous
    // `{ recipients: [...] }` and `{ channel }` matched neither, so every
    // Slack and Email rule was refused at save with "a destination URL is
    // required" / "a valid recipient email address is required".
    const actionConfig =
      actionType === ACTION_TYPES.SLACK
        // The webhook URL is a secret and lives in the stored connection; the
        // channel rides along as a label only.
        ? { use_connection: true, channel: actionDest || null }
        : actionType === ACTION_TYPES.WEBHOOK
        ? { webhook_url: actionDest }
        : actionType === ACTION_TYPES.EMAIL
        ? { to: actionDest }
        : {};

    try {
      const res = await rulesApi.createRule({
        name,
        trigger_source: triggerSource,
        conditions,
        action_type: actionType,
        action_config: actionConfig,
      });

      const newRule = res?.rule || {
        id: res?.id || `rule_${Date.now()}`,
        name,
        trigger_source: triggerSource,
        conditions,
        action_type: actionType,
        action_config: actionConfig,
        enabled: true,
        created_at: new Date().toISOString(),
      };

      setRules((prev) => {
        const next = [newRule, ...prev.filter((r) => r.id !== newRule.id)];
        writePageCache("signalRules", next);
        return next;
      });

      showToast("Signal rule created.");
      setShowCreateModal(false);
      setName("");
      loadRules(true);
    } catch (err) {
      showToast(err.message);
    }
  };

  const openEditModal = (r) => {
    setEditingRule(r);
    setEditName(r.name || "");
    setEditTriggerSource(r.trigger_source || TRIGGER_SOURCES.WATCHLIST);
    setEditActionType(r.action_type || ACTION_TYPES.SLACK);
    setEditActionDest(r.action_config?.channel || r.action_config?.to || r.action_config?.webhook_url || "");
    const cond = r.conditions?.[0] || {};
    setEditConditionField(cond.field || "materiality");
    setEditConditionOp(cond.operator || "equals");
    setEditConditionVal(cond.value || "critical");
    setDestTestResult(null);
  };

  const handleUpdateRule = async (e) => {
    e.preventDefault();
    if (!editingRule) return;
    const conditions = [{ field: editConditionField, operator: editConditionOp, value: editConditionVal }];
    const actionConfig =
      editActionType === ACTION_TYPES.SLACK
        ? { use_connection: true, channel: editActionDest || null }
        : editActionType === ACTION_TYPES.WEBHOOK
        ? { webhook_url: editActionDest }
        : editActionType === ACTION_TYPES.EMAIL
        ? { to: editActionDest }
        : {};

    try {
      await rulesApi.updateRule(editingRule.id, {
        name: editName.trim(),
        trigger_source: editTriggerSource,
        conditions,
        action_type: editActionType,
        action_config: actionConfig,
      });

      showToast("Signal rule updated.");
      setEditingRule(null);
      loadRules(true);
    } catch (err) {
      showToast(err.message || "Failed to update rule");
    }
  };

  const confirmDelete = async () => {
    if (!deletingRule) return;
    const ruleId = deletingRule.id;
    try {
      setRules((prev) => {
        const next = prev.filter((r) => r.id !== ruleId);
        writePageCache("signalRules", next);
        return next;
      });
      await rulesApi.deleteRule(ruleId);
      showToast("Rule deleted. Audit trail preserved.");
      setDeletingRule(null);
      loadRules(true);
    } catch (err) {
      showToast(err.message || "Failed to delete rule");
      loadRules();
    }
  };

  const handleRunTest = () => {
    try {
      const payload = JSON.parse(samplePayloadText);
      const targetRule = testingRule || {
        trigger_source: triggerSource,
        conditions: [{ field: conditionField, operator: conditionOp, value: conditionVal }],
        action_type: actionType,
        action_config: { channel: actionDest, webhook_url: actionDest },
        name: name || "Test Rule",
      };

      const evalRes = evaluateSignalRule(targetRule, payload);
      const formatted = evalRes.matches ? formatActionPayload(targetRule, payload) : null;
      setTestResult({ ...evalRes, formatted });
    } catch (err) {
      showToast("Invalid JSON in sample payload: " + err.message);
    }
  };

  if (authLoading) {
    return (
      <div className="container" style={{ padding: "40px 20px", opacity: 0.6 }}>
        <div style={{ height: 28, width: 200, background: "var(--surface-2)", borderRadius: 6, marginBottom: 12 }} />
        <div style={{ height: 16, width: 340, background: "var(--surface-2)", borderRadius: 6, marginBottom: 24 }} />
        <div style={{ height: 200, background: "var(--surface-2)", borderRadius: 8 }} />
      </div>
    );
  }

  // These endpoints are signed-in only: they return 401 rather than another
  // tenant's rows. Render the reason, not the client SDK's thrown error.
  if (!user) {
    return <SignedInRequired title="Signal routing rules" reason="Turn a detected change or a high-fit account into an action in Slack, HubSpot or your own webhook. Rules run against your own watchlists and lists, so they are tied to your account." />;
  }

  return (
    <div className="container" style={{ padding: "40px 20px" }}>
      <header className="page-header" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: "1.8rem", fontWeight: 700, margin: 0 }}>Native Signal Routing</h1>
            <p style={{ color: "var(--text-2)", marginTop: 6, fontSize: "0.95rem" }}>
              Automate actions when critical competitive changes occur or accounts meet ICP qualification criteria.
            </p>
          </div>
          <Button variant="primary" onClick={() => { setTestingRule(null); setShowCreateModal(true); }}>
            <Icon name="plus" size={16} /> New Routing Rule
          </Button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", gap: 24, alignItems: "flex-start" }}>
        {/* Rules list */}
        <div className="card" style={{ padding: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.3rem" }}>Active Rules ({rules.length})</h2>

          {rules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <Icon name="share-2" size={36} style={{ color: "var(--text-3)", marginBottom: 12 }} />
              <h3>No signal rules configured</h3>
              <p style={{ color: "var(--text-2)", marginBottom: 16 }}>
                Route competitive alerts to Slack or push qualified accounts directly to your CRM.
              </p>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                <Icon name="plus" size={14} /> Create First Rule
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rules.map((r) => (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r, 10px)",
                    padding: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <h4 style={{ margin: "0 0 4px 0", fontSize: "1.05rem" }}>{r.name}</h4>
                      <Link to="/workflows" style={{ textDecoration: "none" }}>
                        <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--accent)", border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Icon name="git-merge" size={11} /> Referenced in Workflows
                        </span>
                      </Link>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.82rem", flexWrap: "wrap", marginTop: 4 }}>
                      <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                        WHEN: {r.trigger_source}
                      </span>
                      <span className="wrh-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        THEN: {r.action_type?.toUpperCase()}
                      </span>
                      {r.action_config?.channel && (
                        <span style={{ fontSize: "12px", color: "var(--text-3)" }}>Channel: {r.action_config.channel}</span>
                      )}
                      {r.action_config?.to && (
                        <span style={{ fontSize: "12px", color: "var(--text-3)" }}>To: {r.action_config.to}</span>
                      )}
                      {r.action_config?.webhook_url && (
                        <span style={{ fontSize: "12px", color: "var(--text-3)" }}>URL: {r.action_config.webhook_url}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setTestingRule(r);
                        handleRunTest();
                      }}
                    >
                      Test
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditModal(r)}
                      title="Edit rule"
                    >
                      <Icon name="edit" size={13} /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingRule(r)}
                      title="Delete rule"
                      style={{ color: "var(--danger, #dc2626)" }}
                    >
                      <Icon name="trash-2" size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sandbox Tester */}
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0, fontSize: "1.1rem" }}>Rule Evaluation Sandbox</h3>
          <p style={{ fontSize: "0.84rem", color: "var(--text-2)", marginBottom: 12 }}>
            Test conditions and preview the resulting dispatch payload before activating.
          </p>

          <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: 4 }}>
            Sample Event JSON Payload
          </label>
          <textarea
            rows={8}
            className="input"
            style={{
              width: "100%",
              padding: 10,
              fontFamily: "monospace",
              fontSize: "0.8rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
            value={samplePayloadText}
            onChange={(e) => setSamplePayloadText(e.target.value)}
          />

          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" onClick={handleRunTest}>
              <Icon name="play" size={14} /> Run Test Evaluation
            </Button>
          </div>

          {testResult && (
            <div style={{ marginTop: 16, padding: 12, background: "var(--surface-2)", borderRadius: 6 }}>
              <div style={{ fontWeight: 700, color: testResult.matches ? "#059669" : "#b91c1c", marginBottom: 6 }}>
                Verdict: {testResult.matches ? "✓ RULE MATCHED" : "✗ NO MATCH"}
              </div>
              <ul style={{ margin: "0 0 10px 0", paddingLeft: 18, fontSize: "0.82rem", color: "var(--text-2)" }}>
                {testResult.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {testResult.formatted && (
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
                    Action Dispatch Output
                  </div>
                  <pre style={{ margin: 0, fontSize: "0.78rem", background: "var(--surface-1)", padding: 8, borderRadius: 4, overflowX: "auto" }}>
                    {JSON.stringify(testResult.formatted, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── CREATE RULE MODAL ─────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          className="error-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="error-modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <h2>New Signal Routing Rule</h2>
            <p style={{ color: "var(--text-2)", fontSize: "0.88rem" }}>
              Define when this rule triggers, what criteria must match, and where to route the alert.
            </p>

            <form onSubmit={handleCreate}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "18px 0" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Rule Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder="e.g. Notify Slack on Competitor Pricing Hike"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    WHEN (Trigger Source)
                  </label>
                  <select
                    value={triggerSource}
                    onChange={(e) => setTriggerSource(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value={TRIGGER_SOURCES.WATCHLIST}>Competitor Watchlist Change</option>
                    <option value={TRIGGER_SOURCES.BULK_ENRICHMENT}>Bulk Account ICP Qualified</option>
                    <option value={TRIGGER_SOURCES.WORKFLOW_RUN}>Workflow Template Run Completed</option>
                  </select>
                </div>

                <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 6 }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>
                    IF (Condition)
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="field (e.g. materiality)"
                      value={conditionField}
                      onChange={(e) => setConditionField(e.target.value)}
                    />
                    <select
                      value={conditionOp}
                      onChange={(e) => setConditionOp(e.target.value)}
                    >
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="gte">&gt;=</option>
                      <option value="lte">&lt;=</option>
                      <option value="contains">contains</option>
                      <option value="not_empty">not empty</option>
                    </select>
                    <input
                      type="text"
                      className="input"
                      placeholder="value (e.g. critical)"
                      value={conditionVal}
                      onChange={(e) => setConditionVal(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    THEN (Action)
                  </label>
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value={ACTION_TYPES.SLACK}>Send Slack Notification</option>
                    <option value={ACTION_TYPES.EMAIL}>Send Email Alert</option>
                    <option value={ACTION_TYPES.WEBHOOK}>POST to Webhook</option>
                    <option value={ACTION_TYPES.HUBSPOT}>Sync Company to HubSpot</option>
                  </select>
                </div>

                <DestinationField
                  actionType={actionType}
                  actionDest={actionDest}
                  setActionDest={setActionDest}
                  connections={connections}
                  connLoading={connLoading}
                  onConfigure={() => { setShowCreateModal(false); navigate("/integrations"); }}
                  onTest={runDestinationTest}
                  testing={destTesting}
                  testResult={destTestResult}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save Rule
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Rule Modal */}
      {editingRule && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 540,
              padding: 24,
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)",
              background: "var(--surface)",
              borderRadius: "var(--r, 14px)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="edit" size={18} /> Edit Signal Rule
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEditingRule(null)}>
                <Icon name="x" size={16} />
              </Button>
            </div>

            <form onSubmit={handleUpdateRule}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "18px 0" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Rule Name
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    WHEN (Trigger Source)
                  </label>
                  <select
                    value={editTriggerSource}
                    onChange={(e) => setEditTriggerSource(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value={TRIGGER_SOURCES.WATCHLIST}>Competitor Watchlist Change</option>
                    <option value={TRIGGER_SOURCES.BULK_ENRICHMENT}>Bulk Account ICP Qualified</option>
                    <option value={TRIGGER_SOURCES.WORKFLOW_RUN}>Workflow Template Run Completed</option>
                  </select>
                </div>

                <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: 6 }}>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 8 }}>
                    IF (Condition)
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <input
                      type="text"
                      className="input"
                      placeholder="field (e.g. materiality)"
                      value={editConditionField}
                      onChange={(e) => setEditConditionField(e.target.value)}
                    />
                    <select
                      value={editConditionOp}
                      onChange={(e) => setEditConditionOp(e.target.value)}
                    >
                      <option value="equals">equals</option>
                      <option value="not_equals">not equals</option>
                      <option value="gte">&gt;=</option>
                      <option value="lte">&lt;=</option>
                      <option value="contains">contains</option>
                      <option value="not_empty">not empty</option>
                    </select>
                    <input
                      type="text"
                      className="input"
                      placeholder="value (e.g. critical)"
                      value={editConditionVal}
                      onChange={(e) => setEditConditionVal(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    THEN (Action)
                  </label>
                  <select
                    value={editActionType}
                    onChange={(e) => setEditActionType(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                  >
                    <option value={ACTION_TYPES.SLACK}>Send Slack Notification</option>
                    <option value={ACTION_TYPES.EMAIL}>Send Email Alert</option>
                    <option value={ACTION_TYPES.WEBHOOK}>POST to Webhook</option>
                    <option value={ACTION_TYPES.HUBSPOT}>Sync to HubSpot</option>
                  </select>
                </div>

                <DestinationField
                  actionType={editActionType}
                  actionDest={editActionDest}
                  setActionDest={setEditActionDest}
                  connections={connections}
                  connLoading={connLoading}
                  onConfigure={() => { setEditingRule(null); navigate("/integrations"); }}
                  onTest={runDestinationTest}
                  testing={destTesting}
                  testResult={destTestResult}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <Button variant="ghost" onClick={() => setEditingRule(null)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Rule Confirmation Modal */}
      {deletingRule && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: 460,
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)",
              background: "var(--surface)",
              borderRadius: "var(--r, 14px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--danger, #dc2626)", marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--danger-soft, #fee2e2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="alert-triangle" size={18} />
              </div>
              <h3 style={{ margin: 0, fontSize: "1.15rem" }}>Delete Signal Rule?</h3>
            </div>

            <p style={{ fontSize: "0.9rem", color: "var(--text-2)", lineHeight: 1.5, margin: "0 0 12px" }}>
              Are you sure you want to delete rule <strong>{deletingRule.name}</strong>? This will disconnect the rule and stop sending notifications.
            </p>

            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--r, 8px)", padding: "10px 12px", fontSize: "0.82rem", color: "var(--text-2)", marginBottom: 16 }}>
              <Icon name="shield-check" size={14} style={{ color: "var(--success, #10b981)", verticalAlign: "-2px", marginRight: 6 }} />
              <strong>Audit Trail Preserved:</strong> All past trigger events, payload traces, and delivery timestamps will remain securely preserved in your audit logs.
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button variant="ghost" onClick={() => setDeletingRule(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} style={{ background: "var(--danger, #dc2626)", color: "#fff" }}>
                Delete Rule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The destination half of the rule builder. Each action answers a different
 * question, so one free-text box could not serve all four: Slack and HubSpot
 * route through a stored connection (nothing to type, but something to
 * CONNECT), email wants an address, and a webhook wants a URL you can try
 * before saving.
 */
function DestinationField({
  actionType, actionDest, setActionDest,
  connections, connLoading, onConfigure, onTest, testing, testResult,
}) {
  const label = { display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 };
  const input = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" };
  const note  = { fontSize: "0.78rem", color: "var(--text-3)", marginTop: 6 };

  // Shown when an action needs an integration the account has not connected.
  // A rule saved against a missing connection is refused at dispatch, hours
  // later, in a log nobody reads — so it is blocked here, where it is fixable.
  const NotConnected = ({ name }) => (
    <div style={{
      padding: "12px 14px", borderRadius: 8, border: "1px solid var(--border)",
      background: "var(--warning-soft, #fef3c7)",
    }}>
      <p style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>
        <strong>{name} is not connected.</strong> This rule needs a {name} connection
        before it can send anything.
      </p>
      <Button variant="secondary" type="button" onClick={onConfigure}>
        Connect {name}
      </Button>
    </div>
  );

  const Connected = ({ name, detail }) => (
    <p style={{ ...note, color: "var(--success, #059669)", marginTop: 0, marginBottom: 8 }}>
      ✓ {name} connected{detail ? ` — ${detail}` : ""}
    </p>
  );

  const TestRow = () => (
    <div style={{ marginTop: 10 }}>
      <Button variant="secondary" type="button" onClick={onTest} disabled={testing || !actionDest}>
        {testing ? "Sending…" : "Send test"}
      </Button>
      {testResult && (
        <p style={{
          ...note,
          color: testResult.ok ? "var(--success, #059669)" : "var(--danger, #b45309)",
        }}>
          {testResult.ok
            ? "Test message delivered."
            : `Not delivered — ${testResult.error || "the destination did not accept it."}`}
        </p>
      )}
    </div>
  );

  if (connLoading && (actionType === ACTION_TYPES.SLACK || actionType === ACTION_TYPES.HUBSPOT)) {
    return <p style={note}>Checking your integrations…</p>;
  }

  if (actionType === ACTION_TYPES.SLACK) {
    if (!connections.slack?.connected) return <NotConnected name="Slack" />;
    return (
      <div>
        <Connected name="Slack" detail={connections.slack?.webhook_hint} />
        <label style={label}>Channel (label only)</label>
        <input
          type="text" className="input" style={input}
          placeholder="#competitor-alerts"
          value={actionDest}
          onChange={(e) => setActionDest(e.target.value)}
        />
        <p style={note}>
          Messages go to the channel your Slack webhook was created for. This label
          is recorded on the rule so the destination is readable at a glance.
        </p>
        <TestRow />
      </div>
    );
  }

  if (actionType === ACTION_TYPES.HUBSPOT) {
    if (!connections.hubspot?.connected) return <NotConnected name="HubSpot" />;
    return (
      <div>
        <Connected name="HubSpot" detail={connections.hubspot?.account_label} />
        <p style={{ ...note, marginTop: 0 }}>
          Qualified companies are synced to this connected portal. There is nothing
          to configure — the destination is resolved from your connection at send
          time, never stored on the rule.
        </p>
      </div>
    );
  }

  if (actionType === ACTION_TYPES.EMAIL) {
    return (
      <div>
        <label style={label}>Send to</label>
        <input
          type="email" className="input" style={input}
          placeholder="you@company.com"
          value={actionDest}
          onChange={(e) => setActionDest(e.target.value)}
          required
        />
        <p style={note}>Defaults to your account email. Change it to route alerts elsewhere.</p>
        <TestRow />
      </div>
    );
  }

  return (
    <div>
      <label style={label}>Webhook URL</label>
      <input
        type="url" className="input" style={input}
        placeholder="https://example.com/hooks/datiq"
        value={actionDest}
        onChange={(e) => setActionDest(e.target.value)}
        required
      />
      <p style={note}>
        A POST with the signal payload as JSON. Public HTTPS endpoints only —
        private and reserved addresses are refused.
      </p>
      <TestRow />
    </div>
  );
}
