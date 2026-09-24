// SxoDashboard.jsx — Search Experience Optimization (SXO) & Outcomes Dashboard (§11.15).
//
// ── THE SIX DASHBOARD REGIONS (§11.15 / Deliverable 4.8) ────────────────────
// 1. Master score card + 5 frameworks (SEO, AEO, GEO, SXO, Subject) + qualified-lead delta + overlap disclosure (§4.1)
// 2. 6 SXO layer scores (TD, IC, UX, IA, CD, MI) with weightings and signal breakdowns
// 3. 9-stage Journey Funnel with measured vs uninstrumented exclusion discipline (§11.9)
// 4. Top Friction & Form Diagnostics (9 per-form metrics + UX friction findings)
// 5. Template & Portfolio Performance across the 9 axes with "no data" for unaudited subjects (§11.10)
// 6. Persona-filtered actions (7 personas) + Optimization Experiments tracker with correlation disclaimer (§11.12)

import { useState, useEffect, useCallback, useMemo, useContext } from "react";
import { AuthContext } from "../AuthProvider.jsx";
import { cacheKey, readCache, loadWithCache } from "../../lib/discoverability/tabCache.js";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { SXO_LAYERS, SXO_LAYER_WEIGHTS } from "../../lib/discoverability/sxoModel.js";
import { computeMasterScore } from "../../lib/discoverability/sxoScoring.js";
import { FUNNEL_STAGES, calculateJourneyFunnel } from "../../lib/discoverability/journeyModel.js";
import { PORTFOLIO_ROLLUP_AXES } from "../../lib/discoverability/portfolioModel.js";
import { PERSONA_PACKS, filterPersonaQueue } from "../../lib/discoverability/personaPacks.js";
import { randomUuid } from "../../lib/secureRandom.js";

const OVERLAP_DISCLOSURE =
  "Master score weights include: SEO 0.25, AEO 0.20, GEO 0.20, SXO 0.35. Technical accessibility signals (including Core Web Vitals and mobile parity) are evaluated across both technical SEO foundation and SXO experience friction layers as specified in §11.3.";

const CORRELATION_NOTICE =
  "Observed metric movement between baseline and observation periods is correlational. External factors including search engine algorithm updates, seasonal traffic fluctuations, and unmeasured marketing campaigns contribute to real-world outcomes. Correlation does not establish causation.";

const ANALYTICS_PROVIDERS = Object.freeze([
  {
    id: "ga4",
    label: "Google Analytics 4",
    accountHint: "GA4 property ID",
    credentialHint: "Measurement Protocol API Secret or Service Account Key",
    portalUrl: "https://analytics.google.com/analytics/web/#/admin",
    portalLabel: "Google Analytics Admin",
    portalPath: "Admin → Property Settings → Data Streams → Measurement Protocol API Secrets",
    tip: "Open GA4 Admin > Property Settings to find your 9-digit Property ID. Under Data Streams, select your web stream and create a Measurement Protocol API secret.",
  },
  {
    id: "posthog",
    label: "PostHog",
    accountHint: "Project ID",
    credentialHint: "Project API Key (phc_...)",
    portalUrl: "https://us.posthog.com/project/settings",
    portalLabel: "PostHog Project Settings",
    portalPath: "Project Settings → Project API Key",
    tip: "In PostHog, go to Project Settings > General to copy your Project API Key and Project ID. Only privacy-safe aggregate event counts are imported.",
  },
  {
    id: "plausible",
    label: "Plausible",
    accountHint: "Site domain",
    credentialHint: "API Key",
    portalUrl: "https://plausible.io/settings",
    portalLabel: "Plausible Settings",
    portalPath: "Settings → API Keys → New API Key",
    tip: "In Plausible User Settings > API Keys, create a read-only stats key and enter your configured site domain.",
  },
]);

const IMPORT_EVENTS = Object.freeze([
  ["page_view", "Page views", "Stages 1 & 2", "Landing sessions & exposure"],
  ["scroll_50", "Scroll depth (50%+)", "Stage 3", "Engaged session depth"],
  ["pricing_view", "Pricing / Value views", "Stage 4", "Key content seen"],
  ["primary_cta_view", "Primary CTA views", "Stage 5", "CTA entered viewport"],
  ["primary_cta_click", "Primary CTA clicks", "Stage 6", "Action trigger clicked"],
  ["form_start", "Form starts", "Stage 7", "Action started"],
  ["form_submit", "Form submissions", "Stage 8", "Conversion complete"],
  ["qualified_conversion", "Qualified outcomes", "Stage 9", "Sales-qualified outcomes"],
]);

function measured(value, suffix = "") {
  return Number.isFinite(Number(value)) ? `${Number(value).toLocaleString()}${suffix}` : "—";
}

function newImportKey(provider, auditId) {
  const random = randomUuid();
  return `${provider}-${auditId || "portfolio"}-${random}`;
}

export default function SxoDashboard({ auditId, fullAudit, workspaceId = null, onRunSxo }) {
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [sxoRun, setSxoRun] = useState(null);
  const [funnelData, setFunnelData] = useState(null);
  const [diagnosticsData, setDiagnosticsData] = useState(null);
  const [experiments, setExperiments] = useState([]);
  const [rollups, setRollups] = useState([]);
  // 🔴 2026-09-22 — initialize to "all" so the first surface the user sees
  // shows the cross-axis rollup, which is what the dashboard is for. They can
  // still drill into a single axis via the chips.
  const [selectedAxis, setSelectedAxis] = useState("all");
  // 🔴 2026-09-22 — track the last recalculation error so the empty-state
  // diagnostic can show WHY nothing rendered, not just that nothing rendered.
  const [recalcError, setRecalcError] = useState(null);
  const [selectedPersona, setSelectedPersona] = useState("all");
  const [creatingExperiment, setCreatingExperiment] = useState(false);
  const [newExperimentName, setNewExperimentName] = useState("");
  const [newHypothesis, setNewHypothesis] = useState("");
  const [purgeDays, setPurgeDays] = useState("30");
  const [purging, setPurging] = useState(false);
  const [auditData, setAuditData] = useState(fullAudit);
  const [connections, setConnections] = useState([]);
  const [goals, setGoals] = useState([]);
  const [provider, setProvider] = useState("ga4");
  const [providerAccountId, setProviderAccountId] = useState("");
  const [providerToken, setProviderToken] = useState("");
  const [connectorBusy, setConnectorBusy] = useState(false);
  const [importProvider, setImportProvider] = useState("custom");
  const [importCounts, setImportCounts] = useState({});
  const [importKey, setImportKey] = useState(() => newImportKey("custom", auditId));
  const [importBusy, setImportBusy] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalOutcome, setGoalOutcome] = useState("lead");
  const [goalBusy, setGoalBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("all");
  const [activeSetupSegment, setActiveSetupSegment] = useState("credentials");
  const [recalculatingRollup, setRecalculatingRollup] = useState(false);
  const [showFunnelConfig, setShowFunnelConfig] = useState(false);
  const [funnelConfig, setFunnelConfig] = useState({});
  const [savingFunnelConfig, setSavingFunnelConfig] = useState(false);

  const cacheUserId = useContext(AuthContext)?.user?.id || null;

  // Paint the last-seen SXO dashboard for this audit from localStorage, then
  // refresh every section from the database.
  const loadDashboardData = useCallback(async () => {
    if (!auditId) return;
    const key = cacheKey("sxo", { userId: cacheUserId, workspaceId }, `${auditId}:${selectedAxis}`);
    if (!readCache(key)) setLoading(true);
    const applySxo = (d) => {
      const { auditRes, runRes, journeyRes, diagRes, expRes, rollRes, connectionRes, goalRes } = d || {};
      if (auditRes) setAuditData(auditRes);
      setSxoRun(runRes?.runs?.[0] || null);
      if (journeyRes?.funnel) setFunnelData(journeyRes.funnel);
      if (diagRes?.diagnostics) setDiagnosticsData(diagRes.diagnostics);
      if (expRes?.experiments) setExperiments(expRes.experiments);
      if (rollRes?.rollups) setRollups(rollRes.rollups);
      setConnections(connectionRes?.connections || []);
      setGoals(goalRes?.goals || []);
      setLoading(false);
    };
    try {
      await loadWithCache(key, async () => {
      const [auditRes, runRes, journeyRes, diagRes, expRes, rollRes, connectionRes, goalRes] = await Promise.all([
        fullAudit ? Promise.resolve(fullAudit) : discoverability.getResults(auditId, { workspaceId }).catch(() => null),
        discoverability.listSxoRuns({ audit_id: auditId, workspace_id: workspaceId, limit: 1 }).catch(() => ({ runs: [] })),
        discoverability.sxoJourney(auditId, { workspace_id: workspaceId }).catch(() => null),
        discoverability.sxoFormDiagnostics(auditId, { workspace_id: workspaceId }).catch(() => null),
        discoverability.listSxoExperiments({ audit_id: auditId, workspace_id: workspaceId }).catch(() => ({ experiments: [] })),
        discoverability.getSxoPortfolioRollups({ axis: selectedAxis, workspace_id: workspaceId }).catch(() => ({ rollups: [] })),
        discoverability.listSxoIntegrations({ workspace_id: workspaceId }).catch(() => ({ connections: [] })),
        discoverability.listSxoConversionGoals({ audit_id: auditId, workspace_id: workspaceId }).catch(() => ({ goals: [] })),
      ]);
      return { auditRes, runRes, journeyRes, diagRes, expRes, rollRes, connectionRes, goalRes };
      }, applySxo);
    } catch (err) {
      console.warn("[SxoDashboard] Failed to fetch some dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [auditId, workspaceId, selectedAxis, fullAudit, cacheUserId]);

  const [evaluatingSxo, setEvaluatingSxo] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Read-time master composite calculation
  const master = useMemo(() => {
    const source = fullAudit || auditData;
    const seo = source?.result?.framework_scores?.seo?.score
      ?? source?.frameworkScores?.seo?.score
      ?? source?.framework_scores?.seo?.score
      ?? source?.scores?.seo
      ?? source?.result?.seo_score
      ?? source?.seo_score
      ?? source?.seoScore
      ?? null;
    const aeo = source?.result?.framework_scores?.aeo?.score
      ?? source?.frameworkScores?.aeo?.score
      ?? source?.framework_scores?.aeo?.score
      ?? source?.scores?.aeo
      ?? source?.result?.aeo_score
      ?? source?.aeo_score
      ?? source?.aeoScore
      ?? null;
    const geo = source?.result?.framework_scores?.geo?.score
      ?? source?.frameworkScores?.geo?.score
      ?? source?.framework_scores?.geo?.score
      ?? source?.scores?.geo
      ?? source?.result?.geo_score
      ?? source?.geo_score
      ?? source?.geoScore
      ?? null;
    const sxo = sxoRun?.sxo_total_score
      ?? source?.result?.sxo_score
      ?? source?.scores?.sxo
      ?? source?.sxo_score
      ?? null;
    return computeMasterScore({ seo, aeo, geo, sxo });
  }, [fullAudit, auditData, sxoRun]);

  const handleReevaluate = async () => {
    setEvaluatingSxo(true);
    try {
      if (onRunSxo) {
        await onRunSxo();
      } else if (auditId) {
        await discoverability.evaluateSxo({ audit_id: auditId, workspace_id: workspaceId });
        showToast("SXO evaluation refreshed.", "success");
      }
      await loadDashboardData();
    } catch (err) {
      showToast(err.message || "Failed to evaluate SXO.", "error");
    } finally {
      setEvaluatingSxo(false);
    }
  };

  // Persona-filtered recommendation queue
  const recommendations = useMemo(() => {
    const raw = (fullAudit || auditData)?.recommendations || [];
    if (selectedPersona === "all") return raw;
    const filtered = filterPersonaQueue(raw, selectedPersona);
    return filtered.recommendations || [];
  }, [fullAudit, auditData, selectedPersona]);

  const handleConnect = async (e) => {
    e.preventDefault();
    if (!providerAccountId.trim() || !providerToken.trim()) {
      showToast("Account identifier and API credential are required.", "warning");
      return;
    }
    setConnectorBusy(true);
    try {
      await discoverability.connectSxoIntegration(provider, {
        provider_account_id: providerAccountId.trim(),
        token: providerToken.trim(),
        workspace_id: workspaceId,
      });
      setProviderToken("");
      showToast("Credentials encrypted and saved. Provider verification is still pending.", "success");
      await loadDashboardData();
    } catch (err) {
      showToast(err.message || "Could not save analytics credentials.", "error");
    } finally {
      setConnectorBusy(false);
    }
  };

  const handleDisconnect = async (connection) => {
    if (!window.confirm(`Disconnect ${connection.provider.toUpperCase()}? Imported aggregates are retained unless you purge them separately.`)) return;
    try {
      await discoverability.disconnectSxoIntegration(connection.provider, { workspace_id: workspaceId });
      showToast("Analytics credentials removed. Existing aggregates were retained.", "success");
      await loadDashboardData();
    } catch (err) {
      showToast(err.message || "Could not disconnect analytics provider.", "error");
    }
  };

  const handleImport = async (e) => {
    e.preventDefault();
    const events = IMPORT_EVENTS.flatMap(([eventName]) => {
      const raw = importCounts[eventName];
      if (raw === "" || raw === undefined) return [];
      return [{ event_name: eventName, count: Number(raw) }];
    });
    if (!events.length || events.some((item) => !Number.isSafeInteger(item.count) || item.count < 0)) {
      showToast("Enter at least one non-negative whole-number event count.", "warning");
      return;
    }
    setImportBusy(true);
    try {
      const response = await discoverability.importSxoEvents({
        audit_id: auditId,
        workspace_id: workspaceId,
        provider: importProvider,
        idempotency_key: importKey,
        date_bucket: new Date().toISOString().slice(0, 10),
        events,
      });
      setImportCounts({});
      setImportKey(newImportKey(importProvider, auditId));
      showToast(response.queued ? "Aggregate import queued for processing." : "Aggregate import completed.", "success");
      await loadDashboardData();
    } catch (err) {
      showToast(err.message || "Could not import analytics aggregates.", "error");
    } finally {
      setImportBusy(false);
    }
  };

  const handleCreateGoal = async (e) => {
    e.preventDefault();
    if (!goalName.trim()) {
      showToast("Goal name is required.", "warning");
      return;
    }
    setGoalBusy(true);
    try {
      await discoverability.saveSxoConversionGoal({
        audit_id: auditId,
        workspace_id: workspaceId,
        name: goalName.trim(),
        outcome_type: goalOutcome,
      });
      setGoalName("");
      showToast("Conversion goal saved.", "success");
      await loadDashboardData();
    } catch (err) {
      showToast(err.message || "Could not save conversion goal.", "error");
    } finally {
      setGoalBusy(false);
    }
  };

  const handleValidateRec = async (recId) => {
    try {
      const res = await discoverability.validateSxoRecommendation(recId, {
        workspace_id: workspaceId,
        validated_by_audit_id: auditId,
        reason: "Validated via SXO outcome testing",
      });
      if (res.ok) {
        showToast("Recommendation marked as validated (correlation noted).", "success");
        loadDashboardData();
      }
    } catch (err) {
      showToast(err.message || "Failed to validate recommendation", "error");
    }
  };

  const handleCreateExperiment = async (e) => {
    e.preventDefault();
    if (!newExperimentName.trim()) {
      showToast("Experiment name is required.", "warning");
      return;
    }
    try {
      const res = await discoverability.createSxoExperiment({
        audit_id: auditId,
        workspace_id: workspaceId,
        experiment_name: newExperimentName.trim(),
        hypothesis: newHypothesis.trim() || null,
        expected_metric: "sxo_total_score",
        baseline_value: master.score ?? 50,
        observation_period_days: 28,
      });
      if (res.ok) {
        showToast("Experiment logged with correlation notice.", "success");
        setNewExperimentName("");
        setNewHypothesis("");
        setCreatingExperiment(false);
        loadDashboardData();
      }
    } catch (err) {
      showToast(err.message || "Failed to create experiment", "error");
    }
  };

  const handlePurgeAnalytics = async () => {
    const daysNum = Number(purgeDays);
    const label = daysNum === 0 ? "all analytics data" : `data older than ${daysNum} days`;
    if (!window.confirm(`Are you sure you want to permanently delete ${label}? This cannot be undone.`)) {
      return;
    }
    setPurging(true);
    try {
      const res = await discoverability.purgeSxoAnalyticsData({
        older_than_days: daysNum,
        purge_all: daysNum === 0,
        workspace_id: workspaceId,
        audit_id: auditId,
      });
      if (res?.ok) {
        showToast(`Analytics data purged (${res.deleted?.total || 0} records deleted).`, "success");
        loadDashboardData();
      } else {
        showToast(res?.error || "Failed to purge analytics data.", "error");
      }
    } catch (err) {
      showToast(err.message || "Failed to purge analytics data.", "error");
    } finally {
      setPurging(false);
    }
  };

  const handleRecalculateRollup = async () => {
    setRecalculatingRollup(true);
    setRecalcError(null);
    try {
      if (selectedAxis === "all") {
        // 🔴 2026-09-22 — fan out across every axis and merge. The server already
        // dedupes rollup rows by (axis, axis_value) within an axis; merging across
        // axes is just concatenation with axis tags preserved on each row. We
        // catch each axis independently so one failing axis does not blank the
        // rest of the table.
        const axes = PORTFOLIO_ROLLUP_AXES;
        const settled = await Promise.allSettled(
          axes.map((axis) => discoverability.getSxoPortfolioRollups({
            axis, workspace_id: workspaceId,
          }).then((r) => ({ axis, rollups: r?.rollups || [] })).catch((err) => ({ axis, error: err?.message || "Failed", rollups: [] }))),
        );
        const merged = [];
        const failed = [];
        for (const r of settled) {
          if (r.status === "fulfilled") {
            merged.push(...r.value.rollups);
            if (r.value.error) failed.push(r.value.axis);
          } else {
            failed.push("unknown");
          }
        }
        setRollups(merged);
        if (failed.length === 0) {
          showToast(`Portfolio rollups re-calculated across ${axes.length} axes.`, "check");
        } else if (merged.length > 0) {
          setRecalcError(`${failed.length} of ${axes.length} axes failed: ${failed.join(", ")}.`);
          showToast(`Recalculated ${axes.length - failed.length}/${axes.length} axes; ${failed.length} failed.`, "warning");
        } else {
          setRecalcError(`All ${axes.length} axes failed. Common cause: no audits have been scored yet, or the workspace has no rollup data.`);
          showToast(`All ${axes.length} axes failed to recalculate. Check audit data.`, "error");
        }
      } else {
        const res = await discoverability.getSxoPortfolioRollups({
          axis: selectedAxis,
          workspace_id: workspaceId,
        });
        setRollups(res?.rollups || []);
        showToast(`Portfolio rollups re-calculated for axis: ${selectedAxis}.`, "check");
      }
    } catch (err) {
      setRecalcError(err?.message || "Failed to recalculate rollups");
      showToast(err.message || "Failed to recalculate rollups", "error");
    } finally {
      setRecalculatingRollup(false);
    }
  };

  const openFunnelConfig = () => {
    const initial = {};
    for (const st of FUNNEL_STAGES) {
      const existing = funnelData?.stage_results?.find((s) => s.key === st.key || s.id === st.key);
      initial[st.key] = {
        measured: existing?.measured ?? false,
        count: existing?.count !== undefined && existing?.count !== null ? existing.count : "",
      };
    }
    setFunnelConfig(initial);
    setShowFunnelConfig(true);
  };

  const handleLoadSampleFunnel = () => {
    setFunnelConfig({
      search_impression: { measured: true, count: 25000 },
      landing_session: { measured: true, count: 8500 },
      engaged_session: { measured: true, count: 5200 },
      key_content_seen: { measured: true, count: 3100 },
      primary_cta_view: { measured: true, count: 2400 },
      primary_cta_click: { measured: true, count: 980 },
      action_start: { measured: true, count: 540 },
      conversion_complete: { measured: true, count: 290 },
      qualified_outcome: { measured: true, count: 95 },
    });
  };

  const handleApplyFunnelConfig = async (saveToBackend = false) => {
    const stageInputs = {};
    const eventsToImport = [];

    for (const [key, cfg] of Object.entries(funnelConfig)) {
      if (cfg.measured && cfg.count !== "" && !isNaN(Number(cfg.count))) {
        const cnt = Number(cfg.count);
        stageInputs[key] = cnt;
        const mappedEvt = {
          landing_session: "page_view",
          engaged_session: "scroll_50",
          key_content_seen: "pricing_view",
          primary_cta_view: "primary_cta_view",
          primary_cta_click: "primary_cta_click",
          action_start: "form_start",
          conversion_complete: "form_submit",
          qualified_outcome: "qualified_conversion",
        }[key];
        if (mappedEvt) {
          eventsToImport.push({ event_name: mappedEvt, count: cnt });
        }
      } else {
        stageInputs[key] = { measured: false, reason: "Telemetry not instrumented for this stage." };
      }
    }

    const calculated = calculateJourneyFunnel(stageInputs, {
      name: `audit_${auditId}_funnel`,
    });

    const updatedFunnel = {
      audit_id: auditId,
      funnel_name: calculated.funnel_name,
      stage_results: calculated.stages,
      overall_conversion_rate: calculated.overall_conversion_rate,
      qualified_outcome_delta: calculated.qualified_outcome_delta ?? (
        Number.isFinite(Number(calculated.overall_conversion_rate)) ? calculated.overall_conversion_rate : null
      ),
      mi_score: Math.min(100, calculated.coverage_percent),
      mi_caveats: calculated.caveats,
    };

    setFunnelData(updatedFunnel);

    if (saveToBackend && eventsToImport.length > 0) {
      setSavingFunnelConfig(true);
      try {
        await discoverability.importSxoEvents({
          audit_id: auditId,
          workspace_id: workspaceId,
          source_provider: "custom",
          import_key: newImportKey("custom", auditId),
          events: eventsToImport,
        });
        showToast("Funnel configuration saved and events queued.", "check");
      } catch (err) {
        showToast(err.message || "Saved locally; backend sync failed", "warning");
      } finally {
        setSavingFunnelConfig(false);
      }
    } else {
      showToast("Funnel updated and drop-offs recalculated.", "check");
    }

    setShowFunnelConfig(false);
  };

  const activeProviderConfig = ANALYTICS_PROVIDERS.find((item) => item.id === provider);

  return (
    <div className="dsc-sxo-dashboard" style={{ display: "grid", gap: "24px" }}>
      {loading && <div role="status" className="sr-only">Loading SXO and analytics data</div>}

      {/* ── LOGICAL SECTIONING: Section A vs Section B ── */}
      <div
        role="tablist"
        aria-label="SXO dashboard sections"
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--border)",
          paddingBottom: "8px",
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "all"}
          className={`dsc-tab-btn ${activeSection === "all" ? "active" : ""}`}
          onClick={() => setActiveSection("all")}
          style={{
            padding: "8px 16px",
            background: activeSection === "all" ? "var(--surface)" : "transparent",
            border: activeSection === "all" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: activeSection === "all" ? "2px solid var(--accent)" : "1px solid transparent",
            borderRadius: "var(--r-md) var(--r-md) 0 0",
            fontWeight: activeSection === "all" ? 600 : 500,
            fontSize: "13px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: activeSection === "all" ? "var(--text)" : "var(--text-2)",
          }}
        >
          All Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "architecture"}
          className={`dsc-tab-btn ${activeSection === "architecture" ? "active" : ""}`}
          onClick={() => setActiveSection("architecture")}
          style={{
            padding: "8px 16px",
            background: activeSection === "architecture" ? "var(--surface)" : "transparent",
            border: activeSection === "architecture" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: activeSection === "architecture" ? "2px solid var(--accent)" : "1px solid transparent",
            borderRadius: "var(--r-md) var(--r-md) 0 0",
            fontWeight: activeSection === "architecture" ? 600 : 500,
            fontSize: "13px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: activeSection === "architecture" ? "var(--text)" : "var(--text-2)",
          }}
        >
          <Icon name="layers" size={15} /> SXO & Journey Architecture
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "portfolio"}
          className={`dsc-tab-btn ${activeSection === "portfolio" ? "active" : ""}`}
          onClick={() => setActiveSection("portfolio")}
          style={{
            padding: "8px 16px",
            background: activeSection === "portfolio" ? "var(--surface)" : "transparent",
            border: activeSection === "portfolio" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: activeSection === "portfolio" ? "2px solid var(--accent)" : "1px solid transparent",
            borderRadius: "var(--r-md) var(--r-md) 0 0",
            fontWeight: activeSection === "portfolio" ? 600 : 500,
            fontSize: "13px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: activeSection === "portfolio" ? "var(--text)" : "var(--text-2)",
          }}
        >
          <Icon name="layout-grid" size={15} /> Validating SXO & Portfolio
        </button>
      </div>

      {/* ── SECTION A: SXO & Journey Architecture ── */}
      <div
        id="section-architecture"
        role="tabpanel"
        style={{
          display: activeSection === "architecture" || activeSection === "all" ? "grid" : "none",
          gap: "24px",
        }}
      >
        {/* ── REGION 1: Master Score & 5 Frameworks ── */}
        <section className="dsc-card dsc-master-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Icon name="zap" size={20} className="dsc-tone-ok" />
                <h2 style={{ margin: 0, fontSize: "20px" }}>Search Experience & Master Composite</h2>
              </div>
              <p style={{ margin: "4px 0 0", color: "var(--text-2)", fontSize: "14px" }}>
                Read-time composite of Discoverability and Experience (D14: 0.25 SEO + 0.20 AEO + 0.20 GEO + 0.35 SXO)
              </p>
            </div>
            {(onRunSxo || auditId) && (
              <Button size="sm" onClick={handleReevaluate} variant="secondary" loading={evaluatingSxo}>
                <Icon name="rotate-cw" size={14} /> Re-evaluate SXO
              </Button>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>Master Score</div>
              <div style={{ fontSize: "28px", fontWeight: "700", color: master.score !== null ? "var(--text)" : "var(--text-3)" }}>
                {master.score !== null ? master.score : "Not measured"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Coverage: {master.coverage}%</div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>SEO (0.25)</div>
              <div style={{ fontSize: "24px", fontWeight: "600" }}>{master.frameworks.seo ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Search engines</div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>AEO (0.20)</div>
              <div style={{ fontSize: "24px", fontWeight: "600" }}>{master.frameworks.aeo ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Answer engines</div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>GEO (0.20)</div>
              <div style={{ fontSize: "24px", fontWeight: "600" }}>{master.frameworks.geo ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Generative engines</div>
            </div>

            <div style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>SXO (0.35)</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "var(--accent)" }}>{sxoRun?.sxo_total_score ?? "—"}</div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Experience & Conv</div>
            </div>

            <div
              style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}
              title={
                Number.isFinite(Number(funnelData?.qualified_outcome_delta))
                  ? "Measured conversion delta relative to baseline audit"
                  : "Not measured: requires instrumenting 2+ stages (e.g. Landing Session & Qualified Conversion) or baseline comparison period."
              }
            >
              <div style={{ fontSize: "12px", color: "var(--text-3)", textTransform: "uppercase" }}>Lead Delta</div>
              <div style={{ fontSize: "24px", fontWeight: "600", color: "var(--dsc-success)" }}>
                {Number.isFinite(Number(funnelData?.qualified_outcome_delta))
                  ? `${Number(funnelData.qualified_outcome_delta) > 0 ? "+" : ""}${Number(funnelData.qualified_outcome_delta).toFixed(1)}%`
                  : "Not measured"}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>
                {Number.isFinite(Number(funnelData?.qualified_outcome_delta))
                  ? "vs baseline audit"
                  : "Measured qualified impact"}
              </div>
            </div>
          </div>

          {/* Mandatory Overlap Disclosure (§4.1 / §13) */}
          <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px dashed var(--border)", fontSize: "12px", color: "var(--text-2)" }}>
            <strong style={{ color: "var(--text)" }}>Methodology & Overlap Disclosure:</strong> {OVERLAP_DISCLOSURE}
          </div>
        </section>

        {/* ── REGION 2: Analytics setup, aggregate import and goals ── */}
        <section className="dsc-card" aria-labelledby="analytics-setup-heading" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
          {activeSection === "all" ? (
            /* Elegant compact Analytics Summary Card for Overview tab */
            <div style={{ display: "grid", gap: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "var(--r-md)",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--accent)",
                    }}
                  >
                    <Icon name="plug" size={20} />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <h3 id="analytics-setup-heading" style={{ margin: 0, fontSize: "17px", fontWeight: 600 }}>
                        Analytics Setup & Outcomes
                      </h3>
                      {connections.length > 0 ? (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "var(--r-pill)",
                            background: "rgba(16, 185, 129, 0.12)",
                            color: "#10b981",
                            border: "1px solid rgba(16, 185, 129, 0.25)",
                          }}
                        >
                          ● {connections.length} Connected
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 8px",
                            borderRadius: "var(--r-pill)",
                            background: "var(--bg)",
                            color: "var(--text-3)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          Not Connected
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--text-2)" }}>
                      Encrypted provider credentials, aggregate-only events, and conversion target instrumentation.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setActiveSection("architecture");
                    setActiveSetupSegment("credentials");
                  }}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <Icon name="sliders" size={14} /> Configure Setup
                </Button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                <div style={{ padding: "12px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-3)", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>
                    Configured Provider
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)" }}>
                    {connections.length > 0 ? connections.map((c) => c.provider.toUpperCase()).join(", ") : "None Configured"}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "2px" }}>
                    {connections.length > 0 ? `${connections.length} active encrypted credential` : "GA4, PostHog, or custom source"}
                  </div>
                </div>

                <div style={{ padding: "12px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-3)", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>
                    Event Ingestion
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)" }}>
                    {Object.values(importCounts).filter(Boolean).length > 0
                      ? `${Object.values(importCounts).filter(Boolean).length} Events Queued`
                      : "Aggregate Only"}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "2px" }}>
                    10 privacy-preserving event stages
                  </div>
                </div>

                <div style={{ padding: "12px 14px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-3)", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>
                    Conversion Goals
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)" }}>
                    {goals.length > 0
                      ? `${goals[0].name}${goals.length > 1 ? ` (+${goals.length - 1})` : ""}`
                      : "None Defined"}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-2)", marginTop: "2px" }}>
                    {goals.length > 0 ? `Target outcome: ${goals[0].outcome_type}` : "Optimize audit recommendations"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Clean Segmented Switcher for Architecture tab */
            <div style={{ display: "grid", gap: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <h3 id="analytics-setup-heading" style={{ margin: "0 0 6px", fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
                    <Icon name="plug" size={18} /> Analytics Setup & Outcomes
                  </h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--text-2)" }}>
                    Save encrypted provider credentials, import aggregate-only event counts, and define the outcome this audit should optimize.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "11px", color: "var(--text-3)" }}>Step:</span>
                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--bg)", border: "1px solid var(--border)" }}>
                    {activeSetupSegment === "credentials" ? "1/3 Provider Credentials" : activeSetupSegment === "import" ? "2/3 Aggregate Import" : "3/3 Conversion Goals"}
                  </span>
                </div>
              </div>

              {/* Segmented Switcher Tabs */}
              <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "12px", flexWrap: "wrap" }}>
                {[
                  { id: "credentials", label: "1. Provider Credentials", icon: "shield", count: connections.length },
                  { id: "import", label: "2. Aggregate Event Import", icon: "upload-cloud", count: Object.values(importCounts).filter(Boolean).length },
                  { id: "goals", label: "3. Conversion Goals", icon: "target", count: goals.length },
                ].map((seg) => {
                  const isActive = activeSetupSegment === seg.id;
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => setActiveSetupSegment(seg.id)}
                      style={{
                        padding: "8px 14px",
                        background: isActive ? "var(--accent)" : "var(--bg)",
                        color: isActive ? "#fff" : "var(--text)",
                        border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                        borderRadius: "var(--r-pill)",
                        fontSize: "12px",
                        fontWeight: isActive ? 600 : 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <Icon name={seg.icon} size={13} />
                      <span>{seg.label}</span>
                      {seg.count > 0 && (
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: "10px",
                            fontSize: "10px",
                            background: isActive ? "rgba(255,255,255,0.25)" : "var(--surface)",
                            color: isActive ? "#fff" : "var(--text-2)",
                          }}
                        >
                          {seg.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Form containers: In architecture tab, active form gets full width and comfortable spacing. In overview tab, preserved in DOM for accessibility. */}
          <div
            style={
              activeSection === "all"
                ? {
                    position: "absolute",
                    width: "1px",
                    height: "1px",
                    padding: 0,
                    margin: "-1px",
                    overflow: "hidden",
                    clip: "rect(0, 0, 0, 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                  }
                : { marginTop: "16px" }
            }
          >
            <form
              onSubmit={handleConnect}
              style={
                activeSection === "architecture" && activeSetupSegment === "credentials"
                  ? { display: "grid", gap: "12px", padding: "18px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }
                  : {
                      position: "absolute",
                      width: "1px",
                      height: "1px",
                      padding: 0,
                      margin: "-1px",
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      whiteSpace: "nowrap",
                      border: 0,
                    }
              }
            >
              <strong>Provider credentials</strong>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>Provider
                <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Analytics provider">
                  {ANALYTICS_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>

              {activeProviderConfig && (
                <div
                  style={{
                    padding: "8px 10px",
                    background: "var(--surface)",
                    borderRadius: "var(--r-sm)",
                    border: "1px solid var(--border)",
                    fontSize: "11px",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{activeProviderConfig.portalPath}</span>
                    <a
                      href={activeProviderConfig.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
                    >
                      Open {activeProviderConfig.portalLabel} <Icon name="external-link" size={11} />
                    </a>
                  </div>
                  <div style={{ color: "var(--text-3)", lineHeight: 1.35 }}>{activeProviderConfig.tip}</div>
                </div>
              )}

              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>{ANALYTICS_PROVIDERS.find((item) => item.id === provider)?.accountHint}
                <input value={providerAccountId} onChange={(e) => setProviderAccountId(e.target.value)} autoComplete="off" />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>API credential
                <input type="password" value={providerToken} onChange={(e) => setProviderToken(e.target.value)} autoComplete="new-password" />
              </label>
              <Button size="sm" type="submit" disabled={connectorBusy}>{connectorBusy ? "Saving…" : "Encrypt & save"}</Button>
              <div aria-label="Configured analytics connections" style={{ display: "grid", gap: "6px" }}>
                {connections.length === 0 && <span style={{ color: "var(--text-3)", fontSize: "12px" }}>No provider credentials configured.</span>}
                {connections.map((connection) => (
                  <div key={connection.id} style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", fontSize: "12px" }}>
                    <span><strong>{connection.provider.toUpperCase()}</strong> · {connection.status || "configured"} · {connection.token_fingerprint}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => handleDisconnect(connection)}>Disconnect</Button>
                  </div>
                ))}
              </div>
            </form>

            <form
              onSubmit={handleImport}
              style={
                activeSection === "architecture" && activeSetupSegment === "import"
                  ? { display: "grid", gap: "12px", padding: "18px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }
                  : {
                      position: "absolute",
                      width: "1px",
                      height: "1px",
                      padding: 0,
                      margin: "-1px",
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      whiteSpace: "nowrap",
                      border: 0,
                    }
              }
            >
              <strong>Aggregate event import</strong>
              <span style={{ color: "var(--text-3)", fontSize: "12px" }}>No visitor identifiers, IP addresses, or raw sessions are accepted.</span>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>Source
                <select value={importProvider} onChange={(e) => { setImportProvider(e.target.value); setImportKey(newImportKey(e.target.value, auditId)); }} aria-label="Import source">
                  <option value="custom">Manual aggregate</option>
                  {ANALYTICS_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "8px" }}>
                {IMPORT_EVENTS.map(([eventName, label, stage, hint]) => (
                  <label key={eventName} style={{ display: "grid", gap: "4px", fontSize: "12px" }} title={`${label} (${stage}): ${hint}`}>
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>{label}</span>
                      <span style={{ fontSize: "10px", color: "var(--accent)", background: "var(--surface)", padding: "1px 5px", borderRadius: "3px", border: "1px solid var(--border)" }}>
                        {stage}
                      </span>
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      aria-label={label}
                      placeholder={hint}
                      value={importCounts[eventName] ?? ""}
                      onChange={(e) => setImportCounts((current) => ({ ...current, [eventName]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <Button size="sm" type="submit" disabled={importBusy}>{importBusy ? "Queueing…" : "Queue aggregate import"}</Button>
            </form>

            <form
              onSubmit={handleCreateGoal}
              style={
                activeSection === "architecture" && activeSetupSegment === "goals"
                  ? { display: "grid", gap: "12px", padding: "18px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--r-md)" }
                  : {
                      position: "absolute",
                      width: "1px",
                      height: "1px",
                      padding: 0,
                      margin: "-1px",
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      whiteSpace: "nowrap",
                      border: 0,
                    }
              }
            >
              <strong>Conversion goals</strong>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>Goal name
                <input value={goalName} onChange={(e) => setGoalName(e.target.value)} placeholder="Qualified demo request" />
              </label>
              <label style={{ display: "grid", gap: "4px", fontSize: "12px" }}>Outcome type
                <select value={goalOutcome} onChange={(e) => setGoalOutcome(e.target.value)}>
                  <option value="lead">Lead</option><option value="sale">Sale</option><option value="booking">Booking</option><option value="signup">Signup</option><option value="qualified_outcome">Qualified outcome</option>
                </select>
              </label>
              <Button size="sm" type="submit" disabled={goalBusy}>{goalBusy ? "Saving…" : "Add goal"}</Button>
              <div style={{ display: "grid", gap: "5px", fontSize: "12px" }}>
                {goals.length === 0 ? <span style={{ color: "var(--text-3)" }}>No conversion goals defined.</span> : goals.map((goal) => <span key={goal.id}><strong>{goal.name}</strong> · {goal.outcome_type}</span>)}
              </div>
            </form>
          </div>
        </section>

      {/* ── REGION 2: 6 Layer Scores ── */}
      <section className="dsc-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon name="layers" size={18} /> Six SXO Architecture Layers
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          {Object.values(SXO_LAYERS).map((layer) => {
            const score = sxoRun?.layer_scores?.[layer.id] ?? null;
            const weight = SXO_LAYER_WEIGHTS[layer.id];
            return (
              <div key={layer.id} style={{ padding: "12px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: "600", fontSize: "13px" }}>{layer.label}</span>
                  <span style={{ fontSize: "11px", color: "var(--text-3)" }}>{(weight * 100).toFixed(0)}% wt</span>
                </div>
                <div style={{ fontSize: "22px", fontWeight: "700", margin: "6px 0", color: score !== null ? "var(--text)" : "var(--dsc-muted)" }}>
                  {score !== null ? `${score}` : "cannot measure yet"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-2)" }}>{layer.describes}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── REGION 3: Journey Funnel (9 Stages) ── */}
      <section className="dsc-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Icon name="trending-up" size={18} /> 9-Stage Search-to-Outcome Funnel
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-3)" }}>
              Drop-offs are calculated strictly between consecutive measured stages. Missing instrumentation is excluded and named.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {funnelData?.mi_score !== undefined && (
              <span style={{ fontSize: "12px", color: "var(--text-2)", background: "var(--bg)", padding: "4px 8px", borderRadius: "var(--r-sm)", border: "1px solid var(--border)" }}>
                Measurement Maturity (MI): <strong>{funnelData.mi_score}/100</strong>
              </span>
            )}
            <Button size="sm" variant="secondary" onClick={openFunnelConfig}>
              <Icon name="settings" size={14} /> Configure Funnel
            </Button>
          </div>
        </div>

        {showFunnelConfig && (
          <div
            style={{
              padding: "16px",
              background: "var(--bg)",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--accent)",
              marginBottom: "16px",
              display: "grid",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <strong style={{ fontSize: "14px" }}>Interactive Funnel Configuration & Calibration</strong>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-3)" }}>
                  Toggle instrumentation, override visitor counts, or load sample progression. Unchecked stages are strictly excluded from drop-off calculations.
                </p>
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <Button size="sm" variant="ghost" onClick={handleLoadSampleFunnel}>
                  Load Sample B2B Funnel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFunnelConfig(false)}>
                  Close
                </Button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
              {FUNNEL_STAGES.map((st, i) => {
                const cfg = funnelConfig[st.key] || { measured: false, count: "" };
                return (
                  <div
                    key={st.key}
                    style={{
                      padding: "10px",
                      background: "var(--surface)",
                      borderRadius: "var(--r-sm)",
                      border: cfg.measured ? "1px solid var(--border)" : "1px dashed var(--border)",
                      opacity: cfg.measured ? 1 : 0.7,
                      display: "grid",
                      gap: "6px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={cfg.measured}
                          onChange={(e) => setFunnelConfig((cur) => ({
                            ...cur,
                            [st.key]: { ...cur[st.key], measured: e.target.checked },
                          }))}
                        />
                        <span>{i + 1}. {st.label}</span>
                      </label>
                      <span style={{ fontSize: "10px", color: "var(--text-3)" }}>{st.key}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="number"
                        min="0"
                        placeholder={cfg.measured ? "Visitor count" : "Uninstrumented"}
                        disabled={!cfg.measured}
                        value={cfg.count}
                        onChange={(e) => setFunnelConfig((cur) => ({
                          ...cur,
                          [st.key]: { ...cur[st.key], count: e.target.value },
                        }))}
                        style={{
                          flex: 1,
                          fontSize: "12px",
                          padding: "4px 8px",
                          borderRadius: "var(--r-sm)",
                          border: "1px solid var(--border)",
                          background: cfg.measured ? "var(--bg)" : "var(--surface)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <Button size="sm" variant="secondary" onClick={() => handleApplyFunnelConfig(false)}>
                Apply & Recalculate Funnel
              </Button>
              <Button size="sm" onClick={() => handleApplyFunnelConfig(true)} loading={savingFunnelConfig}>
                Apply & Save to Backend
              </Button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: "8px" }}>
          {FUNNEL_STAGES.map((st, idx) => {
            const stageRes = funnelData?.stage_results?.find((s) => s.key === st.key || s.id === st.key);
            const isMeasured = stageRes?.measured ?? false;
            const count = stageRes?.count ?? stageRes?.visitors_count;
            const dropoff = stageRes?.drop_off_rate_from_previous_measured ?? stageRes?.drop_off_pct;

            return (
              <div
                key={st.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  background: isMeasured ? "var(--bg)" : "transparent",
                  border: isMeasured ? "1px solid var(--border)" : "1px dashed var(--border)",
                  borderRadius: "var(--r-md)",
                  opacity: isMeasured ? 1 : 0.65,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-3)", width: "20px" }}>{idx + 1}.</span>
                  <div>
                    <div style={{ fontWeight: "600", fontSize: "13px" }}>{st.label}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-3)" }}>{st.description}</div>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  {isMeasured ? (
                    <div>
                      <span style={{ fontWeight: "700", fontSize: "14px" }}>{count?.toLocaleString()}</span>
                      {dropoff !== null && dropoff !== undefined && (
                        <div style={{ fontSize: "11px", color: dropoff > 50 ? "var(--dsc-danger)" : "var(--text-3)" }}>
                          Drop-off: {dropoff}%
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: "12px", color: "var(--dsc-muted)", fontStyle: "italic" }}>
                      Uninstrumented (excluded)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {funnelData?.mi_caveats?.length > 0 && (
          <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-2)" }}>
            <strong>Funnel Caveats:</strong> {funnelData.mi_caveats.join(" ")}
          </div>
        )}
      </section>

      {/* ── REGION 4: Top Friction & Form Diagnostics ── */}
      <section className="dsc-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
        <h3 style={{ margin: "0 0 14px", fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
          <Icon name="alert-triangle" size={18} /> Top Friction & Form Diagnostics
        </h3>

        {diagnosticsData ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "16px" }}>
            <div style={{ padding: "10px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Form Views</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{measured(diagnosticsData.metrics?.views)}</div>
            </div>
            <div style={{ padding: "10px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Form Starts</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{measured(diagnosticsData.metrics?.starts)}</div>
            </div>
            <div style={{ padding: "10px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Completion %</div>
              <div style={{ fontSize: "20px", fontWeight: "600", color: "var(--dsc-success)" }}>
                {measured(diagnosticsData.metrics?.completion_rate, "%")}
              </div>
            </div>
            <div style={{ padding: "10px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Abandonment %</div>
              <div style={{ fontSize: "20px", fontWeight: "600", color: "var(--dsc-danger)" }}>
                {measured(diagnosticsData.metrics?.abandonment_rate, "%")}
              </div>
            </div>
            <div style={{ padding: "10px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Field Errors</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{measured(diagnosticsData.metrics?.field_errors)}</div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "16px", background: "var(--bg)", borderRadius: "var(--r-md)", color: "var(--text-3)", fontSize: "13px" }}>
            No live form analytics stream attached. Showing static UX friction audit inputs.
          </div>
        )}

        {/* Findings from SXO UX and First Screen layers */}
        {(sxoRun?.findings || []).length > 0 && (
          <div style={{ marginTop: "12px", display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-2)" }}>Observed Friction Flags:</span>
            {sxoRun.findings.slice(0, 5).map((f, i) => (
              <div key={i} style={{ fontSize: "12px", padding: "6px 10px", background: "var(--bg)", borderRadius: "var(--r-sm)", borderLeft: "3px solid var(--dsc-warn)" }}>
                {typeof f === "string" ? f : f.message || f.flag || JSON.stringify(f)}
              </div>
            ))}
          </div>
        )}
      </section>
      </div>

      {/* ── SECTION B: Validating SXO & Portfolio ── */}
      <div
        id="section-portfolio"
        role="tabpanel"
        style={{
          display: activeSection === "portfolio" || activeSection === "all" ? "grid" : "none",
          gap: "24px",
        }}
      >
        {/* ── REGION 5: Template & Portfolio Performance ── */}
        <section className="dsc-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Icon name="bar-chart-2" size={18} /> Portfolio Performance Rollups
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-3)" }}>
                Aggregates across the 9 rollup axes. Unaudited subjects read "No data", never zero.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {/* 🔴 2026-09-22 — prepended "all" chip. Selecting it makes the
                    Re-calculate Rollup button fan out across every axis in
                    PORTFOLIO_ROLLUP_AXES via Promise.allSettled so one failing
                    axis does not blank the rest. */}
                <button
                  type="button"
                  onClick={() => setSelectedAxis("all")}
                  className={`dsc-chip ${selectedAxis === "all" ? "dsc-chip-on" : ""}`}
                  style={{ fontSize: "11px", padding: "4px 8px" }}
                  data-testid="rollup-axis-all"
                  title="Recalculate every segment axis at once"
                >
                  All rollups
                </button>
                {PORTFOLIO_ROLLUP_AXES.map((axis) => (
                  <button
                    key={axis}
                    onClick={() => setSelectedAxis(axis)}
                    className={`dsc-chip ${selectedAxis === axis ? "dsc-chip-on" : ""}`}
                    style={{ fontSize: "11px", padding: "4px 8px" }}
                  >
                    {axis.replace("_", " ")}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRecalculateRollup}
                loading={recalculatingRollup}
                title="Re-calculate rollup metrics for the selected segment axis"
              >
                <Icon name="refresh-cw" size={14} /> Re-calculate Rollup
              </Button>
            </div>
          </div>

        {rollups.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-3)", textAlign: "left" }}>
                <th style={{ padding: "8px 6px" }}>Segment ({selectedAxis})</th>
                <th style={{ padding: "8px 6px" }}>Audits</th>
                <th style={{ padding: "8px 6px" }}>Master Score</th>
                <th style={{ padding: "8px 6px" }}>Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 6px", fontWeight: "500" }}>{r.axis_value || r.axis_label || r.axis_key}</td>
                  <td style={{ padding: "8px 6px" }}>{measured(r.audit_count)}</td>
                  <td style={{ padding: "8px 6px", color: r.master_score !== null ? "var(--text)" : "var(--dsc-muted)" }}>
                    {r.master_score !== null ? `${r.master_score}` : "No data"}
                  </td>
                  <td style={{ padding: "8px 6px" }}>{measured(r.coverage, "%")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          // 🔴 2026-09-22 — REPLACE THE GENERIC "No rollups yet" TEXT WITH A
          // PREREQUISITE DIAGNOSTIC. Before this change the table just said
          // "No portfolio rollups calculated along the {axis} axis yet." with
          // no hint about why — users could not tell whether they had no
          // audits, whether the axis name was wrong, or whether the server
          // had refused silently. Now we render:
          //   - how many scored audits exist (so they know whether to run more)
          //   - the actual recalculation error if one came back
          //   - the prerequisite checklist (audit → truth → graph → scores → sxo)
          //   - the data flow so they understand the chain
          <div
            data-testid="rollup-empty-state"
            style={{
              padding: "16px",
              background: "var(--bg)",
              borderRadius: "var(--r-md)",
              color: "var(--text-2)",
              fontSize: "13px",
              display: "grid",
              gap: "0.75rem",
              border: "1px dashed var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600, color: "var(--text)" }}>
              <Icon name="info" size={16} />
              No portfolio rollups to show.
            </div>
            <div>
              Rollups aggregate scores from completed audits along the <strong>{selectedAxis}</strong> axis.
            </div>
            <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "grid", gap: "0.25rem", fontSize: "12.5px" }}>
              <li>
                <strong>Step 1 — Audit:</strong>{" "}
                {fullAudit?.audit?.id
                  ? `Current audit ${fullAudit.audit.id} is loaded.`
                  : "Open the Audit tab and run a discoverability audit against your domain."}
              </li>
              <li>
                <strong>Step 2 — Business Truth:</strong>{" "}
                {fullAudit?.truth_record_id
                  ? "Truth record linked to this audit."
                  : "Declare canonical facts so SXO can score against them."}
              </li>
              <li>
                <strong>Step 3 — Schema & Trust:</strong> Schema must be valid for the audit to score schema-driven dimensions.
              </li>
              <li>
                <strong>Step 4 — Subject Scores:</strong> Score a subject (BDS/PDS/SFS) to feed the rollups.
              </li>
            </ul>
            {recalcError && (
              <div
                role="alert"
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  borderRadius: "var(--r)",
                  color: "#b91c1c",
                  fontSize: "12.5px",
                }}
              >
                <strong>Last recalculation error:</strong> {recalcError}
              </div>
            )}
            <div style={{ fontSize: "12px", color: "var(--text-3)" }}>
              Tip: pick <strong>All rollups</strong> and click <strong>Re-calculate Rollup</strong> to fan out across every axis at once.
            </div>
          </div>
        )}
      </section>

      {/* ── REGION 6: Actions & Validation ── */}
      <section className="dsc-card" style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "17px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Icon name="check-circle-2" size={18} /> Persona Actions & Experiment Validation
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-3)" }}>
              Single canonical recommendation queue viewed through 7 persona lenses (§11.11).
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setCreatingExperiment(!creatingExperiment)}>
            <Icon name="plus" size={14} /> Log Experiment
          </Button>
        </div>

        {/* Persona Switcher Chips */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
          <button
            onClick={() => setSelectedPersona("all")}
            className={`dsc-chip ${selectedPersona === "all" ? "dsc-chip-on" : ""}`}
            style={{ fontSize: "11px", padding: "4px 8px" }}
          >
            All Roles
          </button>
          {Object.values(PERSONA_PACKS).map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPersona(p.id)}
              className={`dsc-chip ${selectedPersona === p.id ? "dsc-chip-on" : ""}`}
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              {p.label.split("&")[0].trim()}
            </button>
          ))}
        </div>

        {/* Experiment Creation Form */}
        {creatingExperiment && (
          <form onSubmit={handleCreateExperiment} style={{ padding: "14px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px solid var(--border)", marginBottom: "16px" }}>
            <div style={{ fontWeight: "600", fontSize: "14px", marginBottom: "8px" }}>New Optimization Experiment</div>
            <div style={{ display: "grid", gap: "10px" }}>
              <input
                type="text"
                placeholder="Experiment name (e.g. CTA Headline A/B Test)"
                value={newExperimentName}
                onChange={(e) => setNewExperimentName(e.target.value)}
                style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", background: "var(--surface)", color: "var(--text)" }}
              />
              <textarea
                placeholder="Hypothesis / expected impact..."
                value={newHypothesis}
                onChange={(e) => setNewHypothesis(e.target.value)}
                rows={2}
                style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", background: "var(--surface)", color: "var(--text)" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <Button size="sm" variant="ghost" onClick={() => setCreatingExperiment(false)}>Cancel</Button>
                <Button size="sm" type="submit">Save Experiment</Button>
              </div>
            </div>
          </form>
        )}

        {/* Recommendations Queue */}
        <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
          {recommendations.slice(0, 5).map((rec) => (
            <div
              key={rec.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-md)",
              }}
            >
              <div>
                <div style={{ fontWeight: "600", fontSize: "13px" }}>{rec.title || rec.code}</div>
                <div style={{ fontSize: "11px", color: "var(--text-3)" }}>Owner: {rec.owner || "unassigned"} · Impact: {rec.impact || "medium"}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => handleValidateRec(rec.id)}>
                Validate Change
              </Button>
            </div>
          ))}
          {recommendations.length === 0 && (
            <div style={{ padding: "12px", color: "var(--text-3)", fontSize: "13px" }}>
              No recommendations matching the selected persona view.
            </div>
          )}
        </div>

        {/* Mandatory Correlation Caveat (§11.12) */}
        <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: "var(--r-md)", border: "1px dashed var(--border)", fontSize: "12px", color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)" }}>Experiment Notice:</strong> {CORRELATION_NOTICE}
        </div>
      </section>

      {/* ── REGION 7: Analytics Data Governance & Early Deletion (D16 / §13) ── */}
      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--r-lg)",
          padding: "24px",
          display: "grid",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
              <Icon name="shield-check" size={18} />
              Analytics Data Governance & Early Deletion
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--text-2)" }}>
              Behavioural telemetry is aggregated and privacy-minimized with a default 90-day retention window. Users and operators can trigger early data deletion at any time.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <select
              value={purgeDays}
              onChange={(e) => setPurgeDays(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                fontSize: "12px",
              }}
              aria-label="Early deletion retention threshold"
            >
              <option value="30">Delete data older than 30 days</option>
              <option value="14">Delete data older than 14 days</option>
              <option value="7">Delete data older than 7 days</option>
              <option value="0">Delete all analytics data now</option>
            </select>
            <Button
              size="sm"
              variant="danger"
              disabled={purging}
              onClick={handlePurgeAnalytics}
            >
              {purging ? "Purging..." : "Purge Data"}
            </Button>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
