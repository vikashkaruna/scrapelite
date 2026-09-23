// src/pages/Engagement.jsx — DatIQ Prospect Engagement Engine Hub
import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import FaviconDot from "../components/FaviconDot.jsx";
import { useToast } from "../components/Toast.jsx";
import KanbanBoard from "../components/engagement/KanbanBoard.jsx";
import ApprovalQueue from "../components/engagement/ApprovalQueue.jsx";
import ProspectTimelineDrawer from "../components/engagement/ProspectTimelineDrawer.jsx";
import AnalyticsPanel from "../components/engagement/AnalyticsPanel.jsx";
import BrandKitEditor from "../components/engagement/BrandKitEditor.jsx";
import SendPanel from "../components/engagement/SendPanel.jsx";
import CampaignModal from "../components/engagement/CampaignModal.jsx";
import ImportProspectsModal from "../components/engagement/ImportProspectsModal.jsx";
import { campaignOptionLabel } from "../lib/engagement/campaignLabels.js";
import { useAuth } from "../components/AuthProvider.jsx";
import * as api from "../lib/engagement/engagementClient.js";
import { PROSPECT_STATUSES, STATUS_METADATA } from "../lib/engagement/stateMachine.js";
import { fmtDate, timeAgo } from "../lib/utils.js";

/** Why generate_messages skipped a prospect, in words. */
const SKIP_COPY = {
  no_live_channel: "This contact has no email address.",
  no_address: "This contact has no email address.",
  opted_out: "This contact has opted out.",
  already_drafted: "There's already an open draft for this contact.",
  suppressed_unsubscribe: "This contact unsubscribed from email.",
  suppressed_bounce: "This contact's email bounced earlier.",
  suppressed_complaint: "This contact marked a previous email as spam.",
  suppressed_manual: "Your team opted this contact out of email.",
};

export default function Engagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const { user, authLoading, openAuth } = useAuth();

  // Beta gate: { enabled, code, message, sender_domains, mock_sending } from the server.
  const [access, setAccess] = useState(null);
  const [sending, setSending] = useState(false);
  const [suppressions, setSuppressions] = useState([]);
  const [consentBusy, setConsentBusy] = useState(false);

  const [activeTab, setActiveTab] = useState("board"); // "board" | "approval" | "prospects" | "analytics" | "settings"
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [messages, setMessages] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(true);

  // Selected prospect for timeline drawer
  const [activeProspectId, setActiveProspectId] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);

  // Modals
  // null | "create" | "edit"
  const [campaignModal, setCampaignModal] = useState(null);

  const [showImportModal, setShowImportModal] = useState(false);

  // Prospects Table controls
  const [prospectSearch, setProspectSearch] = useState("");
  const [prospectStatusFilter, setProspectStatusFilter] = useState("all");
  const [selectedProspectIds, setSelectedProspectIds] = useState(new Set());

  // Load initial campaigns
  const loadCampaigns = async () => {
    try {
      const res = await api.listCampaigns();
      const list = res.campaigns || [];
      setCampaigns(list);
      if (list.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(list[0].id);
      }
    } catch (e) {
      showToast(e.message || "Failed to load campaigns");
    }
  };

  // Load active campaign data
  const loadCampaignData = async (campaignId) => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [pRes, mRes, aRes] = await Promise.all([
        api.listProspects(campaignId),
        api.listMessages(campaignId),
        api.getAnalytics(campaignId),
      ]);
      setProspects(pRes.prospects || []);
      setMessages(mRes.messages || []);
      setAnalytics(aRes || {});
    } catch (e) {
      showToast(e.message || "Failed to load campaign data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;
    let alive = true;
    api.getAccess()
      .then((a) => {
        if (!alive) return;
        setAccess(a);
        if (a.enabled) loadCampaigns();
        else setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setAccess({ enabled: false, code: e.code || "unavailable", message: e.message });
        setLoading(false);
      });
    return () => { alive = false; };
  }, [user, authLoading]);

  useEffect(() => {
    if (selectedCampaignId) {
      loadCampaignData(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // Handle incoming state (e.g. from Preview or Dashboard "Engage Prospects")
  useEffect(() => {
    if (location.state?.importProspects && selectedCampaignId) {
      const initial = location.state.importProspects;
      api.addProspects(selectedCampaignId, initial)
        .then((res) => {
          const added = res.prospects?.length || 0;
          const dup = res.stats?.dupCount || 0;
          const invalid = res.stats?.invalidCount || 0;
          showToast([`Added ${added} of ${initial.length} contacts`, dup && `${dup} already in the campaign`, invalid && `${invalid} without an email or phone`].filter(Boolean).join(" · "));
          loadCampaignData(selectedCampaignId);
        })
        .catch((e) => showToast(`Nothing was imported. ${e.message || ""}`.trim()));
    }
  }, [location.state, selectedCampaignId]);

  const activeCampaign = useMemo(() => {
    return campaigns.find((c) => c.id === selectedCampaignId) || campaigns[0] || null;
  }, [campaigns, selectedCampaignId]);

  // Messages pending approval
  const pendingQueueItems = useMemo(() => {
    const prospectMap = new Map(prospects.map((p) => [p.id, p]));
    return messages
      .filter((m) => m.status === "draft" || m.status === "pending_approval")
      .map((message) => ({
        message,
        prospect: prospectMap.get(message.prospect_id),
      }))
      .filter((item) => !!item.prospect);
  }, [messages, prospects]);

  // Open prospect timeline drawer
  const loadProspectDetail = async (prospectId) => {
    const [logsRes, supRes] = await Promise.allSettled([
      api.getActivityLogs(selectedCampaignId, prospectId),
      api.listSuppressions(prospectId),
    ]);
    setActivityLogs(logsRes.status === "fulfilled" ? logsRes.value.logs || [] : []);
    setSuppressions(supRes.status === "fulfilled" ? supRes.value.suppressions || [] : []);
  };

  const handleSelectProspect = async (prospectId) => {
    setActiveProspectId(prospectId);
    if (!selectedCampaignId) return;
    await loadProspectDetail(prospectId);
  };

  const handleOptOut = async (prospectId, channels, note) => {
    setConsentBusy(true);
    try {
      const res = await api.optOut(prospectId, channels, note);
      showToast(res.allChannels
        ? "Opted out of every channel"
        : `Opted out of ${channels.length} channel${channels.length > 1 ? "s" : ""}`);
      await Promise.all([loadCampaignData(selectedCampaignId), loadProspectDetail(prospectId)]);
    } catch (e) {
      showToast(e.message || "Could not record the opt-out");
    } finally {
      setConsentBusy(false);
    }
  };

  const handleLiftSuppression = async (suppressionId) => {
    setConsentBusy(true);
    try {
      await api.liftSuppression(suppressionId);
      showToast("Opt-out removed");
      if (activeProspectId) await loadProspectDetail(activeProspectId);
    } catch (e) {
      showToast(e.message || "Could not remove the opt-out");
    } finally {
      setConsentBusy(false);
    }
  };

  const handleSend = async (messageIds) => {
    if (!selectedCampaignId) return;
    setSending(true);
    try {
      const res = await api.sendApproved(selectedCampaignId, messageIds);
      const parts = [`${res.sent} sent`];
      if (res.skipped) parts.push(`${res.skipped} not sent`);
      if (res.failed) parts.push(`${res.failed} failed`);
      if (res.remaining || res.deferred) parts.push(`${(res.remaining || 0) + (res.deferred || 0)} will go out shortly`);
      showToast(parts.join(" · "));
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Sending failed");
    } finally {
      setSending(false);
    }
  };

  const handleRetry = async (messageId) => {
    try {
      await api.retryMessage(messageId);
      showToast("Queued to send again");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Could not retry");
    }
  };

  const handleCloseDrawer = () => {
    setActiveProspectId(null);
    setActivityLogs([]);
  };

  const handleTransitionProspect = async (prospectId, newStatus) => {
    if (!selectedCampaignId) return;
    try {
      await api.updateProspectStatus(selectedCampaignId, prospectId, newStatus);
      showToast(`Prospect updated to ${STATUS_METADATA[newStatus]?.label || newStatus}`);
      await loadCampaignData(selectedCampaignId);
      if (activeProspectId === prospectId) await loadProspectDetail(prospectId);
    } catch (e) {
      showToast(e.message || "Transition failed");
    }
  };

  const handleAddProspectNote = async (prospectId, noteText) => {
    if (!selectedCampaignId) return;
    try {
      await api.addProspectNote(selectedCampaignId, prospectId, noteText);
      showToast("Note added to activity log");
      const logsRes = await api.getActivityLogs(selectedCampaignId, prospectId);
      setActivityLogs(logsRes.logs || []);
    } catch (e) {
      showToast(e.message || "Failed to add note");
    }
  };

  const handleGenerateMessage = async (prospectId, channel = "email") => {
    if (!selectedCampaignId) return;
    try {
      const res = await api.generateProspectMessage(selectedCampaignId, prospectId, channel);
      const skipped = res.skipped?.[0];
      if (res.messages?.length) showToast("Draft ready for review in the Approval queue");
      else if (skipped) showToast(SKIP_COPY[skipped.code] || "No draft was created for this contact");
      await loadCampaignData(selectedCampaignId);
      return res;
    } catch (e) {
      showToast(e.message || "Generation failed");
    }
  };

  const handleApproveMessage = async (messageId, edits) => {
    if (!selectedCampaignId) return;
    try {
      await api.approveMessage(selectedCampaignId, messageId, edits);
      showToast("Approved — send it from the panel above the queue");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Approval failed");
    }
  };

  const handleRejectMessage = async (messageId) => {
    if (!selectedCampaignId) return;
    try {
      await api.rejectMessage(selectedCampaignId, messageId);
      showToast("Message rejected and archived");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Rejection failed");
    }
  };

  const handleApproveAll = async () => {
    if (!selectedCampaignId || pendingQueueItems.length === 0) return;
    let approved = 0;
    let refused = 0;
    for (const item of pendingQueueItems) {
      try {
        await api.approveMessage(selectedCampaignId, item.message.id);
        approved += 1;
      } catch {
        // A draft that fails its compliance check stays in the queue for a
        // person to fix — it is counted, not silently dropped.
        refused += 1;
      }
    }
    showToast(refused ? `Approved ${approved} · ${refused} need changes before approval` : `Approved ${approved}`);
    await loadCampaignData(selectedCampaignId);
  };

  // Throws on failure so the dialog can show the server's reason next to the field.
  const handleSaveCampaign = async (payload) => {
    if (campaignModal === "edit" && selectedCampaignId) {
      const res = await api.updateCampaign(selectedCampaignId, payload);
      const updated = res.campaign;
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      showToast(`Campaign "${updated.name}" saved`);
    } else {
      const res = await api.createCampaign(payload);
      const created = res.campaign;
      setCampaigns((prev) => [created, ...prev]);
      setSelectedCampaignId(created.id);
      showToast(`Campaign "${created.name}" created`);
    }
    setCampaignModal(null);
  };

  const handleDeleteCampaign = async () => {
    if (!selectedCampaignId) return;
    const gone = campaigns.find((c) => c.id === selectedCampaignId);
    await api.deleteCampaign(selectedCampaignId);
    const rest = campaigns.filter((c) => c.id !== selectedCampaignId);
    setCampaigns(rest);
    setSelectedCampaignId(rest[0]?.id || null);
    if (!rest.length) { setProspects([]); setMessages([]); setAnalytics({}); }
    setCampaignModal(null);
    showToast(`Campaign "${gone?.name || ""}" deleted`);
  };

  // Returns the server's answer for the dialog's result panel; throws on failure.
  const handleImportRows = async (rows) => {
    const res = await api.addProspects(selectedCampaignId, rows);
    await loadCampaignData(selectedCampaignId);
    return res;
  };

  const handleSaveBrandKit = async (brandKit) => {
    if (!selectedCampaignId) return;
    try {
      await api.updateCampaign(selectedCampaignId, { brand_kit: brandKit });
      showToast("Brand kit saved");
      await loadCampaigns();
    } catch (e) {
      showToast(e.message || "Failed to save brand kit");
    }
  };

  const handleSaveSender = async (sender) => {
    if (!selectedCampaignId) return;
    try {
      await api.updateCampaign(selectedCampaignId, { sender });
      showToast("Sender saved");
      await loadCampaigns();
    } catch (e) {
      showToast(e.message || "Failed to save sender");
    }
  };

  // Filtered prospects for table
  const filteredTableProspects = useMemo(() => {
    return prospects.filter((p) => {
      if (prospectStatusFilter !== "all" && p.status !== prospectStatusFilter) {
        return false;
      }
      if (!prospectSearch) return true;
      const s = prospectSearch.toLowerCase();
      return (
        (p.first_name && p.first_name.toLowerCase().includes(s)) ||
        (p.last_name && p.last_name.toLowerCase().includes(s)) ||
        (p.company && p.company.toLowerCase().includes(s)) ||
        (p.role && p.role.toLowerCase().includes(s)) ||
        (p.email && p.email.toLowerCase().includes(s))
      );
    });
  }, [prospects, prospectStatusFilter, prospectSearch]);

  const activeProspectObj = useMemo(() => {
    return prospects.find((p) => p.id === activeProspectId) || null;
  }, [prospects, activeProspectId]);

  const prospectsById = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);

  // ── Gates: signed out, or not in the beta ──
  if (!authLoading && !user) {
    return (
      <div className="eng-page-root">
        <div className="eng-gate">
          <Icon name="lock" size={22} />
          <h1 className="eng-page-title">Prospect Engagement</h1>
          <p>Sign in to run outreach campaigns.</p>
          <Button variant="primary" onClick={() => openAuth?.("signin")}>Sign in</Button>
        </div>
      </div>
    );
  }
  if (access && !access.enabled) {
    return (
      <div className="eng-page-root">
        <div className="eng-gate">
          <Icon name="lock" size={22} />
          <h1 className="eng-page-title">Prospect Engagement is in private beta</h1>
          <p>{access.message || "It isn't available on this account yet."}</p>
          <Button variant="secondary" onClick={() => navigate("/contact")}>Ask for access</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="eng-page-root">
      {/* Top Header Banner */}
      <header className="eng-page-header">
        <div className="eng-header-left">
          <div className="eng-brand-badge">
            <Icon name="send" size={18} />
          </div>
          <div>
            <div className="eng-title-row">
              <h1 className="eng-page-title">Prospect Engagement</h1>
              <span className="eng-version-pill">Beta</span>
            </div>
            <p className="eng-page-subtitle">
              Email outreach with human review, per-channel opt-out and delivery tracking
            </p>
          </div>
        </div>

        <div className="eng-header-actions">
          {/* Campaign Selector */}
          <div className="eng-campaign-select-wrap">
            <Icon name="layers" size={14} className="eng-campaign-select-icon" />
            <select
              className="eng-campaign-select"
              value={selectedCampaignId || ""}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} title={c.description || undefined}>
                  {campaignOptionLabel(c, campaigns)}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon="pencil"
            onClick={() => setCampaignModal("edit")}
            disabled={!activeCampaign}
            aria-label="Edit campaign"
            title="Rename, describe, pause or delete this campaign"
          >
            Edit
          </Button>

          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => setCampaignModal("create")}
          >
            New Campaign
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            onClick={() => setShowImportModal(true)}
            disabled={!selectedCampaignId}
          >
            Import
          </Button>

          <Button
            variant="ghost"
            size="sm"
            icon="refresh-cw"
            onClick={() => selectedCampaignId && loadCampaignData(selectedCampaignId)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </header>

      {activeCampaign && (
        <p className="eng-campaign-meta">
          <strong>{activeCampaign.name}</strong>
          {activeCampaign.description ? <> — {activeCampaign.description}</> : null}
          <span className="eng-campaign-meta-sub">
            {activeCampaign.created_at ? ` · created ${fmtDate(activeCampaign.created_at)}` : ""}
            {activeCampaign.status && activeCampaign.status !== "active" ? ` · ${activeCampaign.status}` : ""}
            {` · ${prospects.length} prospect${prospects.length === 1 ? "" : "s"}`}
          </span>
        </p>
      )}

      {/* Navigation Tabs */}
      <nav className="eng-tabs-nav" aria-label="Engagement Views">
        <button
          className={`eng-tab-btn ${activeTab === "board" ? "active" : ""}`}
          onClick={() => setActiveTab("board")}
        >
          <Icon name="layout-grid" size={15} />
          <span>Pipeline Board</span>
          <span className="eng-tab-count">{prospects.length}</span>
        </button>

        <button
          className={`eng-tab-btn ${activeTab === "approval" ? "active" : ""}`}
          onClick={() => setActiveTab("approval")}
        >
          <Icon name="shield-check" size={15} />
          <span>Approval Queue</span>
          {pendingQueueItems.length > 0 && (
            <span className="eng-tab-count eng-count-alert">{pendingQueueItems.length}</span>
          )}
        </button>

        <button
          className={`eng-tab-btn ${activeTab === "prospects" ? "active" : ""}`}
          onClick={() => setActiveTab("prospects")}
        >
          <Icon name="users" size={15} />
          <span>Prospects Table</span>
        </button>

        <button
          className={`eng-tab-btn ${activeTab === "analytics" ? "active" : ""}`}
          onClick={() => setActiveTab("analytics")}
        >
          <Icon name="bar-chart" size={15} />
          <span>Analytics & Funnel</span>
        </button>

        <button
          className={`eng-tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          <Icon name="settings" size={15} />
          <span>Brand kit &amp; sender</span>
        </button>
      </nav>

      {/* Main Content Area */}
      {/* A div, not <main>: the app shell already renders the page's <main>. */}
      <div className="eng-tab-content">
        {activeTab === "board" && (
          <KanbanBoard
            prospects={prospects}
            onTransition={handleTransitionProspect}
            onSelectProspect={handleSelectProspect}
            onGenerateMessage={handleGenerateMessage}
          />
        )}

        {activeTab === "approval" && access?.mock_sending && (
          <p className="eng-send-note is-info">
            <Icon name="alert-circle" size={13} /> Test mode: sending is simulated on this environment and no email leaves.
          </p>
        )}
        {activeTab === "approval" && (
          <SendPanel
            messages={messages}
            prospectsById={prospectsById}
            onSend={handleSend}
            onRetry={handleRetry}
            busy={sending}
            senderReady={Boolean(activeCampaign?.sender?.from_email)}
          />
        )}
        {activeTab === "approval" && (
          <ApprovalQueue
            queueItems={pendingQueueItems}
            onApprove={handleApproveMessage}
            onReject={handleRejectMessage}
            onRegenerate={null}
            onApproveAll={pendingQueueItems.length > 0 ? handleApproveAll : null}
            isProcessing={loading}
          />
        )}

        {activeTab === "prospects" && (
          <div className="eng-table-card">
            <div className="eng-table-controls">
              <div className="eng-search-box">
                <Icon name="search" size={14} className="eng-search-icon" />
                <input
                  type="text"
                  placeholder="Filter prospects by name, company, email..."
                  value={prospectSearch}
                  onChange={(e) => setProspectSearch(e.target.value)}
                  className="eng-input-field"
                />
              </div>

              <div className="eng-table-filter-group">
                <select
                  className="eng-select-field"
                  value={prospectStatusFilter}
                  onChange={(e) => setProspectStatusFilter(e.target.value)}
                >
                  <option value="all">All Stages</option>
                  {Object.values(PROSPECT_STATUSES).map((st) => (
                    <option key={st} value={st}>
                      {STATUS_METADATA[st]?.label || st}
                    </option>
                  ))}
                </select>

                <Button
                  variant="secondary"
                  size="sm"
                  icon="download"
                  onClick={() => {
                    const csvContent = "data:text/csv;charset=utf-8," +
                      ["First Name,Last Name,Email,Phone,Company,Role,Status,Score",
                        ...filteredTableProspects.map((p) =>
                          `"${p.first_name || ""}","${p.last_name || ""}","${p.email || ""}","${p.phone || ""}","${p.company || ""}","${p.role || ""}","${p.status}","${p.engagement_score || 0}"`
                        )
                      ].join("\n");
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement("a");
                    link.setAttribute("href", encodedUri);
                    link.setAttribute("download", `datiq_prospects_${activeCampaign?.name || "export"}.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                >
                  Export CSV
                </Button>
              </div>
            </div>

            <div className="eng-table-wrapper">
              <table className="eng-data-table">
                <thead>
                  <tr>
                    <th>Prospect</th>
                    <th>Company & Role</th>
                    <th>Channel</th>
                    <th>Status Stage</th>
                    <th>Score</th>
                    <th>Last Touch</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTableProspects.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="eng-empty-table-cell">
                        No prospects match the filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredTableProspects.map((p) => {
                      const name = `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.email;
                      const stMeta = STATUS_METADATA[p.status] || { label: p.status, color: "var(--text-3)" };
                      return (
                        <tr
                          key={p.id}
                          onClick={() => handleSelectProspect(p.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectProspect(p.id); } }}
                          tabIndex={0}
                          role="button"
                          className="eng-clickable-row"
                        >
                          <td>
                            <div className="eng-table-identity">
                              {p.company && <FaviconDot domain={p.company} size={20} />}
                              <div>
                                <div className="eng-table-name">{name}</div>
                                <div className="eng-table-email">{p.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="eng-table-company">{p.company || "—"}</div>
                            <div className="eng-table-role">{p.role || "—"}</div>
                          </td>
                          <td>
                            <span className={`eng-channel-tag eng-ch-${p.channel_preference || "email"}`}>
                              {(p.channel_preference || "email").toUpperCase()}
                            </span>
                          </td>
                          <td>
                            <span
                              className="eng-status-tag"
                              style={{
                                color: stMeta.color,
                                borderColor: `${stMeta.color}44`,
                                background: `${stMeta.color}15`,
                              }}
                            >
                              {stMeta.label}
                            </span>
                          </td>
                          <td>
                            <span className="eng-score-pill">⚡ {p.engagement_score ?? 0}</span>
                          </td>
                          <td>
                            <span className="eng-table-date">
                              {p.last_contacted_at ? timeAgo(p.last_contacted_at) : "Never"}
                            </span>
                          </td>
                          <td>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="sparkles"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleGenerateMessage(p.id, p.channel_preference || "email");
                              }}
                            >
                              Draft AI
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <AnalyticsPanel
            analytics={analytics}
            campaignTitle={activeCampaign?.name}
            onExportCsv={() => {
              showToast("Analytics export generated!");
            }}
          />
        )}

        {activeTab === "settings" && (
          <BrandKitEditor
            campaign={activeCampaign}
            senderDomains={access?.sender_domains || []}
            onSaveBrandKit={handleSaveBrandKit}
            onSaveSender={handleSaveSender}
          />
        )}
      </div>

      {/* Prospect Activity Timeline Drawer */}
      <ProspectTimelineDrawer
        prospect={activeProspectObj}
        activityLogs={activityLogs}
        isOpen={!!activeProspectId}
        onClose={handleCloseDrawer}
        onTransition={handleTransitionProspect}
        onAddNote={handleAddProspectNote}
        onGenerateMessage={handleGenerateMessage}
        suppressions={suppressions}
        onOptOut={handleOptOut}
        onLiftSuppression={handleLiftSuppression}
        consentBusy={consentBusy}
      />

      {campaignModal && (
        <CampaignModal
          mode={campaignModal}
          campaign={campaignModal === "edit" ? activeCampaign : null}
          campaigns={campaigns}
          prospectCount={prospects.length}
          onSave={handleSaveCampaign}
          onDelete={campaignModal === "edit" ? handleDeleteCampaign : undefined}
          onClose={() => setCampaignModal(null)}
        />
      )}

      {showImportModal && selectedCampaignId && (
        <ImportProspectsModal
          campaignName={activeCampaign?.name}
          onImport={handleImportRows}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  );
}
