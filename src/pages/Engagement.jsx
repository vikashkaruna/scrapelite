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
import * as api from "../lib/engagement/engagementClient.js";
import { PROSPECT_STATUSES, STATUS_METADATA } from "../lib/engagement/stateMachine.js";
import { fmtDate, timeAgo } from "../lib/utils.js";

export default function Engagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();

  const [activeTab, setActiveTab] = useState("board"); // "board" | "approval" | "prospects" | "analytics" | "settings"
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [messages, setMessages] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [syncConfig, setSyncConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  // Selected prospect for timeline drawer
  const [activeProspectId, setActiveProspectId] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);

  // Modals
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDesc, setNewCampaignDesc] = useState("");

  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importing, setImporting] = useState(false);

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
      const [pRes, mRes, aRes, sRes] = await Promise.all([
        api.listProspects(campaignId),
        api.listMessages(campaignId),
        api.getAnalytics(campaignId),
        api.getSyncConfig(campaignId),
      ]);
      setProspects(pRes.prospects || []);
      setMessages(mRes.messages || []);
      setAnalytics(aRes.analytics || aRes || {});
      setSyncConfig(sRes.config || null);
    } catch (e) {
      showToast(e.message || "Failed to load campaign data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      loadCampaignData(selectedCampaignId);
    }
  }, [selectedCampaignId]);

  // Handle incoming state (e.g. from Preview or Dashboard "Engage Prospects")
  useEffect(() => {
    if (location.state?.importProspects && selectedCampaignId) {
      const initial = location.state.importProspects;
      api.addProspects(selectedCampaignId, initial).then(() => {
        showToast(`Imported ${initial.length} contacts into campaign!`);
        loadCampaignData(selectedCampaignId);
      });
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
  const handleSelectProspect = async (prospectId) => {
    setActiveProspectId(prospectId);
    if (!selectedCampaignId) return;
    try {
      const logsRes = await api.getActivityLogs(selectedCampaignId, prospectId);
      setActivityLogs(logsRes.logs || []);
    } catch {
      setActivityLogs([]);
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
      if (activeProspectId === prospectId) {
        const logsRes = await api.getActivityLogs(selectedCampaignId, prospectId);
        setActivityLogs(logsRes.logs || []);
      }
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

  const handleGenerateMessage = async (prospectId, channel, customInstructions) => {
    if (!selectedCampaignId) return;
    try {
      const res = await api.generateProspectMessage(
        selectedCampaignId,
        prospectId,
        channel,
        customInstructions
      );
      showToast("AI outreach message generated!");
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
      showToast("Message approved and scheduled for dispatch!");
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
    try {
      for (const item of pendingQueueItems) {
        await api.approveMessage(selectedCampaignId, item.message.id);
      }
      showToast(`Approved ${pendingQueueItems.length} messages!`);
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Batch approval failed");
    }
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!newCampaignName.trim()) return;
    try {
      const res = await api.createCampaign({
        name: newCampaignName.trim(),
        description: newCampaignDesc.trim(),
      });
      const newCmp = res.campaign || res;
      setCampaigns((prev) => [newCmp, ...prev]);
      setSelectedCampaignId(newCmp.id);
      setShowNewCampaignModal(false);
      setNewCampaignName("");
      setNewCampaignDesc("");
      showToast(`Campaign "${newCmp.name}" created!`);
    } catch (e) {
      showToast(e.message || "Failed to create campaign");
    }
  };

  const handleImportCsv = async (e) => {
    e.preventDefault();
    if (!importCsvText.trim() || !selectedCampaignId) return;
    setImporting(true);
    try {
      // Parse basic CSV: first_name,last_name,email,company,role,phone
      const lines = importCsvText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) throw new Error("CSV input is empty");

      const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim());
        const row = {};
        header.forEach((h, idx) => {
          row[h] = parts[idx] || "";
        });
        if (row.email || row.phone) {
          rows.push(row);
        }
      }

      const res = await api.addProspects(selectedCampaignId, rows);
      showToast(`Successfully imported ${res.imported_count || rows.length} prospects!`);
      setShowImportModal(false);
      setImportCsvText("");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleSaveBrandKit = async (brandKit) => {
    if (!selectedCampaignId) return;
    try {
      await api.updateCampaign(selectedCampaignId, { brand_kit: brandKit });
      showToast("Brand Kit and Tone guidelines saved!");
      await loadCampaigns();
    } catch (e) {
      showToast(e.message || "Failed to save brand kit");
    }
  };

  const handleSaveSync = async (cfg) => {
    if (!selectedCampaignId) return;
    try {
      await api.saveSyncConfig(selectedCampaignId, cfg);
      showToast("Two-way CRM sync settings saved!");
      setSyncConfig(cfg);
    } catch (e) {
      showToast(e.message || "Failed to save sync configuration");
    }
  };

  const handleTriggerSync = async () => {
    if (!selectedCampaignId) return;
    try {
      const res = await api.triggerSync(selectedCampaignId);
      showToast(`Sync complete: ${res.synced_count ?? "records"} updated!`);
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      showToast(e.message || "Sync failed");
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
              <h1 className="eng-page-title">Prospect Engagement Engine</h1>
              <span className="eng-version-pill">v2.4</span>
            </div>
            <p className="eng-page-subtitle">
              Automated multi-channel outreach, AI personalization & bidirectional CRM sync
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
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => setShowNewCampaignModal(true)}
          >
            New Campaign
          </Button>

          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            onClick={() => setShowImportModal(true)}
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
          <span>Brand Kit & Sync</span>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="eng-tab-content">
        {activeTab === "board" && (
          <KanbanBoard
            prospects={prospects}
            onTransition={handleTransitionProspect}
            onSelectProspect={handleSelectProspect}
            onGenerateMessage={handleGenerateMessage}
          />
        )}

        {activeTab === "approval" && (
          <ApprovalQueue
            queueItems={pendingQueueItems}
            onApprove={handleApproveMessage}
            onReject={handleRejectMessage}
            onRegenerate={handleGenerateMessage}
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
            syncConfig={syncConfig}
            onSaveBrandKit={handleSaveBrandKit}
            onSaveSyncConfig={handleSaveSync}
            onTriggerSync={handleTriggerSync}
          />
        )}
      </main>

      {/* Prospect Activity Timeline Drawer */}
      <ProspectTimelineDrawer
        prospect={activeProspectObj}
        activityLogs={activityLogs}
        isOpen={!!activeProspectId}
        onClose={handleCloseDrawer}
        onTransition={handleTransitionProspect}
        onAddNote={handleAddProspectNote}
        onGenerateMessage={handleGenerateMessage}
      />

      {/* Create Campaign Modal */}
      {showNewCampaignModal && (
        <div className="eng-modal-backdrop" onClick={() => setShowNewCampaignModal(false)}>
          <div className="eng-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="eng-modal-header">
              <h3 className="eng-modal-title">Create Outreach Campaign</h3>
              <button className="eng-modal-close" onClick={() => setShowNewCampaignModal(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateCampaign} className="eng-modal-form">
              <div className="eng-form-group">
                <label className="eng-field-label">Campaign Name</label>
                <input
                  type="text"
                  className="eng-input-field"
                  placeholder="e.g. Q4 Healthcare SaaS Leaders"
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  required
                />
              </div>
              <div className="eng-form-group">
                <label className="eng-field-label">Campaign Intent & Description</label>
                <textarea
                  className="eng-textarea-field"
                  rows={3}
                  placeholder="Target audience, persona objectives, key signals..."
                  value={newCampaignDesc}
                  onChange={(e) => setNewCampaignDesc(e.target.value)}
                />
              </div>
              <div className="eng-modal-actions">
                <Button variant="ghost" onClick={() => setShowNewCampaignModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" icon="check">
                  Create Campaign
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Prospects Modal */}
      {showImportModal && (
        <div className="eng-modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="eng-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="eng-modal-header">
              <h3 className="eng-modal-title">Import Prospects</h3>
              <button className="eng-modal-close" onClick={() => setShowImportModal(false)}>
                <Icon name="x" size={16} />
              </button>
            </div>
            <form onSubmit={handleImportCsv} className="eng-modal-form">
              <p className="eng-modal-intro">
                Paste CSV data including headers: <code>first_name,last_name,email,company,role,phone</code>.
                Duplicates will automatically be matched and merged.
              </p>
              <div className="eng-form-group">
                <textarea
                  className="eng-textarea-field"
                  rows={8}
                  placeholder="first_name,last_name,email,company,role,phone&#10;Alice,Smith,alice@acme.com,Acme Corp,VP Engineering,+15551234567&#10;Bob,Jones,bob@apex.io,Apex,CEO,+15559876543"
                  value={importCsvText}
                  onChange={(e) => setImportCsvText(e.target.value)}
                  required
                />
              </div>
              <div className="eng-modal-actions">
                <Button variant="ghost" onClick={() => setShowImportModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={importing} icon="upload">
                  {importing ? "Importing..." : "Import Prospects"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
