// src/pages/Engagement.jsx — Prospect Engagement: campaigns, review, sending, consent.
//
// Page-level rules:
//   - Every action that waits on the server runs through run(label, fn), which
//     shows the "DatIQ is working" card and disables the action buttons, so a
//     slow send cannot be pressed twice.
//   - Failures are toasted with tone "error" — the shared toast used to show a
//     success tick on every failure.
//   - When sending is simulated (ENGAGEMENT_MOCK_SEND on a test environment),
//     a banner says so on EVERY tab, and each simulated send is labelled "Test
//     send". It used to be one line on the Approval tab, so a simulated send
//     read as a delivered one and was reported as "not received".

import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import KanbanBoard from "../components/engagement/KanbanBoard.jsx";
import ApprovalQueue from "../components/engagement/ApprovalQueue.jsx";
import ProspectsTable from "../components/engagement/ProspectsTable.jsx";
import ProspectTimelineDrawer from "../components/engagement/ProspectTimelineDrawer.jsx";
import AnalyticsPanel from "../components/engagement/AnalyticsPanel.jsx";
import BrandKitEditor from "../components/engagement/BrandKitEditor.jsx";
import SendPanel from "../components/engagement/SendPanel.jsx";
import CampaignModal from "../components/engagement/CampaignModal.jsx";
import ImportProspectsModal from "../components/engagement/ImportProspectsModal.jsx";
import EngagementBusy from "../components/engagement/EngagementBusy.jsx";
import * as api from "../lib/engagement/engagementClient.js";
import { STATUS_METADATA } from "../lib/engagement/stateMachine.js";
import { campaignOptionLabel } from "../lib/engagement/campaignLabels.js";
import { fmtDate } from "../lib/utils.js";

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

const TABS = [
  { id: "board", label: "Pipeline", icon: "layout-grid" },
  { id: "approval", label: "Review & send", icon: "shield-check" },
  { id: "prospects", label: "Prospects", icon: "users" },
  { id: "analytics", label: "Results", icon: "bar-chart" },
  { id: "settings", label: "Brand kit & sender", icon: "settings" },
];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Engagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const { user, authLoading, openAuth } = useAuth();

  const [access, setAccess] = useState(null); // { enabled, code, message, sender_domains, mock_sending }
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [messages, setMessages] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("board");

  const [activeProspectId, setActiveProspectId] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [suppressions, setSuppressions] = useState([]);
  const [consentBusy, setConsentBusy] = useState(false);

  const [campaignModal, setCampaignModal] = useState(null); // null | "create" | "edit"
  const [showImportModal, setShowImportModal] = useState(false);

  // ── feedback ───────────────────────────────────────────────────────────────
  const [busyLabel, setBusyLabel] = useState(null);
  const busy = Boolean(busyLabel);
  const ok = (msg, icon) => showToast(msg, icon);
  const fail = (e, fallback) => showToast(e?.message || fallback, undefined, { tone: "error" });
  const run = async (label, fn) => {
    setBusyLabel(label);
    try { return await fn(); } finally { setBusyLabel(null); }
  };

  // ── loading ────────────────────────────────────────────────────────────────
  const loadCampaigns = async () => {
    try {
      const res = await api.listCampaigns();
      const list = res.campaigns || [];
      setCampaigns(list);
      setSelectedCampaignId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list[0]?.id || null));
    } catch (e) {
      fail(e, "Could not load your campaigns");
    } finally {
      setCampaignsLoaded(true);
    }
  };

  const loadCampaignData = async (campaignId) => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [pRes, mRes, aRes] = await Promise.all([
        api.listProspects(campaignId), api.listMessages(campaignId), api.getAnalytics(campaignId),
      ]);
      setProspects(pRes.prospects || []);
      setMessages(mRes.messages || []);
      setAnalytics(aRes || {});
    } catch (e) {
      fail(e, "Could not load this campaign");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return undefined;
    let alive = true;
    api.getAccess()
      .then((a) => { if (alive) { setAccess(a); if (a.enabled) loadCampaigns(); } })
      .catch((e) => { if (alive) setAccess({ enabled: false, code: e.code || "unavailable", message: e.message }); });
    return () => { alive = false; };
  }, [user, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedCampaignId) loadCampaignData(selectedCampaignId);
    else { setProspects([]); setMessages([]); setAnalytics({}); }
  }, [selectedCampaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contacts handed over from Preview / Dashboard ("Engage prospects").
  useEffect(() => {
    const initial = location.state?.importProspects;
    if (!initial || !selectedCampaignId) return;
    run(`Importing ${plural(initial.length, "contact")}…`, async () => {
      try {
        const res = await api.addProspects(selectedCampaignId, initial);
        const added = res.prospects?.length || 0;
        const dup = res.stats?.dupCount || 0;
        const invalid = res.stats?.invalidCount || 0;
        ok([`Added ${added} of ${initial.length} contacts`, dup && `${dup} already in the campaign`, invalid && `${invalid} without an email or phone`].filter(Boolean).join(" · "));
        await loadCampaignData(selectedCampaignId);
      } catch (e) {
        fail(e, "Nothing was imported");
      }
    });
  }, [location.state, selectedCampaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived ────────────────────────────────────────────────────────────────
  const activeCampaign = useMemo(() => campaigns.find((c) => c.id === selectedCampaignId) || null, [campaigns, selectedCampaignId]);
  const prospectsById = useMemo(() => new Map(prospects.map((p) => [p.id, p])), [prospects]);
  const pendingQueueItems = useMemo(() => messages
    .filter((m) => m.status === "draft" || m.status === "pending_approval")
    .map((message) => ({ message, prospect: prospectsById.get(message.prospect_id) }))
    .filter((i) => i.prospect), [messages, prospectsById]);
  /** Prospects whose sent message was simulated — never shown as delivered. */
  const testSentIds = useMemo(() => new Set(messages.filter((m) => m.provider === "mock" && m.sent_at).map((m) => m.prospect_id)), [messages]);
  const activeProspect = activeProspectId ? prospectsById.get(activeProspectId) || null : null;

  // ── prospect detail ────────────────────────────────────────────────────────
  const loadProspectDetail = async (prospectId) => {
    const [logs, sup] = await Promise.allSettled([
      api.getActivityLogs(selectedCampaignId, prospectId), api.listSuppressions(prospectId),
    ]);
    setActivityLogs(logs.status === "fulfilled" ? logs.value.logs || [] : []);
    setSuppressions(sup.status === "fulfilled" ? sup.value.suppressions || [] : []);
  };
  const handleSelectProspect = async (id) => { setActiveProspectId(id); if (selectedCampaignId) await loadProspectDetail(id); };
  const handleCloseDrawer = () => { setActiveProspectId(null); setActivityLogs([]); };

  const handleOptOut = async (prospectId, channels, note) => {
    setConsentBusy(true);
    await run("Saving consent…", async () => {
      try {
        const res = await api.optOut(prospectId, channels, note);
        ok(res.allChannels ? "Opted out of every channel" : `Opted out of ${plural(channels.length, "channel")}`);
        await Promise.all([loadCampaignData(selectedCampaignId), loadProspectDetail(prospectId)]);
      } catch (e) {
        fail(e, "Could not record the opt-out");
      }
    });
    setConsentBusy(false);
  };

  const handleLiftSuppression = async (suppressionId) => {
    setConsentBusy(true);
    await run("Removing the opt-out…", async () => {
      try {
        await api.liftSuppression(suppressionId);
        ok("Opt-out removed");
        if (activeProspectId) await loadProspectDetail(activeProspectId);
      } catch (e) {
        fail(e, "Could not remove the opt-out");
      }
    });
    setConsentBusy(false);
  };

  const handleTransitionProspect = (prospectId, status) => run("Updating stage…", async () => {
    try {
      await api.updateProspectStatus(selectedCampaignId, prospectId, status);
      ok(`Moved to ${STATUS_METADATA[status]?.label || status}`);
      await loadCampaignData(selectedCampaignId);
      if (activeProspectId === prospectId) await loadProspectDetail(prospectId);
    } catch (e) {
      fail(e, "Could not change the stage");
    }
  });

  /** Resolves true when the note was saved, so the drawer clears only then. */
  const handleAddProspectNote = (prospectId, text) => run("Saving note…", async () => {
    try {
      await api.addProspectNote(selectedCampaignId, prospectId, text);
      ok("Note saved");
      await loadProspectDetail(prospectId);
      return true;
    } catch (e) {
      fail(e, "Could not save the note");
      return false;
    }
  });

  // ── messages ───────────────────────────────────────────────────────────────
  const handleGenerateMessage = (prospectId, channel = "email") => run("Drafting the email…", async () => {
    try {
      const res = await api.generateProspectMessage(selectedCampaignId, prospectId, channel);
      const skipped = res.skipped?.[0];
      if (res.messages?.length) ok("Draft ready — review it under Review & send");
      else if (skipped) showToast(SKIP_COPY[skipped.code] || "No draft was created for this contact", undefined, { tone: "warn" });
      await loadCampaignData(selectedCampaignId);
      return res;
    } catch (e) {
      fail(e, "Could not draft the email");
      return null;
    }
  });

  const handleApproveMessage = (messageId, edits) => run("Approving…", async () => {
    try {
      await api.approveMessage(selectedCampaignId, messageId, edits);
      ok("Approved — send it from the panel above");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      fail(e, "Could not approve this draft");
    }
  });

  const handleRejectMessage = (messageId) => run("Rejecting…", async () => {
    try {
      await api.rejectMessage(selectedCampaignId, messageId);
      ok("Draft rejected");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      fail(e, "Could not reject this draft");
    }
  });

  const handleApproveAll = () => run(`Approving ${plural(pendingQueueItems.length, "draft")}…`, async () => {
    let approved = 0;
    let refused = 0;
    for (const item of pendingQueueItems) {
      try { await api.approveMessage(selectedCampaignId, item.message.id); approved += 1; } catch { refused += 1; }
    }
    // A draft that fails its compliance check stays in the queue — counted, not dropped.
    if (refused) showToast(`Approved ${approved} · ${refused} need changes before approval`, undefined, { tone: "warn" });
    else ok(`Approved ${approved}`);
    await loadCampaignData(selectedCampaignId);
  });

  const handleSend = (messageIds) => run(`Sending ${plural(messageIds?.length || 0, "message")}…`, async () => {
    try {
      const res = await api.sendApproved(selectedCampaignId, messageIds);
      const real = (res.sent || 0) - (res.simulated || 0);
      const parts = [];
      if (real) parts.push(`${real} sent`);
      if (res.simulated) parts.push(`${res.simulated} sent in test mode — not delivered`);
      if (res.skipped) parts.push(`${res.skipped} not sent`);
      if (res.failed) parts.push(`${res.failed} failed`);
      if (res.remaining || res.deferred) parts.push(`${(res.remaining || 0) + (res.deferred || 0)} will go out shortly`);
      const tone = res.failed || res.skipped ? "warn" : res.simulated ? "info" : null;
      showToast(parts.join(" · ") || "Nothing to send", undefined, tone ? { tone } : undefined);
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      fail(e, "Sending failed");
    }
  });

  const handleRetry = (messageId) => run("Queueing again…", async () => {
    try {
      await api.retryMessage(messageId);
      ok("Queued to send again");
      await loadCampaignData(selectedCampaignId);
    } catch (e) {
      fail(e, "Could not retry");
    }
  });

  // ── campaigns ──────────────────────────────────────────────────────────────
  // Throws on failure so the dialog can show the server's reason next to the field.
  const handleSaveCampaign = (payload) => run(campaignModal === "edit" ? "Saving campaign…" : "Creating campaign…", async () => {
    if (campaignModal === "edit" && selectedCampaignId) {
      const res = await api.updateCampaign(selectedCampaignId, payload);
      setCampaigns((prev) => prev.map((c) => (c.id === res.campaign.id ? res.campaign : c)));
      ok(`Saved “${res.campaign.name}”`);
    } else {
      const res = await api.createCampaign(payload);
      setCampaigns((prev) => [res.campaign, ...prev]);
      setSelectedCampaignId(res.campaign.id);
      ok(`Created “${res.campaign.name}”`);
    }
    setCampaignModal(null);
  });

  const handleDeleteCampaign = () => run("Deleting campaign…", async () => {
    const gone = activeCampaign;
    await api.deleteCampaign(selectedCampaignId);
    const rest = campaigns.filter((c) => c.id !== selectedCampaignId);
    setCampaigns(rest);
    setSelectedCampaignId(rest[0]?.id || null);
    setCampaignModal(null);
    ok(`Deleted “${gone?.name || "campaign"}”`);
  });

  // Returns the server's answer for the dialog's result panel; throws on failure.
  const handleImportRows = (rows) => run(`Importing ${plural(rows.length, "contact")}…`, async () => {
    const res = await api.addProspects(selectedCampaignId, rows);
    await loadCampaignData(selectedCampaignId);
    return res;
  });

  const handleSaveBrandKit = (brandKit) => run("Saving brand kit and refreshing drafts…", async () => {
    try {
      const res = await api.updateCampaign(selectedCampaignId, { brand_kit: brandKit });
      const r = res.refresh || {};
      const parts = ["Brand kit saved"];
      if (r.refreshed) parts.push(`${plural(r.refreshed, "draft")} updated`);
      if (r.backToReview) parts.push(`${plural(r.backToReview, "approved message")} updated and back in review`);
      if (r.keptEdited) parts.push(`${plural(r.keptEdited, "hand-edited draft")} left as written`);
      ok(parts.join(" · "));
      await Promise.all([loadCampaigns(), loadCampaignData(selectedCampaignId)]);
    } catch (e) {
      fail(e, "Could not save the brand kit");
    }
  });

  const handleSaveSender = (sender) => run("Saving sender…", async () => {
    try {
      await api.updateCampaign(selectedCampaignId, { sender });
      ok("Sender saved");
      await loadCampaigns();
    } catch (e) {
      fail(e, "Could not save the sender");
    }
  });

  // ── gates ──────────────────────────────────────────────────────────────────
  if (!authLoading && !user) {
    return (
      <div className="engx-page">
        <div className="engx-empty is-gate">
          <Icon name="lock" size={22} />
          <h1>Prospect Engagement</h1>
          <p>Sign in to run outreach campaigns.</p>
          <Button variant="primary" onClick={() => openAuth?.("signin")}>Sign in</Button>
        </div>
      </div>
    );
  }
  if (access && !access.enabled) {
    return (
      <div className="engx-page">
        <div className="engx-empty is-gate">
          <Icon name="lock" size={22} />
          <h1>Prospect Engagement is in private beta</h1>
          <p>{access.message || "It isn't available on this account yet."}</p>
          <Button variant="secondary" onClick={() => navigate("/contact")}>Ask for access</Button>
        </div>
      </div>
    );
  }

  const pendingCount = pendingQueueItems.length;
  const noCampaigns = campaignsLoaded && campaigns.length === 0;

  return (
    <div className="engx-page">
      <header className="engx-head">
        <div className="engx-head-title">
          <span className="engx-head-mark" aria-hidden="true"><Icon name="send" size={18} /></span>
          <div>
            <div className="engx-head-row">
              <h1>Prospect Engagement</h1>
              <span className="engx-beta">Beta</span>
            </div>
            <p>Email outreach with human review, per-channel consent and delivery tracking.</p>
          </div>
        </div>
        <div className="engx-head-actions">
          <Button type="button" variant="secondary" size="sm" icon="plus" onClick={() => setCampaignModal("create")} disabled={busy}>New campaign</Button>
          <Button type="button" variant="primary" size="sm" icon="upload" onClick={() => setShowImportModal(true)} disabled={!selectedCampaignId || busy}>Import</Button>
        </div>
      </header>

      {access?.mock_sending && (
        <div className="engx-banner is-warn" role="note">
          <Icon name="flask" size={15} />
          <div>
            <strong>Test mode — no email leaves this environment.</strong>
            <span> Sends are simulated and labelled “Test send”. To deliver for real, turn off <code>ENGAGEMENT_MOCK_SEND</code> and use a sender on a domain verified in Resend.</span>
          </div>
        </div>
      )}

      {noCampaigns ? (
        <div className="engx-empty">
          <Icon name="layers" size={22} />
          <h2>Create your first campaign</h2>
          <p>A campaign holds a list of prospects, the sender they hear from and the brand kit their drafts are written with.</p>
          <Button type="button" variant="primary" icon="plus" onClick={() => setCampaignModal("create")}>New campaign</Button>
        </div>
      ) : (
        <>
          <div className="engx-campaign-bar">
            <label className="engx-campaign-pick">
              <span className="engx-eyebrow">Campaign</span>
              <select className="engx-select is-strong" value={selectedCampaignId || ""} onChange={(e) => setSelectedCampaignId(e.target.value)} aria-label="Campaign">
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id} title={c.description || undefined}>{campaignOptionLabel(c, campaigns)}</option>
                ))}
              </select>
            </label>
            {activeCampaign && (
              <div className="engx-campaign-meta">
                <span className={`engx-status is-${activeCampaign.status || "active"}`}>{activeCampaign.status || "active"}</span>
                {activeCampaign.description && <span className="engx-campaign-desc" title={activeCampaign.description}>{activeCampaign.description}</span>}
                <span className="engx-muted">
                  {plural(prospects.length, "prospect")}
                  {activeCampaign.created_at ? ` · created ${fmtDate(activeCampaign.created_at)}` : ""}
                  {activeCampaign.sender?.from_email ? ` · from ${activeCampaign.sender.from_email}` : " · no sender yet"}
                </span>
              </div>
            )}
            <div className="engx-campaign-actions">
              <Button type="button" variant="ghost" size="sm" icon="pencil" onClick={() => setCampaignModal("edit")} disabled={!activeCampaign || busy}
                aria-label="Edit campaign" title="Rename, describe, pause or delete this campaign">Edit</Button>
              <button type="button" className="engx-icon-btn" onClick={() => loadCampaignData(selectedCampaignId)} disabled={loading || !selectedCampaignId}
                aria-label="Refresh" title="Refresh"><Icon name="refresh-cw" size={15} /></button>
            </div>
          </div>

          <div className="engx-tabs" role="tablist" aria-label="Engagement views">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`engx-tab-${t.id}`} aria-selected={activeTab === t.id} aria-controls="engx-tabpanel"
                className={`engx-tab ${activeTab === t.id ? "is-active" : ""}`} onClick={() => setActiveTab(t.id)}>
                <Icon name={t.icon} size={15} />
                <span>{t.label}</span>
                {t.id === "board" && <span className="engx-count">{prospects.length}</span>}
                {t.id === "approval" && pendingCount > 0 && <span className="engx-count is-accent">{pendingCount}</span>}
              </button>
            ))}
          </div>

          {/* A div, not <main>: the app shell already renders the page's <main>. */}
          <div className="engx-tabpanel" id="engx-tabpanel" role="tabpanel" aria-labelledby={`engx-tab-${activeTab}`}>
            {activeTab === "board" && (
              <KanbanBoard prospects={prospects} testSentIds={testSentIds} busy={busy}
                onTransition={handleTransitionProspect} onSelectProspect={handleSelectProspect} onGenerateMessage={handleGenerateMessage} />
            )}
            {activeTab === "approval" && (
              <>
                <SendPanel messages={messages} prospectsById={prospectsById} onSend={handleSend} onRetry={handleRetry}
                  busy={busy} senderReady={Boolean(activeCampaign?.sender?.from_email)} />
                <ApprovalQueue queueItems={pendingQueueItems} onApprove={handleApproveMessage} onReject={handleRejectMessage}
                  onRegenerate={null} onApproveAll={pendingCount > 0 ? handleApproveAll : null} isProcessing={busy || loading} />
              </>
            )}
            {activeTab === "prospects" && (
              <ProspectsTable prospects={prospects} campaignName={activeCampaign?.name || "campaign"} testSentIds={testSentIds} busy={busy}
                onSelectProspect={handleSelectProspect} onGenerateMessage={handleGenerateMessage} />
            )}
            {activeTab === "analytics" && <AnalyticsPanel analytics={analytics} campaignTitle={activeCampaign?.name || "campaign"} />}
            {activeTab === "settings" && (
              <BrandKitEditor campaign={activeCampaign} senderDomains={access?.sender_domains || []}
                onSaveBrandKit={handleSaveBrandKit} onSaveSender={handleSaveSender} />
            )}
          </div>
        </>
      )}

      <ProspectTimelineDrawer
        prospect={activeProspect}
        activityLogs={activityLogs}
        isOpen={Boolean(activeProspectId)}
        onClose={handleCloseDrawer}
        onTransition={handleTransitionProspect}
        onAddNote={handleAddProspectNote}
        onGenerateMessage={handleGenerateMessage}
        suppressions={suppressions}
        onOptOut={handleOptOut}
        onLiftSuppression={handleLiftSuppression}
        consentBusy={consentBusy}
        busy={busy}
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
        <ImportProspectsModal campaignName={activeCampaign?.name} onImport={handleImportRows} onClose={() => setShowImportModal(false)} />
      )}

      <EngagementBusy label={busyLabel || (loading && !campaignsLoaded ? "Loading your campaigns…" : null)} />
    </div>
  );
}
