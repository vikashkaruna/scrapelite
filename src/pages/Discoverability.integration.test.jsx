// Discoverability.integration.test.jsx
//
// The properties this suite defends are the ones the whole module is built
// around, expressed where the user actually meets them — on screen:
//
//   - an unmeasured signal reads "not measured", never "0"
//   - coverage is shown beside the score, so a thin audit is not oversold
//   - a robots.txt refusal offers an attestation, NOT a "Try again" button
//   - a dismissal cannot be submitted without a reason
//   - the framework tabs filter findings and never change a score

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Discoverability from "./Discoverability.jsx";
import { AuthProvider } from "../components/AuthProvider.jsx";
import { ToastProvider } from "../components/Toast.jsx";
import { ErrorModalProvider } from "../components/ErrorModal.jsx";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
const api = vi.hoisted(() => ({
  runAudit: vi.fn(), getResults: vi.fn(), rerun: vi.fn(), compare: vi.fn(),
  trends: vi.fn(), history: vi.fn(), accept: vi.fn(), dismiss: vi.fn(),
  markDone: vi.fn(), reopen: vi.fn(), reportMarkdown: vi.fn(),
  reportCsv: vi.fn(), reportJson: vi.fn(), emailReport: vi.fn(async () => ({ ok: true, sent: true })),
  // Called by AuditHeader on first view. Default: no summary available, so the
  // header degrades to the identity block and every existing assertion below
  // keeps testing what it was written to test.
  summary: vi.fn(async () => ({ summary: null, unavailable: true })),
  listSubjects: vi.fn(async () => ({ subjects: [] })),
  evaluateSxo: vi.fn(async () => ({ sxo: { score: 85 } })),
}));

vi.mock("../lib/apiClient.js", () => ({ setAuthToken: vi.fn(), getAuthToken: () => "tok" }));
vi.mock("../lib/authService.js", async () => {
  const actual = await vi.importActual("../lib/authService.js");
  return { ...actual, getSession: authMocks.getSession, onAuthStateChange: authMocks.onAuthStateChange };
});
vi.mock("../lib/discoverability/discoverabilityClient.js", async () => {
  const actual = await vi.importActual("../lib/discoverability/discoverabilityClient.js");
  return { ...actual, discoverability: api };
});

// A realistic payload: one measured pillar, one deliberately unmeasured signal.
const AUDIT = {
  auditId: "aud_1",
  targetId: "tgt_1",
  persisted: true,
  unreachable: false,
  target: { url: "https://example.com/geo", page_type: "article", page_type_label: "Article",
            device_profile: "mobile", audit_profile: "balanced" },
  finalScore: 78.4, seoScore: 75.2, aeoScore: 82.1, geoScore: 71,
  coverage: 92.5, headlineFramework: "overall",
  frameworks: {
    overall: { score: 78.4, coverage: 92.5 }, seo: { score: 75.2, coverage: 88 },
    aeo: { score: 82.1, coverage: 95.5 }, geo: { score: 71, coverage: 92 },
  },
  pillars: {
    answer_clarity: { score: 84, weight: 0.30, coverage: 100, signals: [
      { code: "conciseness", label: "Answer conciseness", score: 88, weight: 0.25, measured: true, applicable: true },
    ] },
    entity_authority: { score: 71, weight: 0.25, coverage: 100, signals: [] },
    structural_hierarchy: { score: 81, weight: 0.20, coverage: 100, signals: [
      { code: "howto_schema_alignment", label: "HowTo structure & schema match", score: null,
        weight: 0.15, measured: false, applicable: false, unknownReason: "not_applicable" },
    ] },
    technical_accessibility: { score: 76, weight: 0.25, coverage: 70, signals: [
      { code: "core_web_vitals", label: "Core Web Vitals", score: null, weight: 0.30,
        measured: false, applicable: true, unknownReason: "not_measured" },
      { code: "mobile_parity", label: "Mobile parity", score: 100, weight: 0.10, measured: true, applicable: true },
    ] },
  },
  penalties: [{ code: "AI_CRAWLER_PARTIAL_BLOCK", severity: "medium", factor: 0.05,
    label: "Some AI crawlers are disallowed", description: "Citation coverage is uneven across assistants." }],
  penaltyMultiplier: 0.95,
  scoreMath: { prePenaltyTotal: 82.5, penaltyMultiplier: 0.95, finalScore: 78.4 },
  issues: [
    { code: "SH-06", pillar: "structural_hierarchy", severity: "high", frameworks: ["aeo", "seo"],
      title: "Visible FAQs carry no FAQPage schema", evidence: "6 visible pairs, no markup." },
    { code: "EA-03", pillar: "entity_authority", severity: "medium", frameworks: ["geo"],
      title: "No sameAs links to official profiles", evidence: "Nothing confirms which entity this page belongs to." },
  ],
  recommendations: [
    { id: "rec_1", code: "SH-06", pillar: "structural_hierarchy", frameworks: ["aeo", "seo"],
      priority: "high", priorityScore: 58, impactScore: 60, effortScore: 20, confidenceScore: 92,
      estimatedLift: 4.8, owner: "seo", title: "Add FAQPage JSON-LD whose wording matches the page",
      rationale: "The content is already there; the markup makes it extractable.",
      evidence: "6 visible pairs, no markup.", status: "open",
      implementationAsset: { assetType: "jsonld_faq", label: "FAQPage schema", format: "html",
        note: "Generated from the questions already visible on your page.",
        body: '<script type="application/ld+json">{"@type":"FAQPage"}</script>' } },
    { id: "rec_2", code: "EA-03", pillar: "entity_authority", frameworks: ["geo"],
      priority: "medium", priorityScore: 38, effortScore: 10, confidenceScore: 92,
      estimatedLift: 2.5, owner: "brand", title: "Add sameAs entries for the profiles you control",
      rationale: "The cheapest disambiguation signal there is.", status: "open" },
  ],
  estimatedTotalLift: 7.3,
  facts: {
    technical: { http_status: 200, indexable: true, canonical_url: "https://example.com/geo",
      canonical_self_reference: true, viewport: "width=device-width",
      core_web_vitals: null,
      rendering: { raw_html_word_count: 900, rendered_dom_word_count: null, content_loss_ratio: null },
      ai_crawler_access: { GPTBot: true, ClaudeBot: false, PerplexityBot: true },
      structured_data: { block_count: 2, parse_errors: 0, types: ["Organization", "Article"] } },
    content: { h1_count: 1, skipped_levels: 0, empty_headings: 0 },
    entity: { brand_name: "Example", sameAs_links: [], authors: [],
      last_updated_visible: true, ai_citation_sample: null },
  },
  evidence: {
    heading_outline: [{ level: 1, text: "What is generative engine optimization?" },
                      { level: 2, text: "How GEO differs from SEO" }],
    schema_types: ["Organization", "Article"],
    direct_answer_blocks: [{ anchor_heading: "What is generative engine optimization?",
      word_count: 52, position_percent: 6.5, standalone_score: 89,
      excerpt: "Generative engine optimization is the practice of structuring content so AI systems can cite it." }],
    faq_pairs: [],
  },
  meta: { startedAt: Date.parse("2026-08-26"), engine: {} },
  stageErrors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authMocks.getSession.mockResolvedValue({ user: { id: "u1", email: "a@b.com" }, access_token: "t" });
  authMocks.onAuthStateChange.mockReturnValue(() => {});
  api.trends.mockResolvedValue({ points: [], count: 0, change: null });
  api.history.mockResolvedValue({ audits: [] });
  api.runAudit.mockResolvedValue(AUDIT);
});

function Tree({ entry = "/discoverability" } = {}) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider><ErrorModalProvider><AuthProvider>
        <Discoverability />
      </AuthProvider></ErrorModalProvider></ToastProvider>
    </MemoryRouter>
  );
}

/**
 * Render, then let AuthProvider's getSession() promise settle.
 *
 * The page refuses to run an audit while `user` is null — audits are signed-in
 * only, because their value is their history. Clicking in the same tick as the
 * render means clicking before the session has resolved, which is a real
 * ordering the app has (and handles by opening the auth modal) but not the one
 * these tests are about.
 */
async function renderSignedIn(entry) {
  const r = render(<Tree entry={entry} />);
  await act(async () => { await Promise.resolve(); });
  return r;
}

async function submit(url) {
  fireEvent.change(screen.getByLabelText(/URL to audit/i), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: /Run audit/i }));
}

async function runAudit() {
  await renderSignedIn();
  await submit("https://example.com/geo");
  await waitFor(() => expect(screen.getAllByText("78").length).toBeGreaterThan(0));
}

describe("signed-out visitors are told before they click", () => {
  it("says audits need an account instead of bouncing them after Run", async () => {
    authMocks.getSession.mockResolvedValue(null);
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText(/Audits need a free account/i)).toBeInTheDocument();
  });

  it("does not show that note to a signed-in user", async () => {
    await renderSignedIn();
    expect(screen.queryByText(/Audits need a free account/i)).not.toBeInTheDocument();
  });
});

describe("empty state", () => {
  it("explains the four pillars before anything has been run", () => {
    render(<Tree />);
    expect(screen.getByText("Answer Clarity")).toBeInTheDocument();
    expect(screen.getByText("Entity Authority")).toBeInTheDocument();
    expect(screen.getByText("Structural Hierarchy")).toBeInTheDocument();
    expect(screen.getByText("Technical Accessibility")).toBeInTheDocument();
  });

  it("makes no promise about rankings or traffic", () => {
    render(<Tree />);
    expect(screen.getByText(/not a prediction of rankings, citations or traffic/i)).toBeInTheDocument();
  });
});

describe("running an audit", () => {
  it("shows all four framework scores", async () => {
    await runAudit();
    expect(api.runAudit).toHaveBeenCalledWith(expect.objectContaining({
      target_url: "https://example.com/geo", device_profile: "mobile",
    }));
    for (const s of ["78", "75", "82", "71"]) {
      expect(screen.getAllByText(s).length).toBeGreaterThan(0);
    }
  });

  it("omits audit_profile entirely when the user has not chosen one", async () => {
    // This assertion used to require `audit_profile: "balanced"`, and that is
    // now the WRONG contract. An ABSENT profile is the signal that nobody
    // chose one, which is what lets the goal — and failing that, the page's own
    // characteristics — settle the lens, with `audit_profile_source` recording
    // which of them did. Sending a hard "balanced" from the composer would look
    // identical on the wire to a deliberate choice of the neutral lens and would
    // suppress inference on every audit run from the UI.
    await runAudit();
    const body = api.runAudit.mock.calls[0][0];
    expect(body).not.toHaveProperty("audit_profile");
    expect(body).not.toHaveProperty("primary_goal");
  });

  it("sends an idempotency key so a double-clicked button costs one audit", async () => {
    await runAudit();
    expect(api.runAudit.mock.calls[0][0].idempotency_key).toBeTruthy();
  });

  it("accepts a bare domain and adds the scheme", async () => {
    await renderSignedIn();
    await submit("example.com");
    await waitFor(() => expect(api.runAudit).toHaveBeenCalled());
    expect(api.runAudit.mock.calls[0][0].target_url).toBe("https://example.com");
  });

  it("refuses an empty URL without calling the API", async () => {
    await renderSignedIn();
    fireEvent.click(screen.getByRole("button", { name: /Run audit/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Paste the URL/i);
    expect(api.runAudit).not.toHaveBeenCalled();
  });
});

// ── Sign-in interruption must not lose the request ──────────────────────────
// Google/Microsoft sign-in is a full-page navigation away and back, which
// discards every bit of React state the composer held. A signed-out click on
// Run must survive that round trip: land back on this page with the SAME URL
// showing and the audit actually run, not a blank box the user has to redo.
describe("sign-in interruption is resumed, not lost", () => {
  it("allows 1 free guest audit before requiring sign-in", async () => {
    localStorage.clear();
    authMocks.getSession.mockResolvedValue(null);
    api.runAudit.mockResolvedValueOnce(AUDIT);
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await submit("https://example.com/geo");
    expect(api.runAudit).toHaveBeenCalledWith(
      expect.objectContaining({ target_url: "https://example.com/geo", guest: true }),
    );
  });

  it("stashes the request instead of calling the API when signed out after using free audit", async () => {
    localStorage.setItem("datiq.dsc.guestAuditRan", "true");
    authMocks.getSession.mockResolvedValue(null);
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    await submit("https://example.com/geo");
    expect(api.runAudit).not.toHaveBeenCalled();
    const stashed = JSON.parse(sessionStorage.getItem("datiq.pendingAudit"));
    expect(stashed.target_url).toBe("https://example.com/geo");
  });

  it("does not stash an empty/invalid submission (never opens auth for nothing)", async () => {
    authMocks.getSession.mockResolvedValue(null);
    render(<Tree />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: /Run audit/i }));
    expect(sessionStorage.getItem("datiq.pendingAudit")).toBeNull();
  });

  it("resumes a stashed request once signed in: runs it AND shows the URL back in the box", async () => {
    const resumeAudit = {
      target_url: "https://example.com/geo",
      audit_profile: "seo", device_profile: "desktop", page_type_hint: null,
      idempotency_key: "https://example.com/geo|seo|desktop|123",
    };
    await renderSignedIn({ pathname: "/discoverability", state: { resumeAudit } });
    await waitFor(() => expect(api.runAudit).toHaveBeenCalledWith(
      expect.objectContaining({ target_url: "https://example.com/geo", audit_profile: "seo" }),
    ));
    expect(screen.getByLabelText(/URL to audit/i)).toHaveValue("https://example.com/geo");
  });

  it("does not re-run on a re-render once the resume has been consumed", async () => {
    const resumeAudit = {
      target_url: "https://example.com/geo",
      audit_profile: "balanced", device_profile: "mobile", page_type_hint: null,
      idempotency_key: "k1",
    };
    await renderSignedIn({ pathname: "/discoverability", state: { resumeAudit } });
    await waitFor(() => expect(api.runAudit).toHaveBeenCalledTimes(1));
    // A second settle tick must not fire it again (StrictMode-style re-run guard).
    await act(async () => { await Promise.resolve(); });
    expect(api.runAudit).toHaveBeenCalledTimes(1);
  });
});

// ── The central honesty property, on screen ────────────────────────────────
describe("unmeasured is never zero", () => {
  it("labels an unmeasured signal rather than scoring it", async () => {
    await runAudit();
    fireEvent.click(screen.getByRole("button", { name: /^Technical Accessibility/i }));
    const cwv = screen.getByText("Core Web Vitals").closest("li");
    expect(within(cwv).getByText(/Could not be measured/i)).toBeInTheDocument();
    expect(within(cwv).queryByText("0")).not.toBeInTheDocument();
  });

  it("distinguishes not-applicable from not-measured", async () => {
    await runAudit();
    fireEvent.click(screen.getByRole("button", { name: /^Structural Hierarchy/i }));
    const howto = screen.getByText(/HowTo structure/i).closest("li");
    expect(within(howto).getByText(/Not applicable to this page type/i)).toBeInTheDocument();
  });

  it("shows coverage beside the score, so a thin audit is not oversold", async () => {
    await runAudit();
    expect(screen.getAllByText(/92\.5% coverage/).length).toBeGreaterThan(0);
    expect(screen.getByText(/88% coverage/)).toBeInTheDocument();
  });

  it("says which technical facts were not measured", async () => {
    await runAudit();
    expect(screen.getByText(/no headless renderer configured/i)).toBeInTheDocument();
  });

  it("reports an unsampled brand as unknown rather than uncited", async () => {
    await runAudit();
    expect(screen.getByText(/this is unknown — not zero/i)).toBeInTheDocument();
  });
});

describe("penalties show their arithmetic", () => {
  it("prints the pre-penalty score and the multiplier", async () => {
    await runAudit();
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(/83 × 0\.95 = 78/);
    expect(banner).toHaveTextContent(/Some AI crawlers are disallowed/);
  });
});

describe("framework tabs filter, never rescore", () => {
  it("keeps every score identical when the tab changes", async () => {
    await runAudit();
    const before = screen.getAllByText(/^(78|75|82|71)$/).map((n) => n.textContent);
    fireEvent.click(screen.getByRole("button", { name: "GEO" }));
    const after = screen.getAllByText(/^(78|75|82|71)$/).map((n) => n.textContent);
    expect(after).toEqual(before);
  });

  it("narrows the issue list to that framework", async () => {
    await runAudit();
    expect(screen.getByText(/Visible FAQs carry no FAQPage schema/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "GEO" }));
    // SH-06 is aeo+seo; EA-03 is geo. Only the latter survives the GEO tab.
    expect(screen.queryByText(/Visible FAQs carry no FAQPage schema/)).not.toBeInTheDocument();
    expect(screen.getByText(/No sameAs links to official profiles/)).toBeInTheDocument();
  });
});

describe("evidence panels", () => {
  it("renders the heading outline and flags nothing on a clean tree", async () => {
    await runAudit();
    const outline = screen.getByText("Heading tree").closest("section");
    expect(within(outline).getByText("What is generative engine optimization?")).toBeInTheDocument();
    expect(within(outline).getByText("How GEO differs from SEO")).toBeInTheDocument();
    expect(within(outline).queryByText(/skipped level/i)).not.toBeInTheDocument();
  });

  it("shows the passage an answer engine would lift", async () => {
    await runAudit();
    expect(screen.getByText(/Generative engine optimization is the practice/)).toBeInTheDocument();
    expect(screen.getByText(/52 words · 6\.5% down the page/)).toBeInTheDocument();
  });

  it("marks a blocked crawler distinctly from an allowed one", async () => {
    await runAudit();
    const blocked = screen.getByText("ClaudeBot").closest("li");
    expect(blocked.className).toMatch(/dsc-crawler-blocked/);
    expect(screen.getByText("GPTBot").closest("li").className).toMatch(/dsc-crawler-allowed/);
  });
});

describe("the recommendation queue", () => {
  it("shows the fix, the owner and the estimated lift", async () => {
    await runAudit();
    const queue = screen.getByText("What to do next").closest("section");
    expect(within(queue).getByText(/Add FAQPage JSON-LD/)).toBeInTheDocument();
    // Scoped: "SEO" is also a score tile and a framework tab.
    expect(within(queue).getByRole("button", { name: /^SEO$/ })).toBeInTheDocument();
    expect(within(queue).getByText(/up to \+4\.8/)).toBeInTheDocument();
  });

  it("frames the total lift as an upper bound, not a forecast", async () => {
    await runAudit();
    expect(screen.getByText(/upper bound rather than a forecast/i)).toBeInTheDocument();
  });

  it("attaches a copy-ready construct", async () => {
    await runAudit();
    fireEvent.click(screen.getByRole("button", { name: /FAQPage schema/i }));
    expect(screen.getByText(/"@type":"FAQPage"/)).toBeInTheDocument();
  });

  // ── A dismissal without a reason is a mis-click three months later ───────
  it("will not submit a dismissal until a reason is typed", async () => {
    await runAudit();
    const rec = screen.getByText(/Add FAQPage JSON-LD/).closest("li");
    fireEvent.click(within(rec).getByRole("button", { name: /^Dismiss$/ }));

    const confirm = within(rec).getByRole("button", { name: /^Dismiss$/ });
    expect(confirm).toBeDisabled();
    expect(api.dismiss).not.toHaveBeenCalled();

    fireEvent.change(within(rec).getByLabelText(/Why are you dismissing this/i),
      { target: { value: "Deliberate — this page is intentionally not indexed" } });
    expect(within(rec).getByRole("button", { name: /^Dismiss$/ })).toBeEnabled();
  });

  it("passes the reason through when it is given", async () => {
    api.dismiss.mockResolvedValue({ recommendation: { id: "rec_1", status: "dismissed" } });
    await runAudit();
    const rec = screen.getByText(/Add FAQPage JSON-LD/).closest("li");
    fireEvent.click(within(rec).getByRole("button", { name: /^Dismiss$/ }));
    fireEvent.change(within(rec).getByLabelText(/Why are you dismissing this/i),
      { target: { value: "Not applicable to this template" } });
    fireEvent.click(within(rec).getByRole("button", { name: /^Dismiss$/ }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith("rec_1", "Not applicable to this template"));
  });

  it("accepts a recommendation", async () => {
    api.accept.mockResolvedValue({ recommendation: { id: "rec_1", status: "accepted" } });
    await runAudit();
    const rec = screen.getByText(/Add FAQPage JSON-LD/).closest("li");
    fireEvent.click(within(rec).getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(api.accept).toHaveBeenCalledWith("rec_1"));
  });
});

// ── A refusal that cannot change on a retry must not offer a retry ─────────
describe("error handling", () => {
  it("offers an attestation, not a retry, for a robots.txt refusal", async () => {
    const err = new Error("robots.txt disallows this path");
    err.status = 403; err.code = "robots_disallowed";
    err.complianceBlocked = true; err.overridable = true; err.host = "linkedin.com";
    api.runAudit.mockRejectedValue(err);

    await renderSignedIn();
    await submit("https://linkedin.com/in/x");

    expect(await screen.findByText(/asks automated tools not to read this page/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /I own this site or have permission/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("offers no override at all for the operator's host allowlist", async () => {
    const err = new Error("host not permitted");
    err.status = 403; err.code = "host_not_permitted"; err.overridable = false;
    api.runAudit.mockRejectedValue(err);
    await renderSignedIn();
    await submit("https://x.com/a");
    expect(await screen.findByText(/This host is not permitted/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /I own this site/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/i })).not.toBeInTheDocument();
  });

  it("routes a quota refusal to plans, not to a retry", async () => {
    const err = new Error("You've used all 100 discoverability audits this month.");
    err.status = 402; err.code = "QUOTA_EXCEEDED"; err.upgradeTo = "business";
    api.runAudit.mockRejectedValue(err);
    await renderSignedIn();
    await submit("https://x.com/a");
    expect(await screen.findByText(/used this month's audits/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /See plans/i })).toBeInTheDocument();
  });

  it("offers a retry for a genuinely transient failure", async () => {
    const err = new Error("boom");
    err.status = 502; err.code = "AUDIT_FAILED";
    api.runAudit.mockRejectedValue(err);
    await renderSignedIn();
    await submit("https://x.com/a");
    expect(await screen.findByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });
});

describe("an unreachable page still reports what it could gather", () => {
  it("says so plainly rather than showing a score as if it were real", async () => {
    api.runAudit.mockResolvedValue({
      ...AUDIT, unreachable: true, finalScore: null, seoScore: null, aeoScore: null,
      geoScore: null, coverage: 0,
      frameworks: { overall: { score: null, coverage: 0 }, seo: { score: null, coverage: 0 },
        aeo: { score: null, coverage: 0 }, geo: { score: null, coverage: 0 } },
      issues: [{ code: "TA-04", pillar: "technical_accessibility", severity: "critical",
        frameworks: ["seo"], title: "The page does not return a 200", evidence: "Connection refused." }],
    });
    await renderSignedIn();
    await submit("https://gone.example.com");
    expect(await screen.findByText(/This page could not be fetched/i)).toBeInTheDocument();
    expect(screen.getByText(/does not return a 200/)).toBeInTheDocument();
  });
});

describe("email report — a wholly new capability, no email feature existed here before", () => {
  it("emails the PDF report and confirms to the signed-in account's own address", async () => {
    await runAudit();
    fireEvent.click(screen.getByRole("button", { name: /email/i }));
    await waitFor(() => expect(api.emailReport).toHaveBeenCalledWith("aud_1", { format: "pdf", brandKit: null }));
    expect(await screen.findByText(/report emailed to a@b\.com/i)).toBeInTheDocument();
  });

  it("shows the server's own error message when the send fails", async () => {
    api.emailReport.mockRejectedValue(new Error("Could not send the email."));
    await runAudit();
    fireEvent.click(screen.getByRole("button", { name: /email/i }));
    expect(await screen.findByText(/Could not send the email\./i)).toBeInTheDocument();
  });
});
