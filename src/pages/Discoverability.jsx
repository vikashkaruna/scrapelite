// Discoverability.jsx — the SEO / AEO / GEO audit module (route "/discoverability").
//
// Layout follows the functional spec's top-down flow: summary, then evidence,
// then actions.
//
//   1. composer          URL in, run, compare, export
//   2. score row         overall / SEO / AEO / GEO, with deltas and coverage
//   3. pillar cards      the four pillars, expandable to every signal
//   4. issue matrix      severity x pillar, plus the crawler/performance panel
//   5. evidence          heading tree, schema inventory, answer preview, entity
//   6. recommendations   the action queue, with copy-ready constructs
//   7. history           trend across every audit of this page
//
// The framework tabs (Overall / SEO / AEO / GEO) FILTER the issue list and the
// queue; they never change a score. All four framework views are computed from
// the same evidence with the same weightings, and re-weighting per tab would
// mean the same page reported two different numbers depending on where you were
// standing.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../components/AuthProvider.jsx";
import { useSeo } from "../hooks/useSeo.js";
import AuditComposer from "../components/discoverability/AuditComposer.jsx";
import { setPendingAudit } from "../lib/pendingAudit.js";
import ScoreTiles, { PillarGrid, PenaltyBanner } from "../components/discoverability/ScoreTiles.jsx";
import IssueMatrix, { IssueList } from "../components/discoverability/IssueMatrix.jsx";
import RecommendationQueue from "../components/discoverability/RecommendationQueue.jsx";
import TrendChart from "../components/discoverability/TrendChart.jsx";
import {
  Panel, HeadingTreePanel, SchemaPanel, AnswerPanel, EntityPanel, TechnicalPanel,
} from "../components/discoverability/EvidencePanels.jsx";
import AuditHistory from "../components/discoverability/AuditHistory.jsx";
import AuditHeader from "../components/discoverability/AuditHeader.jsx";
import { discoverability, describeAuditError } from "../lib/discoverability/discoverabilityClient.js";
import { downloadTextFile, hostOf } from "../lib/utils.js";

/**
 * Which pillar cards the reader has open, for this browsing session only.
 *
 * Every access is wrapped: sessionStorage throws outright in some embedded and
 * privacy-hardened contexts, and a pillar card refusing to remember its state
 * is never worth taking the report down for.
 */
const OPEN_PILLARS_KEY = "datiq.dsc.openPillars";

export function readOpenPillars() {
  try {
    const raw = sessionStorage.getItem(OPEN_PILLARS_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeOpenPillars(set) {
  try {
    sessionStorage.setItem(OPEN_PILLARS_KEY, JSON.stringify([...set]));
  } catch { /* not worth surfacing */ }
}

const FRAMEWORK_TABS = [
  { id: "overall", label: "Overview" },
  { id: "seo", label: "SEO" },
  { id: "aeo", label: "AEO" },
  { id: "geo", label: "GEO" },
];

/** A refusal that cannot change on a retry must not offer a retry button. */
function AuditError({ error, onRetry, onAttest, onUpgrade }) {
  const d = describeAuditError(error);
  return (
    <div className="dsc-error" role="alert">
      <Icon name="alert-triangle" size={20} />
      <div className="dsc-error-body">
        <strong>{d.title}</strong>
        <p>{d.body}</p>
        <div className="dsc-error-actions">
          {d.action === "retry" && <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button>}
          {d.action === "attest" && (
            <Button size="sm" variant="secondary" onClick={() => onAttest(d.host)}>
              I own this site or have permission
            </Button>
          )}
          {d.action === "upgrade" && (
            <Button size="sm" onClick={() => onUpgrade(d.upgradeTo)}>See plans</Button>
          )}
          {d.action === "signin" && <Button size="sm" onClick={onUpgrade}>Sign in</Button>}
        </div>
      </div>
    </div>
  );
}

export default function Discoverability() {
  const showToast = useToast();
  const { user, openAuth } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [audit, setAudit] = useState(null);
  const [diff, setDiff] = useState(null);
  const [trend, setTrend] = useState(null);
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overall");
  // A Set, so pillars expand independently — see PillarGrid. Persisted to
  // sessionStorage because the commonest next action after reading a pillar is
  // "Re-audit", and having every card slam shut on the new result is exactly
  // the moment you wanted them open. sessionStorage, not localStorage: this is
  // a reading position within one sitting, not a preference.
  const [expandedPillars, setExpandedPillars] = useState(readOpenPillars);
  const togglePillar = useCallback((id) => {
    setExpandedPillars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeOpenPillars(next);
      return next;
    });
  }, []);
  const [matrixCell, setMatrixCell] = useState(null);
  const [busyRec, setBusyRec] = useState(null);
  const [series, setSeries] = useState(["overall"]);
  const [lastRequest, setLastRequest] = useState(null);
  // Set once, when a sign-in interruption is resumed (see the effect below):
  // forces AuditComposer to remount with the resumed URL/options showing,
  // rather than the blank fields a fresh mount would otherwise have.
  const [resumedRequest, setResumedRequest] = useState(null);
  const resumeConsumedRef = useRef(false);

  useSeo({
    title: "Discoverability audit — SEO, AEO and GEO scoring | DatIQ",
    description:
      "Score any page for classic search, answer engines and generative engines. Four pillars, prioritised fixes, and copy-ready schema and answer blocks.",
  });

  const auditId = params.get("audit");
  // `?view=history` rather than a /discoverability/history sub-route: the
  // private-prefix invariant (PRIVATE_PREFIXES, the X-Robots-Tag header in
  // netlify.toml, robots.txt and the inline guard in index.html) already
  // covers this exact path, and netlify.toml's header rule is an EXACT match
  // that a sub-path would silently escape, leaving an audit-history screen
  // indexable. A query param needs none of those four touched.
  const showHistory = params.get("view") === "history";

  // ── Load an audit named in the URL ───────────────────────────────────────
  const loadAudit = useCallback(async (id) => {
    setRunning(true);
    setError(null);
    try {
      const data = await discoverability.getResults(id);
      setAudit(data);
      if (data?.audit?.target_id) await loadTrend(data.audit.target_id);
      if (data?.audit?.baseline_audit_id) {
        try {
          const c = await discoverability.compare(id, data.audit.baseline_audit_id);
          setDiff(c.diff);
        } catch { /* a missing baseline is not an error worth surfacing */ }
      }
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }, []);

  const loadTrend = useCallback(async (targetId) => {
    try {
      const [t, h] = await Promise.all([
        discoverability.trends(targetId),
        discoverability.history(targetId),
      ]);
      setTrend(t);
      setHistory(h.audits || []);
    } catch { /* the trend is supplementary; its absence must not break the page */ }
  }, []);

  useEffect(() => {
    if (auditId && auditId !== audit?.auditId) loadAudit(auditId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // ── Run ──────────────────────────────────────────────────────────────────
  const run = useCallback(async (payload) => {
    if (!user) {
      // Google/Microsoft sign-in is a full-page navigation away and back,
      // which discards every bit of React state — including whatever the
      // composer's URL field held. Stash the request so PendingAuditFlush
      // can hand it back once a session exists, regardless of which page
      // the OAuth round trip actually lands on.
      setPendingAudit(payload);
      openAuth("signup");
      return;
    }
    setRunning(true);
    setError(null);
    setDiff(null);
    setLastRequest(payload);
    try {
      const data = await discoverability.runAudit(payload);
      setAudit(data);
      setMatrixCell(null);
      // Deliberately NOT clearing expandedPillars: which pillars the reader has
      // open is their choice, and a new run against the same page is precisely
      // when they want to keep looking at the same ones.
      if (data.auditId) setParams({ audit: data.auditId }, { replace: true });
      if (data.targetId) await loadTrend(data.targetId);
      if (data.persisted === false) {
        // The work happened and was charged for; say plainly it was not saved
        // so nobody goes looking for it in their history later.
        showToast("Audit complete, but it could not be saved to your history.");
      }
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }, [user, openAuth, setParams, loadTrend, showToast]);

  // ── Resume an audit interrupted by sign-in ──────────────────────────────
  // PendingAuditFlush navigates here with the stashed request once a session
  // exists, whether that's because OAuth bounced through a full page reload
  // or because the user just finished the in-page email/password modal.
  // Either way this component sees a fresh `location.state`, so ONE effect
  // covers both — the whole point being that where and how the interruption
  // happened doesn't matter, only that the request gets finished.
  useEffect(() => {
    const resume = location.state?.resumeAudit;
    if (!resume || !user || resumeConsumedRef.current) return;
    resumeConsumedRef.current = true;
    setResumedRequest(resume);
    // Clear the router state so a page refresh or the browser back button
    // can't redeliver the same stale request.
    navigate(location.pathname + location.search, { replace: true, state: null });
    showToast("Signed in — running your audit…", "check");
    run(resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, user]);

  // ── Arrive from elsewhere in the app with a URL already in hand ─────────
  // The Home composer and Workspace's quick actions hand a URL over rather
  // than running an audit themselves — one implementation of quota, compliance
  // refusals and the signed-in rule, in one place. This is the receiving end.
  //
  // Separate from the resume effect above on purpose: that one finishes a
  // request the user already made and was interrupted mid-way, so it runs
  // immediately and says so. This one is a HAND-OFF — the user has not yet
  // chosen a profile, a device or a page type — so it prefills the composer and
  // lets them press the button. Auto-running would spend an audit credit on
  // defaults they never saw, which is the kind of surprise a quota makes
  // expensive.
  const handoffConsumedRef = useRef(false);
  useEffect(() => {
    const url = location.state?.auditUrl;
    if (!url || handoffConsumedRef.current) return;
    handoffConsumedRef.current = true;
    setResumedRequest({
      target_url: url,
      audit_profile: location.state?.auditProfile || "balanced",
      idempotency_key: `handoff-${url}`,
    });
    navigate(location.pathname + location.search, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const rerun = useCallback(async () => {
    if (!audit?.auditId) return;
    setRunning(true);
    setError(null);
    try {
      const data = await discoverability.rerun(audit.auditId, {});
      setAudit(data);
      if (data.auditId) setParams({ audit: data.auditId }, { replace: true });
      // A re-run is automatically measured against the audit it re-ran, which
      // is what makes "did my fix work" a single click.
      try {
        const c = await discoverability.compare(data.auditId, audit.auditId);
        setDiff(c.diff);
      } catch { /* the comparison is a bonus, not the point */ }
      if (data.targetId) await loadTrend(data.targetId);
      showToast("Re-audited and compared against the previous run");
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }, [audit, setParams, loadTrend, showToast]);

  // ── Recommendation queue ─────────────────────────────────────────────────
  const changeStatus = useCallback(async (rec, status, reason) => {
    if (!rec.id) { showToast("This audit was not saved, so its queue can't be updated."); return; }
    setBusyRec(rec.id);
    try {
      const fn = status === "accepted" ? discoverability.accept
        : status === "dismissed" ? (id) => discoverability.dismiss(id, reason)
        : status === "done" ? discoverability.markDone
        : discoverability.reopen;
      await fn(rec.id);
      setAudit((a) => ({
        ...a,
        recommendations: a.recommendations.map((r) => (r.id === rec.id ? { ...r, status } : r)),
      }));
      showToast(status === "dismissed" ? "Dismissed" : status === "open" ? "Reopened" : `Marked ${status}`);
    } catch (err) {
      showToast(err.message || "Could not update that recommendation");
    } finally {
      setBusyRec(null);
    }
  }, [showToast]);

  // ── Export ───────────────────────────────────────────────────────────────
  const exportReport = useCallback(async (format) => {
    if (!audit?.auditId) return;
    try {
      const slug = (hostOf(audit.target?.url) || "audit").replace(/[^a-z0-9]+/gi, "-");
      if (format === "pdf") {
        // Rendered from the audit already in state — the very object this
        // screen is displaying — so the PDF cannot disagree with what the user
        // is looking at when they press the button.
        //
        // Deliberately NOT from `reportJson`: that endpoint reshapes the
        // payload for API consumers (`framework_scores.overall` rather than
        // `finalScore`, `stage_errors` rather than `stageErrors`), so feeding
        // it to the renderer would print "not measured" for every score.
        //
        // jsPDF is ~350KB and is lazy-loaded on the click. Never static-import.
        // `diff` travels with it: the comparison against the baseline is on
        // screen, so it belongs in the artefact that gets forwarded.
        const { downloadAuditPdf } = await import("../lib/discoverability/auditPdf.js");
        downloadAuditPdf(audit, { includeConstructs: true, diff });
      } else if (format === "markdown") {
        const md = await discoverability.reportMarkdown(audit.auditId, { constructs: true });
        downloadTextFile(md, `discoverability-${slug}.md`, "text/markdown;charset=utf-8;");
      } else if (format === "csv") {
        const csv = await discoverability.reportCsv(audit.auditId);
        downloadTextFile(csv, `discoverability-${slug}.csv`, "text/csv;charset=utf-8;");
      } else {
        const payload = await discoverability.reportJson(audit.auditId);
        downloadTextFile(JSON.stringify(payload, null, 2), `discoverability-${slug}.json`, "application/json;charset=utf-8;");
      }
      showToast("Report downloaded");
    } catch (err) {
      showToast(err.message || "Could not build the report");
    }
  }, [audit, diff, showToast]);

  const issues = audit?.issues || [];
  const filteredIssueCount = useMemo(() => {
    if (tab === "overall") return issues.length;
    return issues.filter((i) => (i.frameworks || []).includes(tab) || (i.frameworks || []).includes("common")).length;
  }, [issues, tab]);

  return (
    <div className="page dsc-page container">
      <header className="dsc-header">
        <div>
          <h1 className="dsc-h1">
            <Icon name="scan-search" size={26} /> Discoverability
          </h1>
          <p className="dsc-sub">
            Score a page for classic search, answer engines and generative engines — then
            get the fixes, already written.
          </p>
        </div>
        <div className="dsc-header-actions">
          {user && !showHistory && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setParams({ view: "history" })}
            >
              <Icon name="clock" size={14} /> History
            </Button>
          )}
          {audit && (
            <>
            <Button size="sm" variant="secondary" onClick={rerun} loading={running}>
              <Icon name="rotate-cw" size={14} /> Re-audit
            </Button>
            <div className="dsc-export">
              <Button size="sm" variant="ghost" onClick={() => exportReport("markdown")}>
                <Icon name="file-text" size={14} /> Report
              </Button>
              <Button size="sm" variant="ghost" onClick={() => exportReport("pdf")}>PDF</Button>
              <Button size="sm" variant="ghost" onClick={() => exportReport("csv")}>CSV</Button>
              <Button size="sm" variant="ghost" onClick={() => exportReport("json")}>JSON</Button>
            </div>
            </>
          )}
        </div>
      </header>

      {showHistory ? (
        <AuditHistory
          currentAuditId={audit?.auditId || null}
          onClose={() => setParams(audit?.auditId ? { audit: audit.auditId } : {})}
          onOpen={(id) => setParams({ audit: id })}
        />
      ) : (
      <>
      <AuditComposer
        // Forces a remount — and so a fresh read of the default* props below —
        // only when resuming an interrupted request. A normal run never
        // changes this key, so typing, Advanced options, etc. behave exactly
        // as before; only the auth-interrupt-then-resume path forces a reset.
        key={resumedRequest ? `resumed-${resumedRequest.idempotency_key}` : "composer"}
        onRun={run}
        running={running}
        defaultUrl={resumedRequest?.target_url || audit?.target?.url || ""}
        defaultProfile={resumedRequest?.audit_profile || "balanced"}
        defaultDevice={resumedRequest?.device_profile || "mobile"}
        defaultPageType={resumedRequest?.page_type_hint || ""}
        signedIn={Boolean(user)}
      />

      {error && (
        <AuditError
          error={error}
          onRetry={() => lastRequest && run(lastRequest)}
          onAttest={() => showToast("Recording site ownership is available from the extraction screen for this host.")}
          // ⚠️ navigate(), NOT window.location.href.
          //
          // A hard navigation to /pricing leaves the SPA entirely, and Netlify
          // serves public/pricing/index.html — the PRERENDERED page — before
          // the SPA fallback. So the upgrade CTA dropped the user onto a static
          // snapshot instead of the live Plans & Pricing screen: no billing
          // context, no current-plan highlight, a full reload, and whatever
          // staleness the committed snapshot happened to carry.
          //
          // The same rule applies to every in-app link to a prerendered route
          // (/about, /blog, /contact, /privacy, /terms, /integrations,
          // /gallery, /use-cases/*, /vs/*): inside the app, route through the
          // router. window.location is for leaving the app.
          onUpgrade={() => (user ? navigate("/pricing") : openAuth("signup"))}
        />
      )}

      {running && !audit && (
        <div className="dsc-running">
          <Icon name="radar" size={22} className="dsc-spin" />
          <div>
            <strong>Auditing…</strong>
            <p>Fetching the page twice — once raw, once rendered — then reading its structure, schema, entity signals and crawler policy.</p>
          </div>
        </div>
      )}

      {audit && (
        <>
          {audit.unreachable && (
            <div className="dsc-error" role="alert">
              <Icon name="alert-octagon" size={20} />
              <div className="dsc-error-body">
                <strong>This page could not be fetched</strong>
                <p>
                  The technical facts we could gather are below. Everything else is
                  unmeasured rather than zero.
                </p>
              </div>
            </div>
          )}

          {/* Which page this report is about, and what it says — above the
              scores, because a wall of numbers with no subject is what opening
              an audit from History used to produce. */}
          <AuditHeader audit={audit} />

          <ScoreTiles
            audit={audit}
            diff={diff}
            headlineFramework={audit.headlineFramework || "overall"}
            selected={tab}
            onSelectFramework={setTab}
          />

          <PenaltyBanner audit={audit} />

          {diff && (
            <div className="dsc-diff-headline">
              <Icon name="git-compare" size={16} />
              <p>{diff.headline}</p>
              {(diff.caveats || []).map((c, i) => <p key={i} className="dsc-caveat">{c}</p>)}
            </div>
          )}

          <nav className="dsc-tabs" aria-label="Framework view">
            {FRAMEWORK_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`dsc-tab${tab === t.id ? " dsc-tab-on" : ""}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
              >
                {t.label}
              </button>
            ))}
            <span className="dsc-tab-note">
              Tabs filter the findings. Every score is computed from the same evidence.
            </span>
          </nav>

          <PillarGrid
            audit={audit}
            diff={diff}
            expandedPillars={expandedPillars}
            onTogglePillar={togglePillar}
          />

          <div className="dsc-grid-2">
            <Panel title={`Issues (${filteredIssueCount})`} icon="alert-triangle">
              <IssueMatrix issues={issues} activeCell={matrixCell} onSelectCell={setMatrixCell} />
              <IssueList issues={issues} filter={matrixCell} framework={tab} />
            </Panel>

            <Panel title="Technical" icon="shield-check">
              <TechnicalPanel technical={audit.facts?.technical} />
            </Panel>
          </div>

          <div className="dsc-grid-2">
            <Panel title="Heading tree" icon="list-tree">
              <HeadingTreePanel
                outline={audit.evidence?.heading_outline}
                stats={audit.facts?.content}
              />
            </Panel>
            <Panel title="Schema inventory" icon="file-json">
              <SchemaPanel
                schemaTypes={audit.evidence?.schema_types}
                structuredData={audit.facts?.technical?.structured_data}
              />
            </Panel>
          </div>

          <div className="dsc-grid-2">
            <Panel title="Extracted answers" icon="message-square">
              <AnswerPanel
                blocks={audit.evidence?.direct_answer_blocks}
                faqPairs={audit.evidence?.faq_pairs}
              />
            </Panel>
            <Panel title="Entity & citation" icon="fingerprint">
              <EntityPanel entity={audit.facts?.entity} />
            </Panel>
          </div>

          <Panel title="What to do next" icon="list-checks" wide>
            {Number.isFinite(audit.estimatedTotalLift) && audit.estimatedTotalLift > 0 && (
              <p className="dsc-panel-summary">
                Implementing everything open is estimated to recover up to{" "}
                <strong>{audit.estimatedTotalLift} points</strong>. Signals interact, so
                treat it as an upper bound rather than a forecast.
                {Number.isFinite(audit.estimatedUnblockedLift)
                  && audit.estimatedUnblockedLift < audit.estimatedTotalLift && (
                  <>
                    {" "}Only <strong>{audit.estimatedUnblockedLift}</strong> of that is
                    available right now — the rest is waiting on a blocking issue.
                  </>
                )}
              </p>
            )}
            <RecommendationQueue
              recommendations={audit.recommendations}
              framework={tab}
              onStatusChange={changeStatus}
              busyId={busyRec}
            />
          </Panel>

          <Panel title="History" icon="trending-up" wide>
            <TrendChart
              trend={trend}
              active={series}
              onToggleSeries={(k) =>
                setSeries((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}
            />
            {history.length > 1 && (
              <ul className="dsc-history">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      className={`dsc-history-item${h.id === audit.auditId ? " dsc-history-current" : ""}`}
                      onClick={() => setParams({ audit: h.id })}
                    >
                      <span>{new Date(h.created_at).toLocaleString()}</span>
                      <span className="dsc-history-score">
                        {h.audit_results?.[0]?.final_score ?? h.audit_results?.final_score ?? "—"}
                      </span>
                      {h.id !== audit.auditId && (
                        <span
                          className="dsc-history-compare"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const c = await discoverability.compare(audit.auditId, h.id);
                              setDiff(c.diff);
                              showToast("Compared against that run");
                            } catch { showToast("Could not compare those audits"); }
                          }}
                        >
                          compare
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {!audit && !running && !error && <EmptyState />}
      </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="dsc-intro">
      <div className="dsc-intro-grid">
        <div className="dsc-intro-card">
          <Icon name="message-square" size={20} />
          <h3>Answer Clarity</h3>
          <p>Whether an assistant could lift a passage off this page and quote it — and whether that fragment would still make sense.</p>
        </div>
        <div className="dsc-intro-card">
          <Icon name="fingerprint" size={20} />
          <h3>Entity Authority</h3>
          <p>Whether a machine can work out who published this, and whether answer engines already cite you.</p>
        </div>
        <div className="dsc-intro-card">
          <Icon name="list-tree" size={20} />
          <h3>Structural Hierarchy</h3>
          <p>Whether the page is segmented cleanly enough for retrieval to find the right section.</p>
        </div>
        <div className="dsc-intro-card">
          <Icon name="shield-check" size={20} />
          <h3>Technical Accessibility</h3>
          <p>Whether bots can reach, render and trust the page at all — including the crawlers that feed AI answers.</p>
        </div>
      </div>
      <p className="dsc-intro-foot">
        Scores describe how discoverable and extractable a page is today. They are not a
        prediction of rankings, citations or traffic.
      </p>
    </div>
  );
}
