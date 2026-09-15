// LocalDirectoryPanel.jsx — Local & Directory Intelligence (W12 / CP-1.4c).
// Displays NAP consistency, directory matches, correction packs, and local checks.
// 🔴 Rule: Render coverageClaim() verbatim. Unchecked sources are excluded and named, never scored 0.
//
// ⚠️ READ THE STORED SHAPE, NOT AN IMAGINED ONE. This panel read a match
// "state", a finding "code"/"description"/"suggested value" under names 0058
// never stored, and resolved findings with a value the route rejects.
// `runLocalCheck` also returns `score` as an OBJECT from napScore(), so the
// completion toast printed "NaN%".

import { useState, useEffect, useCallback, useContext } from "react";
import { AuthContext } from "../AuthProvider.jsx";
import { cacheKey, readCache, loadWithCache } from "../../lib/discoverability/tabCache.js";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";
import { useToast } from "../Toast.jsx";
import { discoverability } from "../../lib/discoverability/discoverabilityClient.js";
import { DIRECTORY_SOURCES, coverageClaim } from "../../lib/discoverability/directorySources.js";
import { LOCAL_FINDING_CODES } from "../../lib/discoverability/napModel.js";

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

export const DIRECTORY_PORTALS = {
  google_business_profile: {
    portalUrl: "https://business.google.com/",
    portalName: "Google Business Profile",
    actionHint: "Claim & manage official profile on Google Search & Maps",
  },
  gbp: {
    portalUrl: "https://business.google.com/",
    portalName: "Google Business Profile",
    actionHint: "Claim & manage official profile on Google Search & Maps",
  },
  bing_places: {
    portalUrl: "https://www.bingplaces.com/",
    portalName: "Bing Places for Business",
    actionHint: "Add or update listing on Bing Places",
  },
  apple_business_connect: {
    portalUrl: "https://businessconnect.apple.com/",
    portalName: "Apple Business Connect",
    actionHint: "Manage business location and actions in Apple Maps",
  },
  justdial: {
    portalUrl: "https://www.justdial.com/",
    portalName: "Justdial",
    actionHint: "Claim or update business phone, address & categories",
  },
  indiamart: {
    portalUrl: "https://www.indiamart.com/",
    portalName: "IndiaMART",
    actionHint: "Manage supplier profile, catalog & GST verification",
  },
  sulekha: {
    portalUrl: "https://www.sulekha.com/",
    portalName: "Sulekha",
    actionHint: "Update service locations and verified business phone",
  },
  tradeindia: {
    portalUrl: "https://www.tradeindia.com/",
    portalName: "TradeIndia",
    actionHint: "Manage B2B listings, export profiles & trade certificates",
  },
  mca: {
    portalUrl: "https://www.mca.gov.in/",
    portalName: "Ministry of Corporate Affairs (MCA)",
    actionHint: "Statutory company registration & registered office records",
  },
  gst_portal: {
    portalUrl: "https://www.gst.gov.in/",
    portalName: "GST Services Portal",
    actionHint: "GST registration certificate & taxpayer principal place of business",
  },
  practo: {
    portalUrl: "https://www.practo.com/",
    portalName: "Practo",
    actionHint: "Manage clinic/hospital listing and consulting hours",
  },
  zomato: {
    portalUrl: "https://www.zomato.com/",
    portalName: "Zomato for Business",
    actionHint: "Claim restaurant location, operating hours & contact info",
  },
  magicbricks: {
    portalUrl: "https://www.magicbricks.com/",
    portalName: "MagicBricks",
    actionHint: "Manage agency profile and office location",
  },
  clutch: {
    portalUrl: "https://clutch.co/",
    portalName: "Clutch",
    actionHint: "Claim service agency profile & verify reviews",
  },
  g2: {
    portalUrl: "https://www.g2.com/",
    portalName: "G2",
    actionHint: "Claim software product vendor profile & specifications",
  },
  facebook_page: {
    portalUrl: "https://www.facebook.com/",
    portalName: "Facebook Page Manager",
    actionHint: "Set official business page address, phone & website",
  },
  linkedin_company: {
    portalUrl: "https://www.linkedin.com/",
    portalName: "LinkedIn Company Page",
    actionHint: "Maintain corporate headquarters and branch locations",
  },
  trustpilot: {
    portalUrl: "https://www.trustpilot.com/",
    portalName: "Trustpilot",
    actionHint: "Claim consumer review profile and official company domain",
  },
  glassdoor: {
    portalUrl: "https://www.glassdoor.com/",
    portalName: "Glassdoor",
    actionHint: "Manage employer profile, headquarters and phone details",
  },
};

/**
 * Why a source does not apply. Offered as choices so an ignore is quick, but
 * always recorded — 0076 refuses an ignore without a reason.
 */
export const IGNORE_REASONS = Object.freeze([
  "Not relevant to our industry",
  "We don't operate in this region",
  "Not a local / walk-in business",
  "Covered by another listing we maintain",
  "Other — not applicable to this business",
]);

const TIER_LABELS = {
  authoritative: "Authoritative",
  major_aggregator: "Major Aggregator",
  aggregator: "Aggregator",
  registry: "Official Registry",
  vertical: "Vertical Directory",
  social_review: "Social & Review",
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
  const [selectedTier, setSelectedTier] = useState("all");
  const [editingSourceId, setEditingSourceId] = useState(null);
  const [urlInputs, setUrlInputs] = useState({});
  const [savingSourceId, setSavingSourceId] = useState(null);
  const [ignores, setIgnores] = useState([]);
  const [ignoringSourceId, setIgnoringSourceId] = useState(null);
  const [ignoreReason, setIgnoreReason] = useState(IGNORE_REASONS[0]);
  const [busyIgnoreId, setBusyIgnoreId] = useState(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const cacheUserId = useContext(AuthContext)?.user?.id || null;

  // Paint the last-seen schema and truth records from localStorage, then refresh from the database.
  const loadInitial = useCallback(async () => {
    const key = cacheKey("local.initial", { userId: cacheUserId, workspaceId });
    if (!readCache(key)) setLoading(true);
    try {
      await loadWithCache(key,
        async () => {
          const [schemaRes, trRes] = await Promise.all([
            discoverability.localDirectorySchema().catch(() => null),
            discoverability.listTruthRecords({ workspace_id: workspaceId }).catch(() => ({ records: [] })),
          ]);
          return { schemaRes, trRes };
        },
        ({ schemaRes, trRes }) => {
          setSchema(schemaRes);
          const records = trRes?.records || [];
          setTruthRecords(records);
          setSelectedRecordId((current) => (
            current && records.some((r) => r.id === current) ? current : records[0]?.id || ""
          ));
          setLoading(false);
        });
    } catch (err) {
      showToast(err.message || "Failed to load directory metadata", "error");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showToast, cacheUserId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadRecordDetails = useCallback(async (trId) => {
    if (!trId) return;
    try {
      await loadWithCache(cacheKey("local.record", { userId: cacheUserId, workspaceId }, trId),
        async () => {
          const [listingsRes, checksRes, ignoresRes] = await Promise.all([
            discoverability.listDirectoryListings({ truth_record_id: trId, workspace_id: workspaceId }),
            discoverability.listLocalChecks({ truth_record_id: trId, workspace_id: workspaceId }),
            (discoverability.listDirectoryIgnores
              ? discoverability.listDirectoryIgnores({ truth_record_id: trId, workspace_id: workspaceId })
              : Promise.resolve({ ignores: [] })).catch(() => ({ ignores: [] })),
          ]);
          const chks = checksRes?.checks || [];
          const full = chks.length > 0
            ? await discoverability.getLocalCheck(chks[0].id, { workspace_id: workspaceId })
            : null;
          return { listingsRes, checksRes, ignoresRes, full };
        },
        ({ listingsRes, checksRes, ignoresRes, full }) => {
          setListings(listingsRes?.listings || []);
          setChecks(checksRes?.checks || []);
          setIgnores(ignoresRes?.ignores || []);
          setSelectedCheck(full || null);
        });
    } catch {
      // Best-effort
    }
  }, [workspaceId, cacheUserId]);

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

  const handleSaveListingUrl = async (sourceId) => {
    const rawUrl = urlInputs[sourceId] ?? listings.find((l) => (l.source_id || l.sourceId) === sourceId)?.listing_url ?? "";
    let trimmed = String(rawUrl || "").trim();
    if (!trimmed) {
      showToast("Please provide a valid listing URL to declare.", "warning");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = "https://" + trimmed;
    }
    if (!selectedRecordId) {
      showToast("Please select a truth record to associate this listing with.", "warning");
      return;
    }
    setSavingSourceId(sourceId);
    try {
      await discoverability.upsertDirectoryListing({
        truth_record_id: selectedRecordId,
        source_id: sourceId,
        listing_url: trimmed,
        acquisition: "declared_url",
        workspace_id: workspaceId,
      });
      showToast("Listing URL declared successfully.", "check");
      setEditingSourceId(null);
      await loadRecordDetails(selectedRecordId);
    } catch (err) {
      showToast(err.message || "Failed to save directory listing URL", "error");
    } finally {
      setSavingSourceId(null);
    }
  };

  const handleIgnoreSource = async (sourceId) => {
    if (!selectedRecordId) {
      showToast("Please select a truth record first.", "warning");
      return;
    }
    setBusyIgnoreId(sourceId);
    try {
      await discoverability.ignoreDirectorySource({
        truth_record_id: selectedRecordId,
        source_id: sourceId,
        reason: ignoreReason,
        workspace_id: workspaceId,
      });
      showToast("Source marked not applicable — it is excluded from NAP checks.", "check");
      setIgnoringSourceId(null);
      await loadRecordDetails(selectedRecordId);
    } catch (err) {
      showToast(err.message || "Could not ignore this source", "error");
    } finally {
      setBusyIgnoreId(null);
    }
  };

  const handleRestoreSource = async (sourceId) => {
    setBusyIgnoreId(sourceId);
    try {
      await discoverability.restoreDirectorySource({
        truth_record_id: selectedRecordId,
        source_id: sourceId,
        workspace_id: workspaceId,
      });
      showToast("Source restored — it will be included in the next NAP check.", "check");
      await loadRecordDetails(selectedRecordId);
    } catch (err) {
      showToast(err.message || "Could not restore this source", "error");
    } finally {
      setBusyIgnoreId(null);
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

  const allSources = (schema?.sources && schema.sources.length > 0) ? schema.sources : DIRECTORY_SOURCES;
  const tiersPresent = Array.from(new Set(allSources.map((s) => s.tier).filter(Boolean)));
  const ignoredById = new Map(ignores.map((i) => [i.source_id, i]));
  const tierSources = selectedTier === "all" ? allSources : allSources.filter((s) => s.tier === selectedTier);
  // Ignored sources sink to the bottom and are hidden until asked for, so the
  // list shows what still needs attention first.
  const displayedSources = [
    ...tierSources.filter((s) => !ignoredById.has(s.id)),
    ...(showIgnored ? tierSources.filter((s) => ignoredById.has(s.id)) : []),
  ];

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
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "1.5rem" }}>
          {/* Matches & Listings */}
          <div className="dsc-panel" style={{ padding: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
                Directory Sources ({allSources.length - ignoredById.size} Applicable{ignoredById.size > 0 ? ` · ${ignoredById.size} ignored` : ""})
              </h3>
              {ignoredById.size > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowIgnored((v) => !v)}
                  aria-pressed={showIgnored}
                >
                  {showIgnored ? "Hide ignored" : `Show ignored (${ignoredById.size})`}
                </button>
              )}
              {tiersPresent.length > 1 && (
                <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setSelectedTier("all")}
                    style={{
                      cursor: "pointer",
                      border: "1px solid var(--border)",
                      background: selectedTier === "all" ? "var(--accent)" : "var(--bg)",
                      color: selectedTier === "all" ? "#fff" : "var(--text-sub)",
                      padding: "0.15rem 0.45rem",
                      fontSize: "0.725rem",
                      borderRadius: "999px",
                    }}
                  >
                    All ({allSources.length})
                  </button>
                  {tiersPresent.map((tierKey) => {
                    const count = allSources.filter((s) => s.tier === tierKey).length;
                    const isSel = selectedTier === tierKey;
                    return (
                      <button
                        key={tierKey}
                        type="button"
                        onClick={() => setSelectedTier(tierKey)}
                        style={{
                          cursor: "pointer",
                          border: "1px solid var(--border)",
                          background: isSel ? "var(--accent)" : "var(--bg)",
                          color: isSel ? "#fff" : "var(--text-sub)",
                          padding: "0.15rem 0.45rem",
                          fontSize: "0.725rem",
                          borderRadius: "999px",
                        }}
                      >
                        {TIER_LABELS[tierKey] || tierKey} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: "0.75rem" }}>
              {displayedSources.map((src) => {
                const match = selectedCheck?.matches?.find((m) => (m.source_id || m.sourceId) === src.id);
                const existingListing = listings.find((l) => (l.source_id || l.sourceId) === src.id);
                const portal = DIRECTORY_PORTALS[src.id];
                const isEditing = editingSourceId === src.id;
                const ignored = ignoredById.get(src.id) || null;

                return (
                  <div
                    key={src.id}
                    style={{
                      display: "grid",
                      gap: "0.5rem",
                      padding: "0.75rem",
                      background: "var(--bg)",
                      borderRadius: "var(--r)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "0.875rem", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                          <span>{src.label}</span>
                          <span
                            style={{
                              fontSize: "0.7rem",
                              padding: "0.1rem 0.4rem",
                              borderRadius: "4px",
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              color: "var(--text-sub)",
                              fontWeight: 500,
                            }}
                          >
                            {TIER_LABELS[src.tier] || src.tier}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "0.2rem" }}>
                          Acquisition: <strong>{String(src.acquisition || "").replace(/_/g, " ")}</strong>
                        </div>
                      </div>
                      <div>
                        {ignored ? (
                          <span className="dsc-pill dsc-pill-ignored" title={ignored.reason}>
                            Not applicable
                          </span>
                        ) : match ? (
                          <span className={`dsc-pill dsc-pill-${matchState(match)}`}>
                            {MATCH_LABELS[matchState(match)]}
                          </span>
                        ) : (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-sub)", fontStyle: "italic" }}>
                            Unchecked (excluded)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Applicability — ignore a source that does not fit this business */}
                    {ignored ? (
                      <div className="dsc-dir-ignored" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-sub)", flexWrap: "wrap" }}>
                        <span>
                          <Icon name="eye-off" size={12} /> Ignored: <strong>{ignored.reason}</strong>
                          {ignored.created_at ? ` · ${new Date(ignored.created_at).toLocaleDateString()}` : ""}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => handleRestoreSource(src.id)} loading={busyIgnoreId === src.id}>
                          Restore
                        </Button>
                      </div>
                    ) : ignoringSourceId === src.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.75rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          Why doesn't it apply?
                          <select
                            className="dsc-input"
                            value={ignoreReason}
                            onChange={(e) => setIgnoreReason(e.target.value)}
                            style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", width: "auto" }}
                            aria-label={`Reason to ignore ${src.label}`}
                          >
                            {IGNORE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </label>
                        <Button size="sm" variant="secondary" onClick={() => handleIgnoreSource(src.id)} loading={busyIgnoreId === src.id}>
                          Ignore source
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setIgnoringSourceId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => { setIgnoringSourceId(src.id); setIgnoreReason(IGNORE_REASONS[0]); }}
                          title="Mark this directory as not applicable to this business. It will be excluded from NAP checks; you can restore it any time."
                        >
                          Not applicable? Ignore
                        </button>
                      </div>
                    )}

                    {/* Portal link & Action Guidance */}
                    {!ignored && portal && (
                      <div style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.35rem", padding: "0.35rem 0.5rem", background: "var(--surface)", borderRadius: "var(--r)" }}>
                        <a
                          href={portal.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem", color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
                          title={`Configure on ${portal.portalName}`}
                        >
                          <Icon name="external" size={12} />
                          Configure on {portal.portalName}
                        </a>
                        <span style={{ color: "var(--text-sub)", fontSize: "0.7rem" }}>
                          {portal.actionHint}
                        </span>
                      </div>
                    )}

                    {/* Declared URL provision */}
                    {ignored ? null : existingListing?.listing_url && !isEditing ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.75rem", background: "var(--surface)", padding: "0.35rem 0.5rem", borderRadius: "var(--r)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", overflow: "hidden" }}>
                          <Icon name="link" size={12} style={{ flexShrink: 0, color: "var(--text-sub)" }} />
                          <span style={{ color: "var(--text-sub)", flexShrink: 0 }}>Listing URL:</span>
                          <a
                            href={existingListing.listing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "var(--accent)", textDecoration: "underline", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}
                            title={existingListing.listing_url}
                          >
                            {existingListing.listing_url}
                          </a>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingSourceId(src.id);
                            setUrlInputs((prev) => ({ ...prev, [src.id]: existingListing.listing_url }));
                          }}
                        >
                          Edit URL
                        </Button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input
                          type="url"
                          className="dsc-input"
                          placeholder={portal ? `Enter listing URL (e.g. ${portal.portalUrl}...)` : "Enter listing URL (https://...)"}
                          value={urlInputs[src.id] ?? existingListing?.listing_url ?? ""}
                          onChange={(e) => setUrlInputs({ ...urlInputs, [src.id]: e.target.value })}
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", flex: 1 }}
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSaveListingUrl(src.id)}
                          loading={savingSourceId === src.id}
                        >
                          {existingListing?.listing_url ? "Update URL" : "Declare URL"}
                        </Button>
                        {isEditing && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingSourceId(null)}>
                            Cancel
                          </Button>
                        )}
                      </div>
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
                {selectedCheck.findings.map((f) => {
                  const meta = LOCAL_FINDING_CODES[f.code] || schema?.finding_codes?.[f.code] || {};
                  const title = meta.title || f.title || "Discrepancy detected";
                  const sourceKey = f.sourceId || f.source_id;
                  const matchedSource = sourceKey ? (schema?.sources || DIRECTORY_SOURCES).find((s) => s.id === sourceKey) : null;
                  const sourceName = matchedSource?.label || (sourceKey ? sourceKey : null);
                  const why = meta.why || f.why || null;

                  return (
                    <div
                      key={f.id}
                      style={{
                        padding: "0.75rem",
                        background: "var(--bg)",
                        borderRadius: "var(--r)",
                        border: "1px solid var(--border)",
                        display: "grid",
                        gap: "0.5rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                            <span className="dsc-badge" style={{ fontWeight: 700, fontSize: "0.8125rem", fontFamily: "var(--font-mono, monospace)" }}>
                              {f.code}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                              {title}
                            </span>
                          </div>
                          {sourceName && (
                            <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", marginTop: "0.25rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                              <Icon name="map-pin" size={12} />
                              <span>Directory Source: <strong>{sourceName}</strong></span>
                            </div>
                          )}
                        </div>
                        <span className={`dsc-pill dsc-pill-${f.severity}`}>{f.severity}</span>
                      </div>

                      {f.detail && (
                        <p style={{ fontSize: "0.8125rem", color: "var(--text-sub)", margin: 0 }}>
                          {f.detail}
                        </p>
                      )}

                      {(f.fields || []).length > 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)" }}>
                          Fields: {f.fields.join(", ")}
                        </div>
                      )}

                      {why && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-sub)", padding: "0.375rem 0.5rem", background: "var(--surface)", borderRadius: "var(--r)", borderLeft: "3px solid var(--accent)" }}>
                          <strong>Why this matters:</strong> {why}
                        </div>
                      )}

                      {f.resolved_at ? (
                        <div style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "var(--text-sub)", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          <Icon name="check" size={14} style={{ color: "var(--color-success, #10b981)" }} />
                          <span>Resolved ({String(f.resolution || "").replace(/_/g, " ")})</span>
                          {f.resolution === "listing_updated" && <span style={{ fontStyle: "italic" }}>— External listing amended</span>}
                          {f.resolution === "not_a_conflict" && <span style={{ fontStyle: "italic" }}>— Accepted as valid business exception</span>}
                        </div>
                      ) : (
                        <div style={{ marginTop: "0.25rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResolveFinding(f.id, "listing_updated")}
                              title="Listing Updated: Confirms the external directory profile has been edited to match your business truth record. Restores NAP consistency."
                            >
                              Listing Updated
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResolveFinding(f.id, "not_a_conflict")}
                              title="Not a Conflict: Marks this discrepancy as an acceptable, legitimate business exception (e.g. statutory registered office vs trading branch)."
                            >
                              Not a Conflict
                            </Button>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.375rem", fontSize: "0.7rem", color: "var(--text-sub)" }}>
                            <span>• <strong>Listing Updated:</strong> Fixed external profile to match truth record.</span>
                            <span>• <strong>Not a Conflict:</strong> Legitimate variance (e.g. registered office).</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
