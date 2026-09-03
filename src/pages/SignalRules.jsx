// src/pages/SignalRules.jsx — Native Signal Routing (PRD 5).
//
// If-this-then-that rule builder connecting competitor watchlists, ICP qualification,
// and workflow runs to Slack, Email, Webhooks, and HubSpot.

import { useState, useEffect } from "react";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { TRIGGER_SOURCES, ACTION_TYPES, evaluateSignalRule, formatActionPayload } from "../lib/rules/ruleModel.js";
import * as rulesApi from "../lib/rules/rulesClient.js";

export default function SignalRules() {
  const showToast = useToast();
  const { user } = useAuth();

  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [triggerSource, setTriggerSource] = useState(TRIGGER_SOURCES.WATCHLIST);
  const [actionType, setActionType] = useState(ACTION_TYPES.SLACK);
  const [actionDest, setActionDest] = useState("#competitor-alerts");
  const [conditionField, setConditionField] = useState("materiality");
  const [conditionOp, setConditionOp] = useState("equals");
  const [conditionVal, setConditionVal] = useState("critical");

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

  const loadRules = async () => {
    setLoading(true);
    try {
      const res = await rulesApi.listRules();
      setRules(res.rules || []);
    } catch (e) {
      showToast(e.message);
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
    const actionConfig =
      actionType === ACTION_TYPES.SLACK
        ? { channel: actionDest }
        : actionType === ACTION_TYPES.WEBHOOK
        ? { webhook_url: actionDest }
        : actionType === ACTION_TYPES.EMAIL
        ? { recipients: [actionDest] }
        : { portal_id: actionDest };

    try {
      await rulesApi.createRule({
        name,
        trigger_source: triggerSource,
        conditions,
        action_type: actionType,
        action_config: actionConfig,
      });

      showToast("Signal rule created.");
      setShowCreateModal(false);
      setName("");
      loadRules();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await rulesApi.deleteRule(id);
      showToast("Rule deleted.");
      loadRules();
    } catch (err) {
      showToast(err.message);
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
                    borderRadius: 8,
                    padding: 16,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <h4 style={{ margin: "0 0 6px 0", fontSize: "1.05rem" }}>{r.name}</h4>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.82rem" }}>
                      <span className="wrh-pill" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>
                        WHEN: {r.trigger_source}
                      </span>
                      <span className="wrh-pill" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                        THEN: {r.action_type.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
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
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(r.id)}>
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

                <div>
                  <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                    Destination (Channel, URL, or Email)
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)" }}
                    placeholder={actionType === ACTION_TYPES.SLACK ? "#competitor-alerts" : "https://..."}
                    value={actionDest}
                    onChange={(e) => setActionDest(e.target.value)}
                    required
                  />
                </div>
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
    </div>
  );
}
