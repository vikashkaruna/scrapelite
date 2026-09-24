// UseCases.jsx — /use-cases — the hub, grouped by the eight roles (plan §22).
//
// Role names come from PERSONAS, never a copy, and UseCases.test.jsx asserts
// every offered role has a section — so adding a role fails the build until
// the hub says what it is for. Each section links to one or more of the
// use-case landing pages below.
import { useNavigate } from "react-router";
import Icon from "../components/Icon.jsx";
import Button from "../components/Button.jsx";
import { useSeo } from "../hooks/useSeo.js";
import { seoFor } from "../lib/pageSeo.js";
import { PERSONAS } from "../lib/personaConfig.js";

const USE_CASES = [
  {
    slug: "lead-generation",
    icon: "users",
    title: "Lead Generation",
    desc: "Surface leadership contacts, emails, and company intelligence from any domain — without a CRM or scraping script. Build targeted lists in minutes.",
    highlights: ["Extract contact details from any company page", "Enrich with AI summaries and role data", "Export to CSV / HubSpot in one click"],
    cta: "Explore lead generation",
  },
  {
    slug: "competitor-research",
    icon: "eye",
    title: "Competitor Research",
    desc: "Track competitor pricing, product changes, and positioning in real time. Set up scheduled monitors so you're always first to know when something shifts.",
    highlights: ["Extract pricing tables from any URL", "Monitor competitor pages for changes", "Compare structured data across multiple sites"],
    cta: "Explore competitor research",
  },
  {
    slug: "seo-audit",
    icon: "bar-chart",
    title: "SEO Audit",
    desc: "Pull the full heading structure, metadata, link profile, and on-page content from any URL. Feed the results straight into your SEO workflow or brief.",
    highlights: ["Full H1–H6 outline extraction", "Internal and external link analysis", "AI-generated SEO briefs in one click"],
    cta: "Explore SEO auditing",
  },
  {
    slug: "market-research",
    icon: "search",
    title: "Market Research",
    desc: "Map entire domains, extract product catalogs, and surface structured intelligence from industry sites — all without writing a single line of code.",
    highlights: ["Domain mapping to discover every indexed URL", "Structured data extraction in plain English", "Export to CSV or PDF for reporting"],
    cta: "Explore market research",
  },
  {
    slug: "account-intelligence",
    icon: "target",
    title: "Account Intelligence",
    desc: "Turn a list of up to 500 company domains into an enriched, ICP-scored account table your reps can work today — with the source URL behind every field.",
    highlights: ["Bulk enrich from each company's own site", "Score against ICP rules you write and edit", "Push qualified accounts to HubSpot, Notion, Airtable or Slack"],
    cta: "Explore account intelligence",
  },
  {
    slug: "competitive-monitoring",
    icon: "eye",
    title: "Competitive Monitoring",
    desc: "Standing watches on competitor pricing, features and positioning. Materiality classification means a price change wakes you and a copyright year never does.",
    highlights: ["Cadence-based re-reads with a silent baseline", "Critical / high / medium / low change classification", "Routed to Slack, email, a webhook or your CRM"],
    cta: "Explore competitive monitoring",
  },
  {
    slug: "ai-visibility",
    icon: "sparkles",
    title: "AI Visibility",
    desc: "What an AI answer engine says about you and up to four competitors, read under one shared schema and scored across search, answer and generative engines.",
    highlights: ["SEO, AEO and GEO scored separately", "Like-for-like competitor comparison", "Prioritised, copy-ready fixes"],
    cta: "Explore AI visibility",
  },
  {
    slug: "recruiting",
    icon: "users",
    title: "Recruiting Research",
    desc: "Brief yourself properly before you pitch a candidate on a company — what they build, how they position, who leads what, and a watch on their hiring pages.",
    highlights: ["Leadership and team structure from public pages", "A company you can actually describe in a call", "Alerts when careers pages change"],
    cta: "Explore recruiting research",
  },
  {
    slug: "investor-diligence",
    icon: "briefcase",
    title: "Investor Diligence",
    desc: "A sourced pre-meeting brief: product, pricing, published traction signals, the team, and the questions worth asking — with a citation behind every claim.",
    highlights: ["Every fact carries its page and quote", "Same schema across a whole pipeline", "Share to a link, a workspace, or named people only"],
    cta: "Explore investor diligence",
  },
  {
    slug: "revops",
    title: "RevOps",
  },
  {
    slug: "product-marketing",
    title: "Product Marketing",
  },
  {
    slug: "brand-cro",
    title: "Brand & CRO",
  },
];

// One section per offered role: the job, the modules that do it, the outcome,
// and the landing pages that go deeper. Keyed by PERSONAS id.
export const ROLE_SECTIONS = {
  "sales": {
    job: "Walk into every call knowing the account.",
    modules: ["Enrich", "Templates", "Push to CRM"],
    outcome: "A sourced account brief and the contacts a company publishes, pushed to your CRM.",
    pages: ["lead-generation", "account-intelligence"],
  },
  "revops": {
    job: "Clean, score and route account lists.",
    modules: ["Account lists", "ICP scoring", "Signal rules", "Workflow hub"],
    outcome: "A scored account table with coverage on every score, routed where your team works.",
    pages: ["revops", "account-intelligence"],
  },
  "competitive-intel": {
    job: "Know the day a competitor changes something that matters.",
    modules: ["Watchlists", "Compete", "Signal rules"],
    outcome: "Material changes to pricing, features and positioning, classified and routed.",
    pages: ["competitive-monitoring", "competitor-research"],
  },
  "pmm": {
    job: "Build battlecards and claims you can back up.",
    modules: ["Templates", "Watchlists", "Discover"],
    outcome: "Like-for-like competitor rows for pricing, proof and positioning, each with its source.",
    pages: ["product-marketing"],
  },
  "seo": {
    job: "Be found by search engines and cited by AI answers.",
    modules: ["Discover", "Templates", "Monitors"],
    outcome: "SEO, AEO and GEO scores with a prioritised, copy-ready fix list.",
    pages: ["seo-audit", "ai-visibility"],
  },
  "brand-growth": {
    job: "Make sure the web says the right things about you.",
    modules: ["Business truth", "Discover", "Trust & proof"],
    outcome: "An approved truth record, share of voice against competitors, and a trust score based on evidence.",
    pages: ["brand-cro", "ai-visibility"],
  },
  "founder-vc": {
    job: "Understand a company or a market before the first call.",
    modules: ["Templates", "Extract", "Reports"],
    outcome: "A sourced diligence brief, and a landscape you can compare across a pipeline.",
    pages: ["investor-diligence", "market-research"],
  },
  "agency": {
    job: "Run the same research for many clients.",
    modules: ["Discover", "Templates", "Workspaces", "Reports"],
    outcome: "A client teardown and audit in your brand, shared to a link, a workspace or named people.",
    pages: ["seo-audit", "competitor-research", "ai-visibility"],
  },
};

// A use case that fits no single role today; kept and linked below the roles.
const ALSO = ["recruiting"];
const BY_SLUG = Object.fromEntries(USE_CASES.map((u) => [u.slug, u]));

export default function UseCases() {
  // Title, description, canonical and JSON-LD for this route.
  // Ported from the hand-written public/use-cases/index.html this page now owns.
  useSeo(seoFor("/use-cases"));

  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="uc-page container">

        {/* Hero */}
        <div className="uc-hero rise">
          <div className="eyebrow">
            <Icon name="target" size={14} />
            Use cases
          </div>
          <h1>What will you run on DatIQ?</h1>
          <p className="uc-hero-sub">
            DatIQ is not one tool with one job. It reads the public web, runs the workflow that turns
            what it found into a finished brief or a scored list, watches what matters, and routes the
            result to where your team already works. Pick your role to see what it does for you — no setup, no code.
          </p>
          <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
            Try it free
          </Button>
        </div>

        {/* One card per role */}
        <div className="uc-hub-grid">
          {PERSONAS.map((role) => {
            const sec = ROLE_SECTIONS[role.id];
            if (!sec) return null;
            return (
              <section key={role.id} className="uc-hub-card card card-pad fade" aria-labelledby={`uc-role-${role.id}`}>
                <div className="uc-hub-icon"><Icon name={role.icon} size={22} /></div>
                <h2 className="uc-hub-title" id={`uc-role-${role.id}`}>{role.label}</h2>
                <p className="uc-hub-desc">{sec.job}</p>
                <ul className="uc-hub-highlights">
                  <li><Icon name="layers" size={12} /> {sec.modules.join(" · ")}</li>
                  <li><Icon name="check" size={12} strokeWidth={3} /> {sec.outcome}</li>
                </ul>
                <div className="uc-related" style={{ marginTop: "auto" }}>
                  {sec.pages.map((slug) => (
                    <button key={slug} className="uc-related-link" onClick={() => navigate(`/use-cases/${slug}`)}>
                      {BY_SLUG[slug]?.title || slug}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <div className="uc-section fade" style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: "1em", fontWeight: 700, marginBottom: "12px", color: "var(--text-2)" }}>Also</h2>
          <div className="uc-related">
            {ALSO.map((slug) => (
              <button key={slug} className="uc-related-link" onClick={() => navigate(`/use-cases/${slug}`)}>
                {BY_SLUG[slug].title}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="uc-cta rise" style={{ marginTop: 48 }}>
          <h2>Start extracting intelligence today</h2>
          <p>
            All use cases are available on the free plan — 100 credits to start, no credit card required.
            They are granted once when you sign up and never expire.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <Button variant="primary" icon="rocket" onClick={() => navigate("/")}>
              Try DatIQ free
            </Button>
            <Button variant="secondary" icon="credit-card" onClick={() => navigate("/pricing")}>
              See pricing
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
